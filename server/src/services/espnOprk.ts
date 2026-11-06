import fs from 'fs/promises';
import path from 'path';
import { enrichmentStore } from '../data/enrichment';
import { enrichmentDir } from '../data/store';
import type { PlayerSosSlate, PlayerSosWeek, Position } from '../types';
import { EspnLeagueError, type EspnAuth } from './espnLeague';

const ESPN_LEAGUE_BASE =
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

/** ESPN fantasy proTeamId → canonical abbreviation (same as espnLeague). */
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

const POS_ID: Record<string, string> = {
  QB: '1',
  RB: '2',
  WR: '3',
  TE: '4',
  K: '5',
  'D/ST': '16',
};

type Rating = { rank?: number; average?: number };

type PositionalRatings = Record<
  string,
  {
    ratingsByOpponent?: Record<string, Rating>;
  }
>;

/** position → opponentAbbrev → OPRK (1 = toughest). */
export type EspnOprkMatrix = Map<Position, Map<string, number>>;

/** position → opponentAbbrev → fantasy points allowed / game. */
export type EspnOprkAverageMatrix = Map<Position, Map<string, number>>;

export type EspnOprkBundle = {
  ranks: EspnOprkMatrix;
  averages: EspnOprkAverageMatrix;
};

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; bundle: EspnOprkBundle }>();

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

function parseBundle(positionalRatings: PositionalRatings | undefined): EspnOprkBundle {
  const ranks: EspnOprkMatrix = new Map();
  const averages: EspnOprkAverageMatrix = new Map();
  if (!positionalRatings) return { ranks, averages };

  for (const [pos, posId] of Object.entries(POS_ID) as Array<[Position, string]>) {
    const byOppRank = new Map<string, number>();
    const byOppAvg = new Map<string, number>();
    const ratings = positionalRatings[posId]?.ratingsByOpponent ?? {};
    for (const [proId, rating] of Object.entries(ratings)) {
      const abbr = ESPN_TEAM[Number(proId)];
      if (!abbr) continue;
      if (rating.rank != null && Number.isFinite(rating.rank)) {
        byOppRank.set(abbr, Math.round(rating.rank));
      }
      if (rating.average != null && Number.isFinite(rating.average)) {
        byOppAvg.set(abbr, round1(rating.average));
      }
    }
    if (byOppRank.size > 0) ranks.set(pos, byOppRank);
    if (byOppAvg.size > 0) averages.set(pos, byOppAvg);
  }
  return { ranks, averages };
}

/** Live ESPN OPRK ranks + FP/game averages from league `kona_player_info`. */
export async function fetchEspnOprkBundle(
  leagueId: number,
  season: number,
  auth: EspnAuth,
  scoringPeriodId?: number
): Promise<EspnOprkBundle> {
  const week = scoringPeriodId ?? enrichmentStore.currentWeek();
  const cacheKey = `${leagueId}::${season}::${week}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bundle;

  const url =
    `${ESPN_LEAGUE_BASE}/${season}/segments/0/leagues/${leagueId}` +
    `?view=kona_player_info&scoringPeriodId=${week}`;
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
    throw new EspnLeagueError(`ESPN OPRK fetch failed (${res.status}).`, res.status);
  }

  const body = (await res.json()) as {
    positionAgainstOpponent?: { positionalRatings?: PositionalRatings };
  };
  const bundle = parseBundle(body.positionAgainstOpponent?.positionalRatings);
  if (bundle.ranks.size === 0) {
    throw new EspnLeagueError('ESPN OPRK matrix missing from league response.', 502);
  }
  cache.set(cacheKey, { at: Date.now(), bundle });
  return bundle;
}

/** Live ESPN OPRK matrix from league `kona_player_info` (`positionAgainstOpponent`). */
export async function fetchEspnOprkMatrix(
  leagueId: number,
  season: number,
  auth: EspnAuth,
  scoringPeriodId?: number
): Promise<EspnOprkMatrix> {
  return (await fetchEspnOprkBundle(leagueId, season, auth, scoringPeriodId)).ranks;
}

export function espnOprkFor(
  matrix: EspnOprkMatrix,
  position: Position,
  opponentAbbrev: string | undefined
): number | undefined {
  if (!opponentAbbrev) return undefined;
  return matrix.get(position)?.get(opponentAbbrev);
}

export function espnOprkAverageFor(
  averages: EspnOprkAverageMatrix,
  position: Position,
  opponentAbbrev: string | undefined
): number | undefined {
  if (!opponentAbbrev) return undefined;
  return averages.get(position)?.get(opponentAbbrev);
}

export interface EspnOprkFile {
  season: number;
  scoringPeriodId: number;
  leagueId: number;
  fetchedAt: string;
  /** position → opponent abbrev → OPRK (1 = toughest). */
  ratings: Record<string, Record<string, number>>;
  /** position → opponent abbrev → fantasy points allowed / game. */
  averages?: Record<string, Record<string, number>>;
}

export function committedEspnOprkPath(season: number): string {
  return path.join(enrichmentDir(), `espn-oprk-${season}.json`);
}

export function matrixToRatings(matrix: EspnOprkMatrix): Record<string, Record<string, number>> {
  const ratings: Record<string, Record<string, number>> = {};
  for (const [pos, byOpp] of matrix) {
    ratings[pos] = Object.fromEntries(byOpp);
  }
  return ratings;
}

export function matrixFromRatings(
  ratings: Record<string, Record<string, number>> | undefined
): EspnOprkMatrix {
  const out: EspnOprkMatrix = new Map();
  if (!ratings) return out;
  for (const [pos, byOpp] of Object.entries(ratings)) {
    const map = new Map<string, number>();
    for (const [abbr, rank] of Object.entries(byOpp ?? {})) {
      if (Number.isFinite(rank)) map.set(abbr.toUpperCase(), Math.round(rank));
    }
    if (map.size > 0) out.set(pos as Position, map);
  }
  return out;
}

function averagesFromFile(
  averages: Record<string, Record<string, number>> | undefined
): EspnOprkAverageMatrix {
  const out: EspnOprkAverageMatrix = new Map();
  if (!averages) return out;
  for (const [pos, byOpp] of Object.entries(averages)) {
    const map = new Map<string, number>();
    for (const [abbr, avg] of Object.entries(byOpp ?? {})) {
      if (Number.isFinite(avg)) map.set(abbr.toUpperCase(), round1(avg));
    }
    if (map.size > 0) out.set(pos as Position, map);
  }
  return out;
}

/** Load Tuesday/Friday committed OPRK snapshot (no cookies). */
export async function readCommittedEspnOprkMatrix(
  season: number
): Promise<EspnOprkMatrix | null> {
  const bundle = await readCommittedEspnOprkBundle(season);
  return bundle?.ranks ?? null;
}

/** Load committed OPRK ranks + FP/game averages. */
export async function readCommittedEspnOprkBundle(
  season: number
): Promise<EspnOprkBundle | null> {
  try {
    const raw = await fs.readFile(committedEspnOprkPath(season), 'utf-8');
    const data = JSON.parse(raw) as EspnOprkFile;
    const ranks = matrixFromRatings(data.ratings);
    if (ranks.size === 0) return null;
    return { ranks, averages: averagesFromFile(data.averages) };
  } catch {
    return null;
  }
}

/**
 * Rank NFL teams 1–N by average ESPN OPRK across a week window.
 * Rank 1 = easiest slate (highest avg OPRK). Byes / missing cells skipped.
 */
export function buildEspnOprkWindowRanks(
  matrix: EspnOprkMatrix,
  position: Position,
  weekFrom: number,
  weekTo: number
): Map<string, number> {
  const board = enrichmentStore.listSosBoard();
  const avgs: Array<{ team: string; avg: number }> = [];
  for (const t of board.teams) {
    const vals: number[] = [];
    for (const game of t.games ?? []) {
      if (game.week < weekFrom || game.week > weekTo || game.bye || !game.opponent) {
        continue;
      }
      const r = espnOprkFor(matrix, position, game.opponent);
      if (r != null) vals.push(r);
    }
    if (vals.length > 0) {
      avgs.push({ team: t.team, avg: vals.reduce((a, b) => a + b, 0) / vals.length });
    }
  }
  avgs.sort((a, b) => b.avg - a.avg || a.team.localeCompare(b.team));
  const ranks = new Map<string, number>();
  avgs.forEach((row, i) => ranks.set(row.team, i + 1));
  return ranks;
}

function oprkByOpponentRecord(
  matrix: EspnOprkMatrix,
  position: Position
): Record<string, number> | undefined {
  const byOpp = matrix.get(position);
  if (!byOpp || byOpp.size === 0) return undefined;
  return Object.fromEntries(byOpp);
}

/** Build weekly ESPN OPRK slate (ranks already 1 = toughest) from schedule + matrix. */
export function buildEspnOprkSlateFromMatrix(
  nflTeam: string | undefined,
  position: Position,
  matrix: EspnOprkMatrix
): PlayerSosSlate | undefined {
  const team = nflTeam?.trim().toUpperCase();
  if (!team) return undefined;
  const board = enrichmentStore.listSosBoard();
  const row = board.teams.find((t) => t.team === team);
  if (!row?.games?.length) return undefined;

  const currentWeek = enrichmentStore.currentWeek();
  const weekMax = Math.max(currentWeek, ...row.games.map((g) => g.week));
  const weeks: PlayerSosWeek[] = row.games.map((game) => ({
    week: game.week,
    opponent: game.opponent,
    home: game.home,
    bye: game.bye,
    rank:
      game.bye || !game.opponent
        ? undefined
        : espnOprkFor(matrix, position, game.opponent),
  }));

  const remainingRanks = buildEspnOprkWindowRanks(matrix, position, currentWeek, weekMax);

  return {
    team: row.team,
    position,
    rank: remainingRanks.get(team),
    currentWeek,
    weeks,
    oprkByOpponent: oprkByOpponentRecord(matrix, position),
  };
}
