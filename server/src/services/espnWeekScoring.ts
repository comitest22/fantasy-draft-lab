import fs from 'fs/promises';
import path from 'path';
import { enrichmentDir } from '../data/store';
import { EspnLeagueError, type EspnAuth } from './espnLeague';

const ESPN_LEAGUE_BASE =
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

export interface EspnWeekPlayerScoring {
  espnId: number;
  /** Week projection (`statSourceId=1`). */
  projectedPoints?: number;
  /** Week actual (`statSourceId=0`); absent until the game starts. */
  weekScore?: number;
  /** Prior scoring period actual. */
  lastWeekPoints?: number;
  /** ESPN % rostered across public leagues. */
  percentOwned?: number;
}

export interface EspnWeekScoringFile {
  season: number;
  scoringPeriodId: number;
  leagueId: number;
  teamId?: number;
  fetchedAt: string;
  players: EspnWeekPlayerScoring[];
}

const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; byId: Map<number, EspnWeekPlayerScoring> }>();

function normalizeSwid(swid: string): string {
  const t = swid.trim();
  if (!t) return t;
  if (t.startsWith('{') && t.endsWith('}')) return t;
  return `{${t}}`;
}

function cookieHeader(auth: EspnAuth): string {
  const espnS2 = auth.espnS2.trim();
  const swid = normalizeSwid(auth.swid);
  if (!espnS2 || !swid || swid === '{}') {
    throw new EspnLeagueError(
      'ESPN cookies required: paste espn_s2 and SWID, or set ESPN_S2 / ESPN_SWID in .env.',
      401
    );
  }
  return `espn_s2=${espnS2}; SWID=${swid}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type EspnStat = {
  scoringPeriodId?: number;
  seasonId?: number;
  statSourceId?: number;
  statSplitTypeId?: number;
  appliedTotal?: number;
};

function pickWeekStat(
  stats: EspnStat[],
  season: number,
  week: number,
  sourceId: number
): number | undefined {
  const hit = stats.find(
    (s) =>
      s.seasonId === season &&
      s.scoringPeriodId === week &&
      s.statSourceId === sourceId &&
      (s.statSplitTypeId === 1 || s.statSplitTypeId == null) &&
      s.appliedTotal != null &&
      Number.isFinite(s.appliedTotal)
  );
  return hit?.appliedTotal != null ? round1(hit.appliedTotal) : undefined;
}

function parseRoster(
  body: {
    teams?: Array<{
      id?: number;
      roster?: {
        entries?: Array<{
          playerPoolEntry?: {
            player?: {
              id?: number;
              stats?: EspnStat[];
              ownership?: { percentOwned?: number };
            };
          };
          player?: {
            id?: number;
            stats?: EspnStat[];
            ownership?: { percentOwned?: number };
          };
        }>;
      };
    }>;
  },
  season: number,
  week: number,
  teamId?: number
): Map<number, EspnWeekPlayerScoring> {
  const out = new Map<number, EspnWeekPlayerScoring>();
  const lastWeek = week > 1 ? week - 1 : undefined;
  for (const team of body.teams ?? []) {
    if (teamId != null && team.id !== teamId) continue;
    for (const entry of team.roster?.entries ?? []) {
      const player = entry.playerPoolEntry?.player ?? entry.player;
      const espnId = player?.id;
      if (espnId == null) continue;
      const stats = player?.stats ?? [];
      const projectedPoints = pickWeekStat(stats, season, week, 1);
      const weekScore = pickWeekStat(stats, season, week, 0);
      const lastWeekPoints =
        lastWeek != null ? pickWeekStat(stats, season, lastWeek, 0) : undefined;
      const owned = player?.ownership?.percentOwned;
      const percentOwned =
        owned != null && Number.isFinite(owned) ? Math.round(owned * 10) / 10 : undefined;
      out.set(espnId, { espnId, projectedPoints, weekScore, lastWeekPoints, percentOwned });
    }
  }
  return out;
}

export function committedEspnWeekScoringPath(season: number): string {
  return path.join(enrichmentDir(), `espn-week-scoring-${season}.json`);
}

export async function writeCommittedEspnWeekScoring(file: EspnWeekScoringFile): Promise<string> {
  const outPath = committedEspnWeekScoringPath(file.season);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  return outPath;
}

export async function readCommittedEspnWeekScoring(
  season: number
): Promise<Map<number, EspnWeekPlayerScoring> | null> {
  try {
    const raw = await fs.readFile(committedEspnWeekScoringPath(season), 'utf-8');
    const data = JSON.parse(raw) as EspnWeekScoringFile;
    if (!Array.isArray(data.players) || data.players.length === 0) return null;
    return new Map(data.players.map((p) => [p.espnId, p]));
  } catch {
    return null;
  }
}

const publicProjCache = new Map<string, { at: number; pts?: number }>();

/**
 * Current-week PPR projection for any ESPN fantasy player id (athlete or D/ST)
 * via public leaguedefaults — not limited to the imported roster.
 */
export async function fetchEspnPublicWeekProjection(
  espnId: number,
  season: number,
  week: number
): Promise<number | undefined> {
  const cacheKey = `${season}::${week}::${espnId}`;
  const hit = publicProjCache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.pts;

  const filter = {
    players: {
      filterIds: { value: [espnId] },
      limit: 1,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const url =
    `${ESPN_LEAGUE_BASE}/${season}/segments/0/leaguedefaults/3` +
    `?view=kona_player_info&scoringPeriodId=${week}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'x-fantasy-filter': JSON.stringify(filter),
      },
    });
    if (!res.ok) {
      publicProjCache.set(cacheKey, { at: Date.now(), pts: undefined });
      return undefined;
    }
    const body = (await res.json()) as {
      players?: Array<{
        id?: number;
        player?: { id?: number; stats?: EspnStat[] };
      }>;
    };
    const wrap = body.players?.[0];
    const stats = wrap?.player?.stats ?? [];
    const pts = pickWeekStat(stats, season, week, 1);
    publicProjCache.set(cacheKey, { at: Date.now(), pts });
    return pts;
  } catch {
    publicProjCache.set(cacheKey, { at: Date.now(), pts: undefined });
    return undefined;
  }
}

async function fetchRosterPeriod(
  leagueId: number,
  season: number,
  auth: EspnAuth,
  scoringPeriodId: number,
  teamId?: number
): Promise<Map<number, EspnWeekPlayerScoring>> {
  const url =
    `${ESPN_LEAGUE_BASE}/${season}/segments/0/leagues/${leagueId}` +
    `?view=mRoster&scoringPeriodId=${scoringPeriodId}`;
  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader(auth),
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new EspnLeagueError(
      'ESPN rejected the cookies (401/403). Re-copy espn_s2 and SWID from fantasy.espn.com while logged in.',
      res.status
    );
  }
  if (!res.ok) {
    throw new EspnLeagueError(`ESPN week scoring fetch failed (${res.status}).`, res.status);
  }

  const body = (await res.json()) as Parameters<typeof parseRoster>[0];
  const byId = parseRoster(body, season, scoringPeriodId, teamId);
  if (byId.size === 0) {
    throw new EspnLeagueError('ESPN week scoring missing from league roster response.', 502);
  }
  return byId;
}

/** Prefer live fields; fill gaps from committed snapshot. */
export function mergeWeekScoring(
  live: Map<number, EspnWeekPlayerScoring> | null,
  committed: Map<number, EspnWeekPlayerScoring> | null
): Map<number, EspnWeekPlayerScoring> | null {
  if (!live && !committed) return null;
  if (!live) return committed;
  if (!committed) return live;
  const out = new Map(live);
  for (const [id, c] of committed) {
    const cur = out.get(id);
    if (!cur) {
      out.set(id, c);
      continue;
    }
    out.set(id, {
      espnId: id,
      projectedPoints: cur.projectedPoints ?? c.projectedPoints,
      weekScore: cur.weekScore ?? c.weekScore,
      lastWeekPoints: cur.lastWeekPoints ?? c.lastWeekPoints,
      percentOwned: cur.percentOwned ?? c.percentOwned,
    });
  }
  return out;
}

/** Live ESPN week proj/score from league `mRoster` (+ prior week actuals for Last). */
export async function fetchEspnWeekScoring(
  leagueId: number,
  season: number,
  auth: EspnAuth,
  scoringPeriodId: number,
  teamId?: number
): Promise<Map<number, EspnWeekPlayerScoring>> {
  const cacheKey = `${leagueId}::${season}::${scoringPeriodId}::${teamId ?? 'all'}::last`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.byId;

  const byId = await fetchRosterPeriod(leagueId, season, auth, scoringPeriodId, teamId);

  // Current-week mRoster often omits prior-period actuals — pull week N-1 when Last is missing.
  if (scoringPeriodId > 1) {
    const missingLast = [...byId.values()].some((p) => p.lastWeekPoints == null);
    if (missingLast) {
      try {
        const prior = await fetchRosterPeriod(
          leagueId,
          season,
          auth,
          scoringPeriodId - 1,
          teamId
        );
        for (const [id, row] of byId) {
          if (row.lastWeekPoints != null) continue;
          const prev = prior.get(id);
          if (prev?.weekScore != null) row.lastWeekPoints = prev.weekScore;
        }
      } catch {
        /* keep whatever current period returned */
      }
    }
  }

  cache.set(cacheKey, { at: Date.now(), byId });
  return byId;
}
