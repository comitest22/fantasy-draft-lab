import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { getPlayerCompare, getPlayerGameLog, getPlayerNews } from '../services/api';
import type { PlayerCompare, PlayerGameLog, PlayerNewsItem } from '../types';

/** Artificial minimum so the overlay never feels like a flicker of real load time. */
export const BIO_PLAYER_LOAD_MIN_MS = 2000;

export type BioPlayerLoadState = {
  name: string;
  loading: boolean;
  compare: PlayerCompare | null;
  compareError: string | null;
  log: PlayerGameLog | null;
  logError: string | null;
  newsItems: PlayerNewsItem[];
  newsError: string | null;
};

const BioPlayerLoadContext = createContext<BioPlayerLoadState | null>(null);

export function useBioPlayerLoad(): BioPlayerLoadState | null {
  return useContext(BioPlayerLoadContext);
}

function emptyState(name: string, loading: boolean): BioPlayerLoadState {
  return {
    name,
    loading,
    compare: null,
    compareError: null,
    log: null,
    logError: null,
    newsItems: [],
    newsError: null,
  };
}

async function settleMin(started: number): Promise<void> {
  const wait = Math.max(0, BIO_PLAYER_LOAD_MIN_MS - (Date.now() - started));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Fetches compare + game log + news together, clears immediately on name change,
 * and stays `loading` until every request settles and the 2s floor elapses.
 * Reveal is atomic so the overlay never drops mid-stream.
 */
export function BioPlayerLoadProvider({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<BioPlayerLoadState>(() => emptyState(name, true));

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    setState(emptyState(name, true));

    (async () => {
      const [compareRes, logRes, newsRes] = await Promise.all([
        getPlayerCompare(name)
          .then((r) => ({ ok: true as const, card: r.card }))
          .catch((e) => ({
            ok: false as const,
            error: e instanceof Error ? e.message : 'Could not load that player.',
          })),
        getPlayerGameLog(name)
          .then((r) => ({ ok: true as const, log: r.log }))
          .catch((e) => ({
            ok: false as const,
            error: e instanceof Error ? e.message : 'Game log unavailable.',
          })),
        getPlayerNews(name)
          .then((r) => ({ ok: true as const, items: r.items }))
          .catch((e) => ({
            ok: false as const,
            error: e instanceof Error ? e.message : 'Could not load news.',
          })),
      ]);
      await settleMin(started);
      if (cancelled) return;
      setState({
        name,
        loading: false,
        compare: compareRes.ok ? compareRes.card : null,
        compareError: compareRes.ok ? null : compareRes.error,
        log: logRes.ok ? logRes.log : null,
        logError: logRes.ok ? null : logRes.error,
        newsItems: newsRes.ok ? newsRes.items : [],
        newsError: newsRes.ok ? null : newsRes.error,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <BioPlayerLoadContext.Provider value={state}>{children}</BioPlayerLoadContext.Provider>
  );
}

export function BioPlayerLoadOverlay() {
  const gate = useBioPlayerLoad();
  if (!gate?.loading) return null;
  return (
    <div className="mt-player-bio-load-overlay" aria-busy="true" aria-live="polite">
      <div className="mt-player-bio-load-dialog" role="status">
        Loading…
      </div>
    </div>
  );
}
