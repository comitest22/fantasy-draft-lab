import fs from 'fs/promises';
import path from 'path';
import { canonicalTeam, enrichmentStore } from '../data/enrichment';
import { enrichmentDir } from '../data/store';
import {
  buildContextInput,
  contextAdjustment,
  type ForecastRow,
  type TeamContextRow,
  type VenueInfo,
} from './gameContext';
import {
  formatGameScore,
  isConvertedResultPct,
  isKeptProjection,
  normalizePgFutureCell,
  resultFromScores,
} from './pgFuture';
import { week1SeedWinPct } from './pgWeek1Seed';

export type SurvivorMode = 'win' | 'lose';

export interface SurvivorFutureCell {
  week: number;
  winPct: number | null;
  losePct: number | null;
  opp: string;
  bye: boolean;
  result?: 'W' | 'L' | null;
  score?: string | null;
  locked?: boolean;
}

export interface SurvivorWeekTeam {
  team: string;
  teamName: string;
  opponent: string;
  home: boolean;
  matchupLabel: string;
  pgWinPct: number | null;
  pgLosePct: number | null;
  marketWinPct: number | null;
  moneyline: string;
  spread: number | null;
  popularityPct: number | null;
  ev: number | null;
  futureValue: number | null;
  gameNotes: string[];
  contextNotes: string[];
  contextAdj: number | null;
  bye: boolean;
  pickRank: number | null;
  recommended: boolean;
  reason: string;
}

export interface SurvivorSeasonCell {
  week: number;
  winPct: number | null;
  losePct: number | null;
  opp: string;
  bye: boolean;
  result?: 'W' | 'L' | null;
  score?: string | null;
  locked?: boolean;
}

export interface SurvivorSeasonRow {
  team: string;
  teamName: string;
  futureValue: number | null;
  cells: SurvivorSeasonCell[];
}

export interface SurvivorBoard {
  mode: SurvivorMode;
  season: 2026;
  currentWeek: number;
  /** Selected week still has stored Mkt/ML/Pop/EV from when it was current. */
  weekHasLines: boolean;
  lastUpdated: string | null;
  pulledAt: string | null;
  source: string;
  sourceNote: string;
  weeks: number[];
  week: SurvivorWeekTeam[];
  seasonRows: SurvivorSeasonRow[];
  picks: SurvivorWeekTeam[];
}

/** Per-week PoolGenius board fields (Mkt / ML / Pop / EV) kept after the slate advances. */
export type PgWeekBoardSnap = {
  opponent: string;
  home: boolean;
  matchupLabel: string;
  pgWinPct: number | null;
  marketWinPct: number | null;
  moneyline: string;
  spread: number | null;
  popularityPct: number | null;
  ev: number | null;
  gameNotes: string[];
};

type FileTeam = {
  team: string;
  teamName: string;
  opponent: string;
  home: boolean;
  matchupLabel: string;
  pgWinPct: number | null;
  marketWinPct: number | null;
  moneyline: string;
  spread: number | null;
  popularityPct: number | null;
  ev: number | null;
  futureValue: number | null;
  gameNotes: string[];
  /** week number → board lines from when that week was current */
  weekBoards?: Record<string, PgWeekBoardSnap>;
  future: Array<{
    week: number;
    winPct: number | null;
    opp: string;
    bye: boolean;
    result?: 'W' | 'L' | null;
    score?: string | null;
    locked?: boolean;
  }>;
};

type FilePayload = {
  pulledAt?: string;
  lastUpdated?: string | null;
  week?: number;
  source?: string;
  teams: FileTeam[];
};

const FILE = 'poolgenius-survivor-2026.json';
const VENUES = 'nfl-venues.json';
const CONTEXT = 'game-context-2026.json';

export type ContextAssets = {
  venues: Record<string, VenueInfo>;
  teams: Record<string, TeamContextRow>;
  forecasts: Record<string, ForecastRow>;
};

export async function loadContextAssets(): Promise<ContextAssets> {
  const dir = enrichmentDir();
  let venues: Record<string, VenueInfo> = {};
  let teams: Record<string, TeamContextRow> = {};
  let forecasts: Record<string, ForecastRow> = {};
  try {
    venues = JSON.parse(await fs.readFile(path.join(dir, VENUES), 'utf8')) as Record<string, VenueInfo>;
  } catch {
    venues = {};
  }
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, CONTEXT), 'utf8')) as {
      teams?: Record<string, TeamContextRow>;
      forecasts?: Record<string, ForecastRow>;
    };
    teams = raw.teams ?? {};
    forecasts = raw.forecasts ?? {};
  } catch {
    teams = {};
    forecasts = {};
  }
  return { venues, teams, forecasts };
}

function contextFor(
  team: string,
  week: number,
  assets: ContextAssets
): { adj: number; notes: string[] } {
  const all = enrichmentStore.getTeamSchedule(team);
  const game = all.find((g) => g.week === week);
  if (!game) return { adj: 0, notes: [] };
  const key = canonicalTeam(team) ?? team;
  const input = buildContextInput({
    game,
    games: all,
    venues: assets.venues,
    teamRow: assets.teams[key],
    forecast: assets.forecasts[`${week}:${key}`],
  });
  if (!input) return { adj: 0, notes: [] };
  return contextAdjustment(input, 'win');
}

function losePct(win: number | null): number | null {
  return win == null ? null : Math.round((100 - win) * 10) / 10;
}

function cellFor(team: FileTeam, week: number) {
  const raw = team.future.find((c) => c.week === week);
  return raw ? normalizePgFutureCell(raw) : undefined;
}

function scheduleOppLabel(game: {
  bye?: boolean;
  opponent?: string;
  home?: boolean;
} | undefined): string | undefined {
  if (!game) return undefined;
  if (game.bye || !game.opponent) return 'BYE';
  return game.home === false ? `@${game.opponent}` : game.opponent;
}

function overlaySchedule(team: string, week: number, cell: ReturnType<typeof cellFor>) {
  const game = enrichmentStore.getScheduleGame(team, week);
  const fromGame = game?.status === 'FINAL' && !game.bye
    ? {
        result: resultFromScores(game.teamScore, game.oppScore),
        score: formatGameScore(game.teamScore, game.oppScore),
      }
    : { result: null as 'W' | 'L' | null, score: null as string | null };
  const result = fromGame.result ?? cell?.result ?? null;
  const score = fromGame.score ?? cell?.score ?? null;
  const stored = cell?.winPct ?? null;
  let winPct =
    cell?.locked && isKeptProjection(stored, result)
      ? stored
      : isKeptProjection(stored, result)
        ? stored
        : isConvertedResultPct(stored, result)
          ? null
          : stored;
  if (winPct == null && week === 1 && !cell?.bye) {
    winPct = week1SeedWinPct(team);
  }
  const schedOpp = scheduleOppLabel(game);
  const bye = Boolean(game?.bye || schedOpp === 'BYE' || cell?.bye);
  return {
    week,
    winPct: bye ? null : winPct,
    losePct: bye ? null : losePct(winPct),
    opp: bye ? 'BYE' : schedOpp || cell?.opp || '',
    bye,
    result: bye ? null : result,
    score: bye ? null : score,
    locked: Boolean((cell?.locked && winPct != null) || (week === 1 && winPct != null && result != null)),
  };
}

function weekBoardSnap(team: FileTeam, week: number, currentWeek: number): PgWeekBoardSnap | undefined {
  const stored = team.weekBoards?.[String(week)];
  if (stored) return stored;
  if (week !== currentWeek) return undefined;
  return {
    opponent: team.opponent,
    home: team.home,
    matchupLabel: team.matchupLabel,
    pgWinPct: team.pgWinPct,
    marketWinPct: team.marketWinPct,
    moneyline: team.moneyline,
    spread: team.spread,
    popularityPct: team.popularityPct,
    ev: team.ev,
    gameNotes: team.gameNotes ?? [],
  };
}

function pickScore(
  mode: SurvivorMode,
  team: FileTeam,
  week: number,
  contextAdj = 0,
  currentWeek = week,
): number {
  const cell = cellFor(team, week);
  if (!cell || cell.bye || cell.winPct == null) return -Infinity;
  const signed = mode === 'lose' ? -contextAdj : contextAdj;
  const snap = weekBoardSnap(team, week, currentWeek);
  if (mode === 'win') {
    const ev = snap?.ev ?? (cell.winPct != null ? cell.winPct / 100 : 0);
    const pop = snap?.popularityPct ?? 0;
    const fv = team.futureValue ?? 0;
    return ev * 40 + cell.winPct - pop * 0.15 - fv * 2 + signed;
  }
  const lose = 100 - cell.winPct;
  const futureDogs = team.future
    .filter((c) => c.week > week && !c.bye && c.winPct != null)
    .map((c) => 100 - (c.winPct as number));
  const bestFutureDog = futureDogs.length ? Math.max(...futureDogs) : 0;
  return lose - bestFutureDog * 0.18 + signed;
}

function reason(
  mode: SurvivorMode,
  team: FileTeam,
  week: number,
  rank: number,
  contextNotes: string[] = [],
  currentWeek = week,
): string {
  const cell = cellFor(team, week);
  if (!cell || cell.bye) return 'Bye';
  const snap = weekBoardSnap(team, week, currentWeek);
  if (mode === 'win') {
    const bits = [
      cell.winPct != null ? `PG ${cell.winPct}%` : undefined,
      snap?.ev != null ? `EV ${snap.ev.toFixed(2)}` : undefined,
      snap?.popularityPct != null ? `${snap.popularityPct}% owned` : undefined,
      team.futureValue != null ? `FV ${team.futureValue}` : undefined,
      ...contextNotes,
    ].filter(Boolean);
    return rank <= 3 ? `Top pick · ${bits.join(' · ')}` : bits.join(' · ');
  }
  const lose = losePct(cell.winPct);
  const bits = [
    lose != null ? `${lose}% to lose` : undefined,
    cell.winPct != null ? `PG win ${cell.winPct}%` : undefined,
    ...contextNotes,
  ].filter(Boolean);
  return rank <= 3 ? `Top dog · ${bits.join(' · ')}` : bits.join(' · ');
}

export async function buildSurvivorBoard(mode: SurvivorMode, week?: number): Promise<SurvivorBoard> {
  await enrichmentStore.load();
  const raw = await fs.readFile(path.join(enrichmentDir(), FILE), 'utf8');
  const file = JSON.parse(raw) as FilePayload;
  const assets = await loadContextAssets();
  const currentWeek = file.week ?? enrichmentStore.currentWeek();
  const w = Math.min(18, Math.max(1, week ?? currentWeek));
  const ctxByTeam = new Map<string, { adj: number; notes: string[] }>();
  for (const team of file.teams) {
    ctxByTeam.set(team.team, contextFor(team.team, w, assets));
  }
  const scored = file.teams
    .map((team) => ({
      team,
      score: pickScore(mode, team, w, ctxByTeam.get(team.team)?.adj ?? 0, currentWeek),
    }))
    .sort((a, b) => b.score - a.score);
  const rankOf = new Map<string, number>();
  let rank = 0;
  for (const row of scored) {
    const cell = cellFor(row.team, w);
    if (!cell || cell.bye || row.score === -Infinity) continue;
    rank += 1;
    rankOf.set(row.team.team, rank);
  }

  const weekTeams: SurvivorWeekTeam[] = file.teams.map((team) => {
    const cell = overlaySchedule(team.team, w, cellFor(team, w));
    const bye = Boolean(cell.bye);
    const pickRank = bye ? null : (rankOf.get(team.team) ?? null);
    const snap = weekBoardSnap(team, w, currentWeek);
    const ctx = ctxByTeam.get(team.team) ?? { adj: 0, notes: [] };
    const signedAdj = mode === 'lose' ? -ctx.adj : ctx.adj;
    const matchupLabel =
      snap?.matchupLabel ||
      (cell.opp
        ? cell.opp.startsWith('@')
          ? `at ${cell.opp.slice(1)}`
          : `vs. ${cell.opp}`
        : '');
    return {
      team: team.team,
      teamName: team.teamName,
      opponent: snap?.opponent || cell.opp || team.opponent,
      home: snap?.home ?? !String(cell.opp ?? '').startsWith('@'),
      matchupLabel,
      pgWinPct: cell.winPct ?? snap?.pgWinPct ?? null,
      pgLosePct: cell.losePct,
      marketWinPct: snap?.marketWinPct ?? null,
      moneyline: snap?.moneyline ?? '',
      spread: snap?.spread ?? null,
      popularityPct: snap?.popularityPct ?? null,
      ev: snap?.ev ?? null,
      futureValue: team.futureValue,
      gameNotes: snap?.gameNotes ?? [],
      contextNotes: ctx.notes,
      contextAdj: bye ? null : Math.round(signedAdj * 10) / 10,
      bye,
      pickRank,
      recommended: pickRank != null && pickRank <= 3,
      reason: reason(mode, team, w, pickRank ?? 99, ctx.notes, currentWeek),
    };
  });

  weekTeams.sort((a, b) => {
    if (a.bye !== b.bye) return a.bye ? 1 : -1;
    return (a.pickRank ?? 99) - (b.pickRank ?? 99);
  });

  const seasonRows: SurvivorSeasonRow[] = file.teams.map((team) => ({
    team: team.team,
    teamName: team.teamName,
    futureValue: team.futureValue,
    cells: Array.from({ length: 18 }, (_, i) => overlaySchedule(team.team, i + 1, cellFor(team, i + 1))),
  }));

  seasonRows.sort((a, b) => (b.futureValue ?? 0) - (a.futureValue ?? 0) || a.team.localeCompare(b.team));

  const weekHasLines = weekTeams.some(
    (t) =>
      !t.bye &&
      (t.marketWinPct != null || t.ev != null || Boolean(t.moneyline) || t.popularityPct != null),
  );

  return {
    mode,
    season: 2026,
    currentWeek,
    weekHasLines,
    lastUpdated: file.lastUpdated ?? null,
    pulledAt: file.pulledAt ?? null,
    source: file.source ?? 'https://poolgenius.teamrankings.com/nfl-survivor-pool-picks/data-grid/',
    sourceNote:
      mode === 'win'
        ? 'Recommended picks follow PoolGenius Data Grid (win odds, popularity, EV, future value) with a small rest/travel/weather overlay.'
        : 'PoolGenius does not publish loser-pool ranks. This board inverts their win odds, then applies a small rest/travel/weather overlay: pick the team most likely to lose, and save sides with even worse future weeks.',
    weeks: Array.from({ length: 18 }, (_, i) => i + 1),
    week: weekTeams,
    seasonRows,
    picks: weekTeams.filter((t) => t.recommended),
  };
}
