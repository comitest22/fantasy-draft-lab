import { enrichmentStore } from '../data/enrichment';
import type { PlayerSosSlate, Position, VsPosMatchup } from '../types';
import {
  EspnLeagueError,
  type EspnAuth,
} from './espnLeague';
import {
  buildEspnOprkSlateFromMatrix,
  espnOprkFor,
  fetchEspnOprkBundle,
  readCommittedEspnOprkBundle,
  readCommittedEspnOprkMatrix,
  type EspnOprkAverageMatrix,
  type EspnOprkMatrix,
} from './espnOprk';
import {
  buildEspnStyleOprkSlate,
  buildPlayerGameLog,
  buildPlayerSosSlate,
} from '../analysis/playerGameLog';
import { invertDefenseRank } from '../analysis/tdMatchup';
import {
  buildVsPosMatchup,
  loadWeeklyDefenseAllowed,
  type WeeklyDefenseAllowed,
} from './vsPosMatchup';

const ESPN_LEAGUE_BASE =
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

const ESPN_TEAM: Record<number, string> = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LA',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
};

const POS_BY_ID: Record<number, Position> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

/** ESPN fantasy slot ids used by kona `filterSlotIds`. */
const SLOT_IDS: Record<string, number[]> = {
  QB: [0],
  RB: [2],
  WR: [4],
  TE: [6],
  FLEX: [2, 4, 6, 23],
  'D/ST': [16],
  K: [17],
};

const TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; view: FreeAgentsView }>();

export type FreeAgentPosFilter =
  | 'ALL'
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'FLEX'
  | 'D/ST'
  | 'K';

export interface FreeAgentPlayer {
  espnId: number;
  name: string;
  nflTeam: string;
  position: Position;
  status?: string;
  availability: 'FREEAGENT' | 'WAIVERS';
  /** e.g. `FA` or `WA (Wed)`. */
  typeLabel: string;
  opponent?: string;
  home?: boolean;
  bye?: boolean;
  kickoff?: string;
  gameStatus?: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';
  teamScore?: number;
  oppScore?: number;
  projectedPoints?: number;
  weekScore?: number;
  lastWeekPoints?: number;
  oppRank?: number;
  percentOwned?: number;
  percentStarted?: number;
  percentChange?: number;
  posRank?: number;
  fantasyPoints?: number;
  avgPoints?: number;
  sosSlate?: PlayerSosSlate;
  oprkSlate?: PlayerSosSlate;
  /** Opponent vs this position (Players tab VS expand). */
  vsMatchup?: VsPosMatchup;
}

export interface FreeAgentsView {
  season: number;
  leagueId: number;
  teamName: string;
  currentWeek: number;
  completedWeeks: number;
  fetchedAt: string;
  position: FreeAgentPosFilter;
  players: FreeAgentPlayer[];
}

interface EspnFaStat {
  seasonId?: number;
  scoringPeriodId?: number;
  statSourceId?: number;
  appliedTotal?: number;
}

interface EspnFaWrap {
  id?: number;
  status?: string;
  waiverProcessDate?: number;
  /** Present when status is ONTEAM. */
  onTeamId?: number;
  player?: {
    id?: number;
    fullName?: string;
    defaultPositionId?: number;
    proTeamId?: number;
    injuryStatus?: string;
    ownership?: {
      percentOwned?: number;
      percentStarted?: number;
      percentChange?: number;
    };
    stats?: EspnFaStat[];
  };
  ratings?: Record<string, { positionalRanking?: number; totalRanking?: number }>;
}

function normalizeSwid(swid: string): string {
  const trimmed = swid.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  return `{${trimmed}}`;
}

function cookieHeader(auth: EspnAuth): string {
  return `espn_s2=${auth.espnS2.trim()}; SWID=${normalizeSwid(auth.swid)}`;
}

function dstName(name: string): string {
  const cleaned = name.replace(/\s+D\/ST$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const nick = parts[parts.length - 1] ?? cleaned;
  return `${nick} D/ST`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pickStat(
  stats: EspnFaStat[],
  season: number,
  scoringPeriodId: number,
  statSourceId: number
): number | undefined {
  const hit = stats.find(
    (s) =>
      s.seasonId === season &&
      s.scoringPeriodId === scoringPeriodId &&
      s.statSourceId === statSourceId &&
      s.appliedTotal != null &&
      Number.isFinite(s.appliedTotal)
  );
  return hit?.appliedTotal != null ? round1(hit.appliedTotal) : undefined;
}

type FaWeekFpts = { weekScore?: number; lastWeekPoints?: number };

/** One ESPN request for many ids — much cheaper than per-player athlete gamelogs. */
async function fetchFaWeekFptsByIds(
  espnIds: number[],
  season: number,
  week: number
): Promise<Map<number, FaWeekFpts>> {
  const out = new Map<number, FaWeekFpts>();
  if (espnIds.length === 0) return out;
  const filter = {
    players: {
      filterIds: { value: espnIds },
      limit: espnIds.length,
    },
  };
  const url =
    `${ESPN_LEAGUE_BASE}/${season}/segments/0/leaguedefaults/3` +
    `?view=kona_player_info&scoringPeriodId=0`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'fantasy-draft-lab',
        'x-fantasy-filter': JSON.stringify(filter),
      },
    });
    if (!res.ok) return out;
    const body = (await res.json()) as
      | { players?: EspnFaWrap[] }
      | EspnFaWrap[];
    const wraps = Array.isArray(body) ? body : body.players ?? [];
    for (const wrap of wraps) {
      const player = wrap.player;
      const id = player?.id ?? wrap.id;
      if (id == null) continue;
      const stats = player?.stats ?? [];
      const weekScore = pickStat(stats, season, week, 0);
      const lastWeekPoints = week > 1 ? pickStat(stats, season, week - 1, 0) : undefined;
      if (weekScore != null || lastWeekPoints != null) {
        out.set(id, { weekScore, lastWeekPoints });
      }
    }
  } catch {
    /* fall through to gamelog */
  }
  return out;
}

/**
 * FA league `kona_player_info` omits weekly actuals — fill Score / Last.
 * Prefer one batched leaguedefaults call; gamelog only for leftovers.
 */
async function attachFaRecentFpts(
  players: FreeAgentPlayer[],
  season: number,
  week: number
): Promise<void> {
  const need = players.filter((p) => p.lastWeekPoints == null || p.weekScore == null);
  if (need.length === 0) return;

  const CHUNK = 80;
  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK);
    const byId = await fetchFaWeekFptsByIds(
      chunk.map((p) => p.espnId),
      season,
      week
    );
    for (const p of chunk) {
      const hit = byId.get(p.espnId);
      if (!hit) continue;
      if (p.weekScore == null && hit.weekScore != null) p.weekScore = hit.weekScore;
      if (p.lastWeekPoints == null && hit.lastWeekPoints != null) {
        p.lastWeekPoints = hit.lastWeekPoints;
      }
    }
  }

  const stillNeed = need.filter((p) => p.lastWeekPoints == null || p.weekScore == null);
  if (stillNeed.length === 0) return;

  const concurrency = 8;
  for (let i = 0; i < stillNeed.length; i += concurrency) {
    const batch = stillNeed.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (p) => {
        try {
          const log = await buildPlayerGameLog(p.name, season);
          if (!log) return;
          if (p.lastWeekPoints == null && week > 1) {
            const prev = log.rows.find((r) => r.week === week - 1);
            if (prev && !prev.bye && typeof prev.fpts === 'number' && Number.isFinite(prev.fpts)) {
              p.lastWeekPoints = round1(prev.fpts);
            }
          }
          if (p.weekScore == null) {
            const cur = log.rows.find((r) => r.week === week);
            if (cur && !cur.bye && typeof cur.fpts === 'number' && Number.isFinite(cur.fpts)) {
              p.weekScore = round1(cur.fpts);
            }
          }
        } catch {
          /* leave blank */
        }
      })
    );
  }
}

function waiverDayLabel(ms?: number): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'America/New_York',
    }).format(new Date(ms));
  } catch {
    return undefined;
  }
}

function typeLabel(status: string, waiverProcessDate?: number): string {
  if (status === 'FREEAGENT') return 'FA';
  const day = waiverDayLabel(waiverProcessDate);
  return day ? `WA (${day})` : 'WA';
}

function parsePosFilter(raw?: string): FreeAgentPosFilter {
  const key = (raw ?? 'ALL').trim().toUpperCase();
  if (key === 'DST' || key === 'D/ST') return 'D/ST';
  if (
    key === 'ALL' ||
    key === 'QB' ||
    key === 'RB' ||
    key === 'WR' ||
    key === 'TE' ||
    key === 'FLEX' ||
    key === 'K'
  ) {
    return key;
  }
  return 'ALL';
}

function enrichFaRow(
  wrap: EspnFaWrap,
  season: number,
  week: number,
  completedWeeks: number,
  espnMatrix: EspnOprkMatrix | null,
  espnAverages: EspnOprkAverageMatrix | null,
  weekly: WeeklyDefenseAllowed | null,
  includeSos: boolean
): FreeAgentPlayer | null {
  const player = wrap.player;
  const espnId = player?.id;
  if (espnId == null) return null;

  const posId = player?.defaultPositionId ?? -1;
  const position = POS_BY_ID[posId];
  if (!position) return null;

  const rawName = player?.fullName?.trim() || `Player ${espnId}`;
  const name = position === 'D/ST' ? dstName(rawName) : rawName;
  const nflTeam =
    position === 'D/ST'
      ? ESPN_TEAM[player?.proTeamId ?? 0] ?? ''
      : ESPN_TEAM[player?.proTeamId ?? 0] ?? 'FA';

  const availability: 'FREEAGENT' | 'WAIVERS' =
    wrap.status === 'WAIVERS' ? 'WAIVERS' : 'FREEAGENT';
  const injury = player?.injuryStatus?.trim();
  const status =
    injury && injury.toUpperCase() !== 'ACTIVE' && injury.toUpperCase() !== 'HEALTHY'
      ? injury
      : undefined;

  const stats = player?.stats ?? [];
  const projectedPoints = pickStat(stats, season, week, 1);
  const weekScore = pickStat(stats, season, week, 0);
  const lastWeekPoints =
    week > 1 ? pickStat(stats, season, week - 1, 0) : undefined;
  const fantasyPoints = pickStat(stats, season, 0, 0);
  const points = enrichmentStore.getSeasonPoints(name, season);
  const gp = points?.gamesPlayed;
  const avg =
    fantasyPoints != null && gp != null && gp > 0
      ? Math.round((fantasyPoints / gp) * 100) / 100
      : undefined;

  const game = nflTeam ? enrichmentStore.getScheduleGame(nflTeam, week) : undefined;
  let oppRank: number | undefined;
  if (espnMatrix && !game?.bye && game?.opponent) {
    oppRank = espnOprkFor(espnMatrix, position, game.opponent);
  }
  if (oppRank == null && !game?.bye && game?.opponent) {
    if (position === 'D/ST') {
      oppRank = invertDefenseRank(enrichmentStore.getOppOffenseRank(nflTeam, week));
    } else if (position !== 'K') {
      oppRank = invertDefenseRank(
        enrichmentStore.getOppPosDefenseRank(nflTeam, week, position)
      );
    }
  }

  const posRank =
    wrap.ratings?.['0']?.positionalRanking ??
    enrichmentStore.getPositionalEosRank(name, season) ??
    enrichmentStore.getEspnPosRank(name, position);

  // SOS/OPRK slates only when the client expands remaining schedule (Players / FA strip).
  const sosSlate = includeSos ? buildPlayerSosSlate(nflTeam, position) : undefined;
  const oprkSlate = includeSos
    ? espnMatrix
      ? buildEspnOprkSlateFromMatrix(nflTeam, position, espnMatrix)
      : buildEspnStyleOprkSlate(nflTeam, position)
    : undefined;

  const onBye = Boolean(game?.bye);
  const opponent = onBye ? undefined : game?.opponent;
  const vsMatchup = buildVsPosMatchup({
    opponent,
    bye: onBye,
    position,
    season,
    completedWeeks,
    ranks: espnMatrix,
    averages: espnAverages,
    weekly,
    oppRank,
  });

  return {
    espnId,
    name,
    nflTeam,
    position,
    status,
    availability,
    typeLabel: typeLabel(availability, wrap.waiverProcessDate),
    opponent,
    home: onBye ? undefined : game?.home,
    bye: onBye || undefined,
    kickoff: game?.kickoff,
    gameStatus: game?.status,
    teamScore: game?.teamScore,
    oppScore: game?.oppScore,
    projectedPoints,
    weekScore,
    lastWeekPoints,
    oppRank,
    percentOwned: player?.ownership?.percentOwned,
    percentStarted: player?.ownership?.percentStarted,
    percentChange: player?.ownership?.percentChange,
    posRank,
    fantasyPoints: fantasyPoints ?? points?.fantasyPoints,
    avgPoints: avg,
    sosSlate,
    oprkSlate,
    vsMatchup,
  };
}

export async function fetchEspnFreeAgents(opts: {
  leagueId: number;
  season: number;
  auth: EspnAuth;
  teamName: string;
  position?: string;
  limit?: number;
  /** Remaining-schedule strips need SOS/OPRK slates (default true when limit ≤ 25; Players passes true). */
  includeSos?: boolean;
}): Promise<FreeAgentsView> {
  await enrichmentStore.load();
  const week = enrichmentStore.currentWeek();
  const position = parsePosFilter(opts.position);
  // ESPN allows large pages; keep a ceiling so Last/Score backfill stays bounded.
  const limit = Math.min(250, Math.max(1, opts.limit ?? 50));
  const includeSos = opts.includeSos ?? limit <= 25;
  const cacheKey = `${opts.leagueId}::${opts.season}::${week}::${position}::${limit}::sos=${includeSos ? 1 : 0}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.view;

  const filter: Record<string, unknown> = {
    filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
    sortPercOwned: { sortPriority: 1, sortAsc: false },
    limit,
  };
  const slots = position === 'ALL' ? undefined : SLOT_IDS[position];
  if (slots) filter.filterSlotIds = { value: slots };

  const url =
    `${ESPN_LEAGUE_BASE}/${opts.season}/segments/0/leagues/${opts.leagueId}` +
    `?view=kona_player_info&scoringPeriodId=${week}`;

  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader(opts.auth),
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-fantasy-filter': JSON.stringify({ players: filter }),
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new EspnLeagueError(
      'ESPN rejected the cookies (401/403). Re-copy espn_s2 and SWID from fantasy.espn.com while logged in.',
      res.status
    );
  }
  if (!res.ok) {
    throw new EspnLeagueError(`ESPN free agents fetch failed (${res.status}).`, res.status);
  }

  const body = (await res.json()) as { players?: EspnFaWrap[] };
  // Live league OPRK + averages when SOS/VS expand is needed; else committed file.
  let espnMatrix: EspnOprkMatrix | null = null;
  let espnAverages: EspnOprkAverageMatrix | null = null;
  if (includeSos) {
    try {
      const bundle = await fetchEspnOprkBundle(
        opts.leagueId,
        opts.season,
        opts.auth,
        week
      );
      espnMatrix = bundle.ranks;
      espnAverages = bundle.averages;
    } catch {
      const committed = await readCommittedEspnOprkBundle(opts.season);
      espnMatrix = committed?.ranks ?? null;
      espnAverages = committed?.averages ?? null;
    }
  } else {
    const committed = await readCommittedEspnOprkBundle(opts.season);
    espnMatrix = committed?.ranks ?? (await readCommittedEspnOprkMatrix(opts.season));
    espnAverages = committed?.averages ?? null;
  }

  const completedWeeks = enrichmentStore.completedWeeks();
  const weekly = await loadWeeklyDefenseAllowed(opts.season);

  const players: FreeAgentPlayer[] = [];
  for (const wrap of body.players ?? []) {
    const row = enrichFaRow(
      wrap,
      opts.season,
      week,
      completedWeeks,
      espnMatrix,
      espnAverages,
      weekly,
      includeSos
    );
    if (row) players.push(row);
  }
  await attachFaRecentFpts(players, opts.season, week);

  const view: FreeAgentsView = {
    season: opts.season,
    leagueId: opts.leagueId,
    teamName: opts.teamName,
    currentWeek: week,
    completedWeeks,
    fetchedAt: new Date().toISOString(),
    position,
    players,
  };
  cache.set(cacheKey, { at: Date.now(), view });
  return view;
}

export type LeaguePoolStatus = 'FREEAGENT' | 'WAIVERS' | 'ONTEAM' | 'UNKNOWN';

export type LeaguePlayerAvailability = {
  name: string;
  /** League pool status from ESPN (or UNKNOWN when cookies/id missing). */
  pool: LeaguePoolStatus;
  /** Short badge: FA · Waivers · Owned. */
  poolLabel: string;
  /** True when the player is on the imported My Team roster. */
  mine: boolean;
};

function poolLabelFor(status: LeaguePoolStatus, waiverProcessDate?: number): string {
  if (status === 'FREEAGENT') return 'FA';
  if (status === 'WAIVERS') return typeLabel('WAIVERS', waiverProcessDate);
  if (status === 'ONTEAM') return 'Owned';
  return '—';
}

function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

async function fetchLeaguePlayerWraps(
  opts: {
    leagueId: number;
    season: number;
    week: number;
    auth: EspnAuth;
  },
  filter: Record<string, unknown>
): Promise<EspnFaWrap[]> {
  const url =
    `${ESPN_LEAGUE_BASE}/${opts.season}/segments/0/leagues/${opts.leagueId}` +
    `?view=kona_player_info&scoringPeriodId=${opts.week}`;
  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader(opts.auth),
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-fantasy-filter': JSON.stringify({ players: filter }),
    },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { players?: EspnFaWrap[] };
  return body.players ?? [];
}

function pickWrap(
  rows: EspnFaWrap[],
  playerName: string,
  espnId: number | undefined
): EspnFaWrap | undefined {
  if (espnId != null) {
    const byId = rows.find((r) => r.player?.id === espnId);
    if (byId) return byId;
  }
  return rows.find((r) =>
    r.player?.fullName ? namesMatch(r.player.fullName, playerName) : false
  );
}

/**
 * League availability for a bio name: FA / Waivers / Owned (+ mine flag).
 * ESPN requires a sort whenever `limit` is set — bare filterIds was 400ing.
 */
export async function lookupEspnLeagueAvailability(opts: {
  leagueId: number;
  season: number;
  auth: EspnAuth;
  /** Imported fantasy team id — mine when player is ONTEAM on this id, or on file roster. */
  teamId: number;
  /** Names on the imported roster (authoritative for `mine`). */
  myRosterNames: string[];
  playerName: string;
}): Promise<LeaguePlayerAvailability> {
  await enrichmentStore.load();
  const week = enrichmentStore.currentWeek();
  const mine = opts.myRosterNames.some((n) => namesMatch(n, opts.playerName));
  if (mine) {
    return {
      name: opts.playerName,
      pool: 'ONTEAM',
      poolLabel: 'Owned',
      mine: true,
    };
  }

  const espnId = enrichmentStore.getEspnAthleteId(opts.playerName, opts.season);
  const ctx = {
    leagueId: opts.leagueId,
    season: opts.season,
    week,
    auth: opts.auth,
  };

  let wrap: EspnFaWrap | undefined;
  try {
    if (espnId != null) {
      // League kona rejects limit without a sort (FILTER_LIMIT_MISSING_SORT).
      wrap = pickWrap(
        await fetchLeaguePlayerWraps(ctx, {
          filterIds: { value: [espnId] },
          limit: 1,
          sortPercOwned: { sortPriority: 1, sortAsc: false },
          filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
        }),
        opts.playerName,
        espnId
      );
    }
    if (!wrap) {
      // Fallback: scan FA/waiver pool (covers deep names when id lookup misses).
      wrap = pickWrap(
        await fetchLeaguePlayerWraps(ctx, {
          filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
          limit: 250,
          sortPercOwned: { sortPriority: 1, sortAsc: false },
        }),
        opts.playerName,
        espnId
      );
    }
  } catch {
    /* fall through to UNKNOWN */
  }

  const raw = (wrap?.status ?? '').toUpperCase();
  let pool: LeaguePoolStatus = 'UNKNOWN';
  if (raw === 'FREEAGENT' || raw === 'WAIVERS' || raw === 'ONTEAM') {
    pool = raw;
  } else if (wrap?.onTeamId != null && Number.isFinite(wrap.onTeamId) && wrap.onTeamId > 0) {
    pool = 'ONTEAM';
  }

  // Still missing → treat as rostered elsewhere when not in FA/WA (typical for owned).
  // Direct id lookup with ONTEAM in filterStatus should catch most; if both misses,
  // leave UNKNOWN rather than guessing Owned.
  const onMyEspnTeam =
    pool === 'ONTEAM' &&
    wrap?.onTeamId != null &&
    Number(wrap.onTeamId) === opts.teamId;

  return {
    name: opts.playerName,
    pool,
    poolLabel: poolLabelFor(pool, wrap?.waiverProcessDate),
    mine: onMyEspnTeam,
  };
}

export { parsePosFilter };
