const MAX_WORDS = 420;
const MIN_PARAGRAPH = 40;

const BOILERPLATE =
  /cookie (settings|policy)|sign up for (our )?newsletter|enable javascript|advertisement|related stories|we use cookies/i;

export function isPublicHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return null;
    }
    if (host === '::1' || host === '0.0.0.0') return null;
    if (/^(127|10|0)\./.test(host)) return null;
    if (/^192\.168\./.test(host)) return null;
    if (/^169\.254\./.test(host)) return null;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(p|div|h1|h2|h3|li|br|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function usableParagraph(text: string): boolean {
  if (text.length < MIN_PARAGRAPH) return false;
  if (BOILERPLATE.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;
  return true;
}

/** Collapse whitespace/case so duplicate DOM / JSON-LD copies drop out. */
export function paragraphKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function dedupeParagraphs(paragraphs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const para of paragraphs) {
    const key = paragraphKey(para);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(para);
  }
  return out;
}

export function extractTitle(html: string): string | undefined {
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1]
    ?? html.match(/content="([^"]+)"\s+property="og:title"/i)?.[1];
  if (og) return decodeEntities(og).trim();
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return stripTags(h1).trim() || undefined;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeEntities(title.replace(/\s+/g, ' ')).trim() : undefined;
}

export function extractParagraphs(html: string): string[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const recs = Array.isArray(data) ? data : [data];
      for (const rec of recs) {
        const body = rec?.articleBody;
        if (typeof body === 'string' && body.trim().length > 80) {
          return dedupeParagraphs(
            body
              .split(/\n{2,}/)
              .map((p: string) => p.replace(/\s+/g, ' ').trim())
              .filter(usableParagraph),
          );
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  const paras = dedupeParagraphs(
    [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripTags(m[1]).replace(/\s+/g, ' '))
      .filter(usableParagraph),
  );

  if (paras.length >= 2) return paras;

  const og = html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1]
    ?? html.match(/name="description"\s+content="([^"]+)"/i)?.[1];
  if (og) {
    const desc = decodeEntities(og).replace(/\s+/g, ' ').trim();
    if (desc.length > 40) return [desc];
  }

  return paras;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function looksLikePaywall(html: string): boolean {
  return /subscribe to (continue|read|unlock)|already a subscriber|create (a free )?account to (read|continue)|this (article|story) is (for subscribers|exclusive)|piano-paywall|tp\.piano|metered.?paywall|paywall-modal/i.test(
    html
  );
}

const PAYWALL_HOSTS = [
  'nypost.com',
  'nytimes.com',
  'theathletic.com',
  'wsj.com',
  'washingtonpost.com',
  'latimes.com',
  'bloomberg.com',
  'ft.com',
  'economist.com',
];

export function isPaywallHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PAYWALL_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

const MIN_READABLE_WORDS = 140;

export function isReadableArticle(article: { excerpt: string; error?: string }): boolean {
  if (article.error || !article.excerpt.trim()) return false;
  const words = wordCount(article.excerpt);
  if (words < MIN_READABLE_WORDS) return false;
  const paras = article.excerpt.split(/\n{2,}/).filter((p) => p.trim().length > 40);
  return paras.length >= 2 || words >= 200;
}

export function summarizeExcerpt(paragraphs: string[], maxWords = MAX_WORDS): { excerpt: string; truncated: boolean } {
  const kept: string[] = [];
  let words = 0;
  for (const para of paragraphs) {
    const count = para.split(/\s+/).filter(Boolean).length;
    if (kept.length > 0 && words + count > maxWords) {
      return { excerpt: kept.join('\n\n'), truncated: true };
    }
    kept.push(para);
    words += count;
    if (words >= maxWords) {
      return { excerpt: kept.join('\n\n'), truncated: paragraphs.length > kept.length || words > maxWords };
    }
  }
  return { excerpt: kept.join('\n\n'), truncated: false };
}
