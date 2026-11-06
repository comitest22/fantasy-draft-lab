/**
 * Lineup "vs" strip: opponent matchup vs the player's position.
 * Last-3 FPA/yards from nflverse weekly; season FPA from ESPN OPRK averages.
 */
import fs from 'fs/promises';
import path from 'path';
import { perGame } from '../analysis/tdMatchup';
import { canonicalTeam, enrichmentStore } from '../data/enrichment';
import type { Position, VsPosMatchup } from '../types';
import {
  espnOprkAverageFor,
  espnOprkFor,
  type EspnOprkAverageMatrix,
  type EspnOprkMatrix,
} from './espnOprk';

const ROOT = path.resolve(__dirname, '../../..');
const CACHE_DIR = path.join(ROOT, '.cache/nflverse');

const SKILL: ReadonlySet<string> = new Set(['QB', 'RB', 'WR', 'TE']);

/** pos → defense abbrev → week → value. */
export type WeeklyFpaByPos = Map<string, Map<string, Map<number, number>>>;

/** pos → defense → week → yards. */
export type WeeklyYdsByPos = WeeklyFpaByPos;

/** pos → defense → season TD total. */
export type SeasonTdsByPos = Map<string, Map<string, number>>;

/** @deprecated Prefer airTdsByPos.get('QB'); kept for older call sites. */
export type QbPassTdsByDef = Map<string, number>;

export type WeeklyDefenseAllowed = {
  fpaByPos: WeeklyFpaByPos;
  /** Combined yards: QB pass; skill rush+rec. */
  ydsByPos: WeeklyYdsByPos;
  /** Air yards: QB pass; skill receiving. */
  airYdsByPos: WeeklyYdsByPos;
  /** Rushing yards for QB/RB/WR/TE. */
  rushYdsByPos: WeeklyYdsByPos;
  /** Season air TDs: QB pass; skill receiving. */
  airTdsByPos: SeasonTdsByPos;
  /** Season rushing TDs by position. */
  rushTdsByPos: SeasonTdsByPos;
  /** @deprecated use airTdsByPos.get('QB') */
  qbPassTds: QbPassTdsByDef;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Season yards / games with data → yards per game. */
export function yardsPerGameFromWeeks(
  byWeek: Map<number, number> | undefined
): number | undefined {
  if (!byWeek || byWeek.size === 0) return undefined;
  let total = 0;
  for (const y of byWeek.values()) total += y;
  return round1(total / byWeek.size);
}

/**
 * Rank among teams: 1 = lowest value (toughest / fewest allowed).
 * Ties break alphabetically by team for stability.
 */
export function rankAscending(
  values: Map<string, number>,
  team: string
): number | undefined {
  if (!values.has(team)) return undefined;
  const ranked = [...values.entries()].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
  );
  const idx = ranked.findIndex(([t]) => t === team);
  return idx >= 0 ? idx + 1 : undefined;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

/**
 * Average of the last ≤3 completed weeks' FPA for a defense vs a position.
 * Weeks with no data are skipped; returns undefined if none.
 */
export function averageLast3FpAllowed(
  byWeek: Map<number, number> | undefined,
  completedWeeks: number,
  window = 3
): number | undefined {
  if (!byWeek || byWeek.size === 0 || completedWeeks <= 0) return undefined;
  const vals: number[] = [];
  for (let w = completedWeeks; w >= 1 && vals.length < window; w--) {
    const pts = byWeek.get(w);
    if (pts == null || !Number.isFinite(pts)) continue;
    vals.push(pts);
  }
  if (vals.length === 0) return undefined;
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function addWeekValue(
  map: WeeklyFpaByPos,
  pos: string,
  def: string,
  week: number,
  value: number
): void {
  let byDef = map.get(pos);
  if (!byDef) {
    byDef = new Map();
    map.set(pos, byDef);
  }
  let byWeek = byDef.get(def);
  if (!byWeek) {
    byWeek = new Map();
    byDef.set(def, byWeek);
  }
  byWeek.set(week, (byWeek.get(week) ?? 0) + value);
}

function addSeasonTd(map: SeasonTdsByPos, pos: string, def: string, n: number): void {
  if (!Number.isFinite(n) || n <= 0) return;
  let byDef = map.get(pos);
  if (!byDef) {
    byDef = new Map();
    map.set(pos, byDef);
  }
  byDef.set(def, (byDef.get(def) ?? 0) + n);
}

function emptyWeekly(): WeeklyDefenseAllowed {
  return {
    fpaByPos: new Map(),
    ydsByPos: new Map(),
    airYdsByPos: new Map(),
    rushYdsByPos: new Map(),
    airTdsByPos: new Map(),
    rushTdsByPos: new Map(),
    qbPassTds: new Map(),
  };
}

/** Summarize weekly yards board → season ypg + L3 + ranks for one opponent. */
function summarizeYardsBoard(
  byDef: Map<string, Map<number, number>> | undefined,
  opponent: string,
  completedWeeks: number
): {
  ypg?: number;
  ypgRank?: number;
  l3?: number;
  l3Rank?: number;
} {
  if (!byDef) return {};
  const ypgByTeam = new Map<string, number>();
  const l3ByTeam = new Map<string, number>();
  for (const [def, byWeek] of byDef) {
    const ypg = yardsPerGameFromWeeks(byWeek);
    if (ypg != null) ypgByTeam.set(def, ypg);
    const l3 = averageLast3FpAllowed(byWeek, completedWeeks);
    if (l3 != null) l3ByTeam.set(def, l3);
  }
  return {
    ypg: ypgByTeam.get(opponent),
    ypgRank: rankAscending(ypgByTeam, opponent),
    l3: l3ByTeam.get(opponent),
    l3Rank: rankAscending(l3ByTeam, opponent),
  };
}

/**
 * Load weekly PPR + yards/TDs allowed from nflverse weekly stats.
 * Air = pass (QB) / receiving (skill); rush tracked separately.
 */
export async function loadWeeklyDefenseAllowed(season: number): Promise<WeeklyDefenseAllowed> {
  const out = emptyWeekly();
  const cachePath = path.join(CACHE_DIR, `player_stats_week_${season}.csv`);
  let text: string;
  try {
    text = await fs.readFile(cachePath, 'utf-8');
  } catch {
    return out;
  }
  const rows = parseCsv(text);
  if (rows.length < 2) return out;
  const h = rows[0].map((x) => x.toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = h.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iPos = col('position');
  const iWeek = col('week');
  const iOpp = col('opponent_team', 'opponent');
  const iPpr = col('fantasy_points_ppr');
  const iPassYds = col('passing_yards');
  const iPassTd = col('passing_tds');
  const iRushYds = col('rushing_yards');
  const iRushTd = col('rushing_tds');
  const iRecYds = col('receiving_yards');
  const iRecTd = col('receiving_tds');
  const iSeasonType = col('season_type');
  if (iPos < 0 || iWeek < 0 || iOpp < 0 || iPpr < 0) return out;

  for (const row of rows.slice(1)) {
    const seasonType = iSeasonType >= 0 ? (row[iSeasonType] ?? '').toUpperCase() : 'REG';
    if (seasonType && seasonType !== 'REG') continue;
    const pos = (row[iPos] ?? '').trim().toUpperCase();
    if (!SKILL.has(pos)) continue;
    const week = Number(row[iWeek]);
    if (!Number.isFinite(week) || week < 1) continue;
    const def = canonicalTeam(row[iOpp]);
    if (!def) continue;
    const pts = Number(row[iPpr]);
    if (Number.isFinite(pts)) addWeekValue(out.fpaByPos, pos, def, week, pts);

    const rushYds = iRushYds >= 0 ? Number(row[iRushYds]) : NaN;
    const rushTd = iRushTd >= 0 ? Number(row[iRushTd]) : NaN;
    if (Number.isFinite(rushYds) && rushYds !== 0) {
      addWeekValue(out.rushYdsByPos, pos, def, week, rushYds);
    }
    if (Number.isFinite(rushTd) && rushTd > 0) {
      addSeasonTd(out.rushTdsByPos, pos, def, rushTd);
    }

    if (pos === 'QB') {
      const passYds = iPassYds >= 0 ? Number(row[iPassYds]) : NaN;
      if (Number.isFinite(passYds)) {
        addWeekValue(out.airYdsByPos, pos, def, week, passYds);
        addWeekValue(out.ydsByPos, pos, def, week, passYds);
      }
      const passTd = iPassTd >= 0 ? Number(row[iPassTd]) : NaN;
      if (Number.isFinite(passTd) && passTd > 0) {
        addSeasonTd(out.airTdsByPos, pos, def, passTd);
        out.qbPassTds.set(def, (out.qbPassTds.get(def) ?? 0) + passTd);
      }
    } else {
      const recYds = iRecYds >= 0 ? Number(row[iRecYds]) : NaN;
      const recTd = iRecTd >= 0 ? Number(row[iRecTd]) : NaN;
      if (Number.isFinite(recYds) && recYds !== 0) {
        addWeekValue(out.airYdsByPos, pos, def, week, recYds);
      }
      if (Number.isFinite(recTd) && recTd > 0) {
        addSeasonTd(out.airTdsByPos, pos, def, recTd);
      }
      const rush = Number.isFinite(rushYds) ? rushYds : 0;
      const rec = Number.isFinite(recYds) ? recYds : 0;
      const combined = rush + rec;
      if (combined !== 0 || Number.isFinite(rushYds) || Number.isFinite(recYds)) {
        addWeekValue(out.ydsByPos, pos, def, week, combined);
      }
    }
  }
  return out;
}

/** @deprecated use loadWeeklyDefenseAllowed */
export async function loadWeeklyFpaByPos(season: number): Promise<WeeklyFpaByPos> {
  return (await loadWeeklyDefenseAllowed(season)).fpaByPos;
}

/** Empty weekly payload for tests / callers that only stub FPA. */
export function emptyWeeklyDefenseAllowed(
  partial?: Partial<WeeklyDefenseAllowed>
): WeeklyDefenseAllowed {
  return { ...emptyWeekly(), ...partial };
}

export function buildVsPosMatchup(input: {
  opponent?: string;
  bye?: boolean;
  position: Position;
  season: number;
  completedWeeks: number;
  ranks: EspnOprkMatrix | null;
  averages: EspnOprkAverageMatrix | null;
  weekly?: WeeklyDefenseAllowed | null;
  /** @deprecated prefer `weekly.fpaByPos` */
  weeklyFpa?: WeeklyFpaByPos | null;
  /** Precomputed OPRK when enrich already resolved a fallback. */
  oppRank?: number;
}): VsPosMatchup | undefined {
  if (input.bye || !input.opponent) return undefined;
  const opponent = canonicalTeam(input.opponent) ?? input.opponent.toUpperCase();
  const position = input.position;
  const weekly = input.weekly
    ? emptyWeeklyDefenseAllowed(input.weekly)
    : input.weeklyFpa
      ? emptyWeeklyDefenseAllowed({ fpaByPos: input.weeklyFpa })
      : null;
  const weeklyFpa = weekly?.fpaByPos ?? null;

  let oprkRank = input.oppRank;
  if (oprkRank == null && input.ranks) {
    oprkRank = espnOprkFor(input.ranks, position, opponent);
  }

  let fpAllowedPerGame: number | undefined;
  let fpAllowedRank: number | undefined;
  if (input.averages) {
    fpAllowedPerGame = espnOprkAverageFor(input.averages, position, opponent);
    const byTeam = input.averages.get(position);
    if (byTeam) fpAllowedRank = rankAscending(byTeam, opponent);
  }

  let last3FpAllowed: number | undefined;
  let last3FpAllowedRank: number | undefined;
  if (weeklyFpa && SKILL.has(position)) {
    const byDef = weeklyFpa.get(position);
    if (byDef) {
      const last3ByTeam = new Map<string, number>();
      for (const [def, byWeek] of byDef) {
        const avg = averageLast3FpAllowed(byWeek, input.completedWeeks);
        if (avg != null) last3ByTeam.set(def, avg);
      }
      last3FpAllowed = last3ByTeam.get(opponent);
      last3FpAllowedRank = rankAscending(last3ByTeam, opponent);
    }
  }

  let yardsAllowedPerGame: number | undefined;
  let yardsAllowedRank: number | undefined;
  let last3YardsAllowed: number | undefined;
  let last3YardsAllowedRank: number | undefined;
  let tdsAllowed: number | undefined;
  let tdsAllowedRank: number | undefined;
  let airYardsPerGame: number | undefined;
  let airYardsRank: number | undefined;
  let last3AirYards: number | undefined;
  let last3AirYardsRank: number | undefined;
  let airTds: number | undefined;
  let airTdsRank: number | undefined;
  let rushYardsPerGame: number | undefined;
  let rushYardsRank: number | undefined;
  let last3RushYards: number | undefined;
  let last3RushYardsRank: number | undefined;
  let rushTds: number | undefined;
  let rushTdsRank: number | undefined;

  if (weekly && SKILL.has(position)) {
    const air = summarizeYardsBoard(
      weekly.airYdsByPos.get(position),
      opponent,
      input.completedWeeks
    );
    airYardsPerGame = air.ypg;
    airYardsRank = air.ypgRank;
    last3AirYards = air.l3;
    last3AirYardsRank = air.l3Rank;

    const rush = summarizeYardsBoard(
      weekly.rushYdsByPos.get(position),
      opponent,
      input.completedWeeks
    );
    rushYardsPerGame = rush.ypg;
    rushYardsRank = rush.ypgRank;
    last3RushYards = rush.l3;
    last3RushYardsRank = rush.l3Rank;

    const combined = summarizeYardsBoard(
      weekly.ydsByPos.get(position),
      opponent,
      input.completedWeeks
    );
    // Legacy combined L3 (skill) / air L3 (QB) for older fields.
    last3YardsAllowed = combined.l3 ?? air.l3;
    last3YardsAllowedRank = combined.l3 != null ? combined.l3Rank : air.l3Rank;

    const airTdBoard = weekly.airTdsByPos.get(position);
    if (airTdBoard) {
      airTds = airTdBoard.get(opponent);
      airTdsRank = rankAscending(airTdBoard, opponent);
    } else if (position === 'QB' && weekly.qbPassTds.size > 0) {
      airTds = weekly.qbPassTds.get(opponent);
      airTdsRank = rankAscending(weekly.qbPassTds, opponent);
    }

    const rushTdBoard = weekly.rushTdsByPos.get(position);
    if (rushTdBoard) {
      rushTds = rushTdBoard.get(opponent);
      rushTdsRank = rankAscending(rushTdBoard, opponent);
    }

    if (position === 'QB') {
      yardsAllowedPerGame = airYardsPerGame;
      yardsAllowedRank = airYardsRank;
      const totalByTeam = new Map<string, number>();
      const airBoard = weekly.airTdsByPos.get('QB') ?? weekly.qbPassTds;
      const rushBoard = weekly.rushTdsByPos.get('QB');
      const teams = new Set<string>([
        ...airBoard.keys(),
        ...(rushBoard ? rushBoard.keys() : []),
      ]);
      for (const t of teams) {
        totalByTeam.set(t, (airBoard.get(t) ?? 0) + (rushBoard?.get(t) ?? 0));
      }
      tdsAllowed = totalByTeam.get(opponent);
      tdsAllowedRank = rankAscending(totalByTeam, opponent);
    }
  }

  if (position !== 'QB' && SKILL.has(position)) {
    const def = enrichmentStore.getTdDefense(opponent, position, input.season);
    const ypg = perGame(def?.yds, def?.games);
    if (ypg != null) yardsAllowedPerGame = round1(ypg);
    if (def?.tds != null) tdsAllowed = def.tds;
    const board = enrichmentStore.listTdDefense(input.season, position);
    if (board.length > 0) {
      const ydsByTeam = new Map<string, number>();
      const tdsByTeam = new Map<string, number>();
      for (const row of board) {
        const pg = perGame(row.yds, row.games);
        if (pg != null) ydsByTeam.set(row.team, pg);
        tdsByTeam.set(row.team, row.tds);
      }
      yardsAllowedRank = rankAscending(ydsByTeam, opponent);
      tdsAllowedRank = rankAscending(tdsByTeam, opponent);
    }
  }

  return {
    opponent,
    position,
    oprkRank,
    fpAllowedPerGame,
    fpAllowedRank,
    last3FpAllowed,
    last3FpAllowedRank,
    yardsAllowedPerGame,
    yardsAllowedRank,
    last3YardsAllowed,
    last3YardsAllowedRank,
    tdsAllowed,
    tdsAllowedRank,
    airYardsPerGame,
    airYardsRank,
    last3AirYards,
    last3AirYardsRank,
    airTds,
    airTdsRank,
    rushYardsPerGame,
    rushYardsRank,
    last3RushYards,
    last3RushYardsRank,
    rushTds,
    rushTdsRank,
  };
}
