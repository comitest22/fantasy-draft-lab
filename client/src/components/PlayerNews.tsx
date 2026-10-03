import { useEffect, useState } from 'react';
import { getPlayerNews, getPlayerNewsArticle } from '../services/api';
import type { PlayerNewsArticle, PlayerNewsItem } from '../types';

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

function formatPublished(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPaywallUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return PAYWALL_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function itemIsExternal(item: PlayerNewsItem): boolean {
  if (item.paywalled) return true;
  return isPaywallUrl(item.canonicalUrl || item.url);
}

function articleFromItem(item: PlayerNewsItem, fallbackUrl: string): PlayerNewsArticle | null {
  if (!item.excerpt) return null;
  return {
    title: item.title,
    canonicalUrl: item.canonicalUrl || fallbackUrl,
    excerpt: item.excerpt,
    truncated: item.truncated ?? false,
  };
}

export default function PlayerNews({
  name,
  articleUrl,
  onOpenArticle,
  onBackToResults,
}: {
  name: string;
  articleUrl?: string | null;
  onOpenArticle: (item: PlayerNewsItem) => void;
  onBackToResults: () => void;
}) {
  const [items, setItems] = useState<PlayerNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [article, setArticle] = useState<PlayerNewsArticle | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPlayerNews(name)
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load news.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const reading = articleUrl && isHttpUrl(articleUrl) ? articleUrl : null;
  const selected = reading ? items.find((item) => item.url === reading) : undefined;

  useEffect(() => {
    if (!reading) {
      setArticle(null);
      setArticleError(null);
      setArticleLoading(false);
      return;
    }
    if (selected && itemIsExternal(selected)) {
      setArticle({
        title: selected.title,
        canonicalUrl: selected.canonicalUrl || reading,
        excerpt: '',
        truncated: false,
        error: 'This publisher requires a subscription. Open the original on their site.',
      });
      setArticleError(null);
      setArticleLoading(false);
      return;
    }
    if (!selected && isPaywallUrl(reading)) {
      setArticle({
        canonicalUrl: reading,
        excerpt: '',
        truncated: false,
        error: 'This publisher requires a subscription. Open the original on their site.',
      });
      setArticleError(null);
      setArticleLoading(false);
      return;
    }
    const fromList = selected ? articleFromItem(selected, reading) : null;
    if (fromList) {
      setArticle(fromList);
      setArticleError(null);
      setArticleLoading(false);
      return;
    }
    let cancelled = false;
    setArticle(null);
    setArticleError(null);
    setArticleLoading(true);
    getPlayerNewsArticle(reading)
      .then((data) => {
        if (cancelled) return;
        if (data.article.error && !data.article.excerpt) {
          setArticleError(data.article.error);
          setArticle(data.article);
          return;
        }
        setArticle(data.article);
      })
      .catch((err) => {
        if (!cancelled) {
          setArticleError(err instanceof Error ? err.message : 'Could not load article text.');
        }
      })
      .finally(() => {
        if (!cancelled) setArticleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reading, selected]);

  if (reading) {
    const originalUrl = article?.canonicalUrl || selected?.canonicalUrl || reading;
    const paragraphs = article?.excerpt
      ? article.excerpt.split(/\n{2,}/).filter(Boolean)
      : [];
    const blocked = Boolean(articleError || article?.error) && paragraphs.length === 0;
    return (
      <aside className="player-news player-news-reading" aria-label={`Article about ${name}`}>
        <button type="button" className="back-link player-news-back" onClick={onBackToResults}>
          ← Back to news results
        </button>
        <h2>{article?.title || selected?.title || 'Article'}</h2>
        {(selected?.source || selected?.published) && (
          <p className="subtitle">
            {[selected.source, formatPublished(selected.published)].filter(Boolean).join(' · ')}
          </p>
        )}
        {articleLoading && <p className="status">Loading article…</p>}
        {blocked && (
          <div className="player-news-paywall">
            <p>{articleError || article?.error}</p>
            <a
              className="player-news-open-original"
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original
            </a>
          </div>
        )}
        {!blocked && (articleError || article?.error) && (
          <p className="error">{articleError || article?.error}</p>
        )}
        {paragraphs.length > 0 && (
          <div className="player-news-excerpt">
            {paragraphs.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
        {!blocked && (
          <p className="player-news-frame-note">
            {article?.truncated
              ? 'Excerpt for reading in-app. Open original for the full story.'
              : 'Open original for the full article on the publisher site.'}{' '}
            <a href={originalUrl} target="_blank" rel="noopener noreferrer">
              Open original
            </a>
          </p>
        )}
      </aside>
    );
  }

  return (
    <aside className="player-news" aria-label={`Latest news for ${name}`}>
      <h2>Latest news</h2>
      <p className="subtitle">Recent headlines for {name}.</p>
      {loading && <p className="status">Loading headlines…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="player-news-empty">No headlines found.</p>
      )}
      {items.length > 0 && (
        <ul className="player-news-list">
          {items.map((item) => {
            const external = itemIsExternal(item);
            return (
              <li key={item.url}>
                <a
                  href={item.canonicalUrl || item.url}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                  onClick={(e) => {
                    if (external) return;
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    onOpenArticle(item);
                  }}
                >
                  {item.title}
                </a>
                <span>
                  {[
                    item.source,
                    formatPublished(item.published),
                    external ? 'Opens on publisher' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
