import type { PlayerNewsArticle, PlayerNewsItem } from '../types';
import {
  extractParagraphs,
  extractTitle,
  isPaywallHost,
  isPublicHttpUrl,
  isReadableArticle,
  looksLikePaywall,
  summarizeExcerpt,
} from './articleText';

const LIMIT = 8;
const RESOLVE_BATCH = 4;
const CACHE_MS = 10 * 60 * 1000;
const ARTICLE_CACHE_MS = 15 * 60 * 1000;
const FETCH_MS = 8000;
const MAX_HTML_BYTES = 1_500_000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const newsCache = new Map<string, { at: number; items: PlayerNewsItem[] }>();
const articleCache = new Map<string, { at: number; article: PlayerNewsArticle }>();
const resolveCache = new Map<string, { at: number; url: string }>();
const googleCookies = new Map<string, string>();

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decode(match[1]) : undefined;
}

function newsQuery(playerName: string): string {
  const cleaned = playerName.replace(/\s+D\/ST$/i, '').trim();
  if (/D\/ST$/i.test(playerName)) return `"${cleaned}" NFL defense`;
  return `"${playerName}" NFL`;
}

function parseRss(xml: string): PlayerNewsItem[] {
  const items: PlayerNewsItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = tag(block, 'title');
    const url = tag(block, 'link');
    if (!title || !url) continue;
    items.push({
      title,
      url,
      source: tag(block, 'source'),
      published: tag(block, 'pubDate'),
    });
    if (items.length >= LIMIT) break;
  }
  return items;
}

function isGoogleHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'news.google.com' || host.endsWith('.news.google.com') || host === 'www.google.com';
}

function googleCookieHeader(): string | undefined {
  if (googleCookies.size === 0) return undefined;
  return [...googleCookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function rememberGoogleCookies(headers: Headers): void {
  const lines =
    typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const fallback = headers.get('set-cookie');
  const all = lines.length > 0 ? lines : fallback ? [fallback] : [];
  for (const line of all) {
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    googleCookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}

function googleHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': BROWSER_UA,
    Referer: 'https://news.google.com/',
    ...extra,
  };
  const cookie = googleCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs = FETCH_MS
): Promise<{ url: string; status: number; body: string }> {
  const parsed = isPublicHttpUrl(url);
  if (!parsed) throw new Error('Blocked URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const outbound = { ...headers };
    if (isGoogleHost(parsed.hostname)) {
      const cookie = googleCookieHeader();
      if (cookie) outbound.Cookie = cookie;
    }
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: outbound,
    });
    const finalHost = (() => {
      try {
        return new URL(res.url).hostname;
      } catch {
        return parsed.hostname;
      }
    })();
    if (isGoogleHost(parsed.hostname) || isGoogleHost(finalHost)) {
      rememberGoogleCookies(res.headers);
    }
    if (!isPublicHttpUrl(res.url)) throw new Error('Blocked redirect');
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.subarray(0, MAX_HTML_BYTES).toString('utf8');
    return { url: res.url, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function googleNewsArticleId(url: string): string | undefined {
  const parsed = isPublicHttpUrl(url);
  if (!parsed || parsed.hostname !== 'news.google.com') return undefined;
  const match = parsed.pathname.match(/\/(?:rss\/)?articles\/([^/?]+)/);
  return match?.[1];
}

function parseBatchexecute(body: string): unknown {
  let text = body.replace(/^\)\]\}'\s*/, '').trim();
  const nl = text.indexOf('\n');
  if (nl > 0 && /^\d+$/.test(text.slice(0, nl).trim())) {
    text = text.slice(nl + 1).trim();
  }
  const start = text.indexOf('[');
  if (start > 0) text = text.slice(start);
  return JSON.parse(text) as unknown;
}

function signatureFromHtml(html: string): { signature: string; timestamp: string } | undefined {
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) return undefined;
  return { signature, timestamp };
}

async function resolveGoogleNewsUrl(url: string): Promise<string> {
  const id = googleNewsArticleId(url);
  if (!id) return url;
  const hit = resolveCache.get(id);
  if (hit && Date.now() - hit.at < ARTICLE_CACHE_MS) return hit.url;

  let params: { signature: string; timestamp: string } | undefined;
  for (const landingUrl of [
    `https://news.google.com/rss/articles/${id}`,
    `https://news.google.com/articles/${id}`,
  ]) {
    try {
      const landing = await fetchText(landingUrl, googleHeaders());
      params = signatureFromHtml(landing.body);
      if (params) break;
    } catch {
      // try the other landing path
    }
  }
  if (!params) return url;

  const rpcInner = JSON.stringify([
    'garturlreq',
    [
      ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, 0, 1],
      'X',
      'X',
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    id,
    Number(params.timestamp),
    params.signature,
  ]);
  const parsedBatch = isPublicHttpUrl('https://news.google.com/_/DotsSplashUi/data/batchexecute');
  if (!parsedBatch) return url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const post = await fetch(parsedBatch.toString(), {
      method: 'POST',
      signal: controller.signal,
      headers: googleHeaders({
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      }),
      body: new URLSearchParams({
        'f.req': JSON.stringify([[['Fbv4je', rpcInner, null, 'generic']]]),
      }).toString(),
    });
    rememberGoogleCookies(post.headers);
    const envelopes = parseBatchexecute(await post.text());
    if (!Array.isArray(envelopes)) return url;
    for (const env of envelopes) {
      if (!Array.isArray(env) || env[0] !== 'wrb.fr' || env[1] !== 'Fbv4je') continue;
      const payload = JSON.parse(String(env[2])) as unknown;
      if (Array.isArray(payload) && payload[0] === 'garturlres' && typeof payload[1] === 'string') {
        if (!isPublicHttpUrl(payload[1])) return url;
        resolveCache.set(id, { at: Date.now(), url: payload[1] });
        return payload[1];
      }
    }
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
  return url;
}

function unreadable(canonicalUrl: string, error: string): PlayerNewsArticle {
  return { canonicalUrl, excerpt: '', truncated: false, error };
}

export async function fetchPlayerNews(playerName: string): Promise<PlayerNewsItem[]> {
  const key = playerName.trim().toLowerCase();
  const hit = newsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;

  const url =
    'https://news.google.com/rss/search?' +
    new URLSearchParams({
      q: newsQuery(playerName),
      hl: 'en-US',
      gl: 'US',
      ceid: 'US:en',
    }).toString();

  const res = await fetchText(
    url,
    googleHeaders({
      Accept: 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
    }),
    FETCH_MS
  );
  if (res.status < 200 || res.status >= 300) throw new Error(`News ${res.status}`);
  const candidates = parseRss(res.body);
  const items: PlayerNewsItem[] = [];
  for (let i = 0; i < candidates.length; i += RESOLVE_BATCH) {
    const batch = candidates.slice(i, i + RESOLVE_BATCH);
    const resolved = await Promise.all(
      batch.map(async (item) => {
        const canonicalUrl = await resolveGoogleNewsUrl(item.url);
        const next = canonicalUrl === item.url ? item : { ...item, canonicalUrl };
        const target = next.canonicalUrl || next.url;
        return isPaywallHost(target) ? { ...next, paywalled: true } : next;
      })
    );
    items.push(...resolved);
  }
  newsCache.set(key, { at: Date.now(), items });
  return items;
}

export async function fetchPlayerNewsArticle(rawUrl: string): Promise<PlayerNewsArticle> {
  const requested = isPublicHttpUrl(rawUrl);
  if (!requested) {
    return { canonicalUrl: rawUrl, excerpt: '', truncated: false, error: 'Invalid article URL.' };
  }

  const cacheKey = requested.toString();
  const hit = articleCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ARTICLE_CACHE_MS) return hit.article;

  try {
    const canonicalUrl = await resolveGoogleNewsUrl(cacheKey);
    if (googleNewsArticleId(canonicalUrl)) {
      const article = unreadable(
        canonicalUrl,
        'Could not unwrap the publisher link. Open the original instead.'
      );
      articleCache.set(cacheKey, { at: Date.now(), article });
      return article;
    }
    if (isPaywallHost(canonicalUrl)) {
      const article = unreadable(
        canonicalUrl,
        'This publisher requires a subscription. Open the original on their site.'
      );
      articleCache.set(cacheKey, { at: Date.now(), article });
      return article;
    }
    const page = await fetchText(
      canonicalUrl,
      {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': BROWSER_UA,
      },
      FETCH_MS
    );
    if (page.status < 200 || page.status >= 300) {
      const article = unreadable(
        page.url || canonicalUrl,
        'The publisher blocked the request. Open the original article instead.'
      );
      articleCache.set(cacheKey, { at: Date.now(), article });
      return article;
    }

    if (looksLikePaywall(page.body)) {
      const article = unreadable(
        page.url || canonicalUrl,
        'This publisher requires a subscription. Open the original on their site.'
      );
      articleCache.set(cacheKey, { at: Date.now(), article });
      return article;
    }

    const paragraphs = extractParagraphs(page.body);
    if (paragraphs.length === 0) {
      const article = unreadable(
        page.url || canonicalUrl,
        'Could not extract article text (paywall or blocked). Open the original instead.'
      );
      articleCache.set(cacheKey, { at: Date.now(), article });
      return article;
    }

    const { excerpt, truncated } = summarizeExcerpt(paragraphs);
    const article: PlayerNewsArticle = {
      title: extractTitle(page.body),
      canonicalUrl: page.url || canonicalUrl,
      excerpt,
      truncated,
    };
    if (!isReadableArticle(article)) {
      const failed = unreadable(article.canonicalUrl, 'Too little article text.');
      articleCache.set(cacheKey, { at: Date.now(), article: failed });
      return failed;
    }
    articleCache.set(cacheKey, { at: Date.now(), article });
    return article;
  } catch {
    const article: PlayerNewsArticle = {
      canonicalUrl: cacheKey,
      excerpt: '',
      truncated: false,
      error: 'Could not load article text. Open the original instead.',
    };
    articleCache.set(cacheKey, { at: Date.now(), article });
    return article;
  }
}
