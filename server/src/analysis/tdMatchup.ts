import { blendStat, currentSeasonWeight } from './sosBlend';
import type { Position } from '../types';

export type TdSkillPos = 'QB' | 'RB' | 'WR' | 'TE';

export interface TdPlayerSeason {
  playerName: string;
  season: number;
  position: TdSkillPos;
  team?: string;
  games: number;
  tds: number;
  yds: number;
  hitGames: number;
  teamTds: number;
  posTds: number;
  /** week → scoring TDs (rush+rec) that game. Missing week = DNP. */
  weeks: Map<number, number>;
}

export interface TdDefenseSeason {
  team: string;
  season: number;
  position: TdSkillPos;
  games: number;
  yds: number;
  tds: number;
  lastWeek?: number;
  lastYds?: number;
  lastTds?: number;
  lastOpp?: string;
}

export interface TdGameRow {
  playerName: string;
  season: number;
  week: number;
  position?: TdSkillPos;
  nflTeam?: string;
  opp: string;
  tds: number;
  /** true = player's team was the designated home side. */
  home?: boolean;
  rushAtt?: number;
  rushYds?: number;
  rec?: number;
  recYds?: number;
  targets?: number;
}

export interface TdHistoryView {
  totalTds: number;
  totalGames: number;
  last5Tds: number;
  last5Games: number;
  vsOppTds: number;
  vsOppGames: number;
  vsOppHits: number;
  vsOppHitPct?: number;
  vsOppRushAtt?: number;
  vsOppRushYds?: number;
  vsOppRec?: number;
  vsOppRecYds?: number;
  vsOppTargets?: number;
  vsOppLine?: string;
  vsOppHomeTds?: number;
  vsOppHomeGames?: number;
  vsOppHomeHits?: number;
  vsOppAwayTds?: number;
  vsOppAwayGames?: number;
  vsOppAwayHits?: number;
  /** Seasons in the sample, 1–5. `sampleYearsPlus` when the player’s NFL tenure is longer than 5. */
  sampleYears: number;
  sampleYearsPlus: boolean;
}

export interface TdMatchupView {
  tdChance?: number;
  matchupRank?: number;
  oppYdsPg?: number;
  oppTdsPg?: number;
  oppYdsRank?: number;
  oppTdsRank?: number;
  lastGameYds?: number;
  lastGameTds?: number;
  lastGameWeek?: number;
  lastGameOpp?: string;
  posTdShare?: number;
  hitRate?: number;
  scoredTd?: boolean | null;
  thisWeekHome?: boolean;
  vsVenueTds?: number;
  vsVenueGames?: number;
  vsVenueHits?: number;
}

/** Baseline P(≥1 rush/rec TD) by position before player/matchup nudges. */
export const POS_TD_BASE: Record<TdSkillPos, number> = {
  RB: 0.42,
  WR: 0.28,
  TE: 0.22,
  QB: 0.16,
};

export function asTdPos(position: string | undefined): TdSkillPos | undefined {
  const p = (position ?? '').toUpperCase();
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE') return p;
  if (p === 'FB') return 'RB';
  return undefined;
}

export function perGame(total: number | undefined, games: number | undefined): number | undefined {
  if (total == null || games == null || games <= 0) return undefined;
  return total / games;
}

export function share(part: number | undefined, whole: number | undefined): number | undefined {
  if (part == null || whole == null || whole <= 0) return undefined;
  return part / whole;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function estimateTdChance(input: {
  position: TdSkillPos;
  hitRate?: number;
  posShare?: number;
  oppTdsPg?: number;
  leagueAvgOppTdsPg?: number;
  teamWinPct?: number | null;
  lastWeekTds?: number;
  lastOppTds?: number;
  newTeamBellcow?: boolean;
  /** Hit rate in ≥2 prior games at this week's home/away venue vs this opponent. */
  vsVenueHitRate?: number;
  vsVenueGames?: number;
}): number {
  const base = POS_TD_BASE[input.position];
  const hit = input.hitRate != null ? clamp(input.hitRate, 0, 1) : base;
  const shrunk = 0.5 * hit + 0.5 * base;
  const shareAdj = clamp(((input.posShare ?? 0.35) - 0.35) * 0.18, -0.08, 0.12);
  const avg = input.leagueAvgOppTdsPg ?? 0.7;
  const matchAdj =
    input.oppTdsPg != null && avg > 0
      ? clamp(((input.oppTdsPg - avg) / Math.max(avg, 0.2)) * 0.1, -0.1, 0.12)
      : 0;
  const winAdj =
    input.teamWinPct != null ? clamp(((input.teamWinPct - 50) / 50) * 0.04, -0.04, 0.04) : 0;
  const lastWeekAdj =
    input.lastWeekTds != null && input.lastWeekTds > 0 ? clamp(input.lastWeekTds * 0.055, 0, 0.12) : 0;
  const lastOppAdj =
    input.lastOppTds != null ? clamp((input.lastOppTds - 0.7) * 0.045, -0.04, 0.08) : 0;
  const bellcowAdj = input.newTeamBellcow ? 0.05 : 0;
  const venueAdj =
    input.vsVenueGames != null && input.vsVenueGames >= 2 && input.vsVenueHitRate != null
      ? clamp((input.vsVenueHitRate - hit) * 0.12, -0.05, 0.06)
      : 0;
  return (
    Math.round(
      1000 *
        clamp(
          shrunk + shareAdj + matchAdj + winAdj + lastWeekAdj + lastOppAdj + bellcowAdj + venueAdj,
          0.08,
          0.72,
        ),
    ) / 10
  );
}

/** Rank 1 = most yards/TDs allowed (juiciest). */
export function ranksDesc(values: Map<string, number>): Map<string, number> {
  const ordered = [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = new Map<string, number>();
  ordered.forEach(([key], i) => out.set(key, i + 1));
  return out;
}

export function combinedMatchupRank(ydsRank?: number, tdsRank?: number): number | undefined {
  if (ydsRank == null && tdsRank == null) return undefined;
  if (ydsRank == null) return tdsRank;
  if (tdsRank == null) return ydsRank;
  return Math.round(0.4 * ydsRank + 0.6 * tdsRank);
}

export function blendRates(
  current: number | undefined,
  prior: number | undefined,
  completedWeeks: number,
): number | undefined {
  return blendStat(current, prior, currentSeasonWeight(completedWeeks));
}

export function scoredInWeek(
  player: TdPlayerSeason | undefined,
  week: number,
  completedWeeks: number,
): boolean | null {
  if (week > completedWeeks) return null;
  if (!player) return null;
  const tds = player.weeks.get(week);
  if (tds == null) return false;
  return tds > 0;
}

export function matchupLabel(rank?: number): string | undefined {
  if (rank == null) return undefined;
  if (rank <= 8) return 'Favorable matchup';
  if (rank <= 16) return 'Slightly favorable';
  if (rank <= 24) return 'Average matchup';
  return 'Tough matchup';
}

function posNoun(position: string): string {
  if (position === 'RB') return 'running backs';
  if (position === 'WR') return 'receivers';
  if (position === 'TE') return 'tight ends';
  if (position === 'QB') return 'quarterback rushing scores';
  return 'that position';
}

function posShort(position: string): string {
  if (position === 'RB') return 'RBs';
  if (position === 'WR') return 'receivers';
  if (position === 'TE') return 'tight ends';
  if (position === 'QB') return 'QB rushing TDs';
  return 'that position';
}

export function formatOppLine(opp?: string, teamWinPct?: number | null): string | undefined {
  if (!opp && teamWinPct == null) return undefined;
  const cleaned = (opp ?? '').replace(/^(w|l)\s+/i, '').replace(/\s*\(.*\)\s*$/, '').trim();
  const vs = !cleaned ? undefined : cleaned.startsWith('@') ? `at ${cleaned.slice(1)}` : `vs ${cleaned}`;
  const fav =
    teamWinPct == null
      ? undefined
      : teamWinPct >= 58
        ? `their team is a ${Math.round(teamWinPct)}% favorite`
        : teamWinPct <= 42
          ? `their team is an underdog (${Math.round(teamWinPct)}%)`
          : `their team is about a coin flip (${Math.round(teamWinPct)}%)`;
  if (vs && fav) return `${vs} — ${fav}`;
  return vs ?? (fav ? fav[0].toUpperCase() + fav.slice(1) : undefined);
}

/** Kickoff as Eastern weekday + date (`Sun, Sep 20`). */
export function formatKickoffDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(ms));
}

export const TD_HISTORY_YEARS = 5;

export interface HistoryWindow {
  years: number;
  plus: boolean;
}

/** NFL seasons covered by the lookback, capped at 5. Tenure over 5 (draft year or first game before the window) is `plus`. */
export function sampleYearsFromGames(
  games: { season: number }[],
  currentSeason?: number,
  enteredSeason?: number,
  cap = TD_HISTORY_YEARS,
): HistoryWindow {
  const firstFromGames = games.length ? Math.min(...games.map((g) => g.season)) : undefined;
  const first = enteredSeason ?? firstFromGames;
  if (first == null) return { years: cap, plus: false };
  const last = currentSeason ?? (games.length ? Math.max(...games.map((g) => g.season)) : first);
  const tenure = last - first + 1;
  if (tenure > cap) return { years: cap, plus: true };
  return { years: Math.min(cap, Math.max(1, tenure)), plus: false };
}

export function historyWindowCopy(years: number, plus = false): { paren: string; last: string; lastShort: string } {
  if (plus) return { paren: '5+ years', last: 'the last 5+ years', lastShort: 'Last 5+ yrs' };
  const n = Math.max(1, Math.round(years));
  if (n === 1) return { paren: '1 year', last: 'the last year', lastShort: 'Last 1 yr' };
  return { paren: `${n} years`, last: `the last ${n} years`, lastShort: `Last ${n} yrs` };
}

export function formatVenueSplit(input: {
  homeGames?: number;
  homeTds?: number;
  awayGames?: number;
  awayTds?: number;
  thisWeekHome?: boolean;
  opp?: string;
  years?: number;
  plus?: boolean;
}): string | undefined {
  const vs = canonOpp(input.opp);
  const vsBit = vs ? ` vs ${vs}` : '';
  const { last, lastShort } = historyWindowCopy(input.years ?? TD_HISTORY_YEARS, input.plus);
  const empty = (venue: 'home' | 'away') => `No ${venue} game in ${last}${vsBit}`;
  const bit = (venue: 'home' | 'away', games: number, tds: number) => {
    if (games <= 0) return empty(venue);
    const tdWord = tds === 1 ? 'TD' : 'TDs';
    const gameWord = games === 1 ? 'game' : 'games';
    return `${tds} ${tdWord} in ${games} ${venue} ${gameWord}${vsBit} (${lastShort})`;
  };
  if (input.thisWeekHome === true) return bit('home', input.homeGames ?? 0, input.homeTds ?? 0);
  if (input.thisWeekHome === false) return bit('away', input.awayGames ?? 0, input.awayTds ?? 0);
  const homeG = input.homeGames ?? 0;
  const awayG = input.awayGames ?? 0;
  if (homeG <= 0 && awayG <= 0) return undefined;
  const home = homeG > 0 ? bit('home', homeG, input.homeTds ?? 0) : empty('home');
  const away = awayG > 0 ? bit('away', awayG, input.awayTds ?? 0) : empty('away');
  return `${home} · ${away}`;
}

export function formatMatchupMeta(input: {
  opp?: string;
  thisWeekHome?: boolean;
  kickoff?: string;
}): string | undefined {
  const want = canonOpp(input.opp);
  const vs =
    !want
      ? undefined
      : input.thisWeekHome === false
        ? `at ${want}`
        : `vs ${want}`;
  const date = formatKickoffDate(input.kickoff);
  const bits = [vs, date].filter(Boolean);
  return bits.length ? bits.join(' · ') : undefined;
}

export function formatTdReason(
  m: TdMatchupView,
  input: { playerName: string; position: string; opp?: string },
): string {
  const pos = asTdPos(input.position) ?? 'RB';
  const noun = posNoun(pos);
  const vs = formatOppLine(input.opp);
  const parts: string[] = [];

  if (m.matchupRank != null) {
    const rankBit =
      m.matchupRank <= 8
        ? `one of the easier matchups against ${noun}`
        : m.matchupRank <= 16
          ? `a slightly easier matchup against ${noun}`
          : m.matchupRank <= 24
            ? `an average matchup against ${noun}`
            : `a tough matchup against ${noun}`;
    const tdBit =
      m.oppTdsPg != null
        ? m.oppTdsPg >= 1.1
          ? `this defense has been leaking scores (${m.oppTdsPg.toFixed(1)} TDs/game)`
          : m.oppTdsPg <= 0.5
            ? `this defense has been stingy (${m.oppTdsPg.toFixed(1)} TDs/game)`
            : undefined
        : undefined;
    const lead = vs ? `This week ${vs} is ${rankBit}` : `This is ${rankBit}`;
    parts.push(tdBit ? `${lead} — ${tdBit}.` : `${lead}.`);
  } else if (vs) {
    parts.push(`This week ${vs}.`);
  }

  const why: string[] = [];
  if (m.hitRate != null) {
    const pct = Math.round(m.hitRate * 100);
    if (pct >= 55) why.push(`he finds the end zone often (about ${pct}% of games)`);
    else if (pct <= 30) why.push(`he is more of a boom-or-bust scorer (about ${pct}% of games)`);
    else why.push(`he scores in about ${pct}% of games`);
  }
  if (m.posTdShare != null && m.posTdShare >= 0.55) {
    why.push(`he takes most of the team's ${pos === 'QB' ? 'QB rushing' : pos} scores`);
  }
  if (why.length) {
    const text = why.join(', and ');
    parts.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`);
  }

  if (m.lastGameTds != null) {
    if (m.lastGameTds >= 2) parts.push(`Last game this defense allowed ${m.lastGameTds} TDs to ${posShort(pos)}.`);
    else if (m.lastGameTds === 0) parts.push(`Last game they did not allow a TD to ${posShort(pos)}.`);
  }

  const venueOpp = canonOpp(input.opp);
  if (venueOpp && m.vsVenueGames != null && m.vsVenueGames > 0 && m.thisWeekHome != null) {
    const where = m.thisWeekHome ? 'At home' : 'On the road';
    const tds = m.vsVenueTds ?? 0;
    const gameWord = m.vsVenueGames === 1 ? 'game' : 'games';
    parts.push(`${where} vs ${venueOpp} he has ${tds} TD in ${m.vsVenueGames} ${gameWord}.`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function formatMatchupLine(m: TdMatchupView, position: string): string | undefined {
  const bits: string[] = [];
  if (m.oppTdsPg != null || m.oppYdsPg != null) {
    const td = m.oppTdsPg != null ? `${m.oppTdsPg.toFixed(1)} TD/g` : undefined;
    const yd = m.oppYdsPg != null ? `${Math.round(m.oppYdsPg)} yd/g` : undefined;
    const rank =
      m.oppTdsRank != null || m.oppYdsRank != null
        ? `(TD #${m.oppTdsRank ?? '—'} / yd #${m.oppYdsRank ?? '—'})`
        : undefined;
    bits.push([td, yd, rank].filter(Boolean).join(' '));
  }
  if (m.lastGameTds != null || m.lastGameYds != null) {
    bits.push(`last game ${m.lastGameTds ?? 0} TD / ${Math.round(m.lastGameYds ?? 0)} yd`);
  }
  if (m.posTdShare != null) bits.push(`${Math.round(m.posTdShare * 100)}% of team ${position} TDs`);
  if (m.hitRate != null) bits.push(`hit ${Math.round(m.hitRate * 100)}%`);
  return bits.length ? bits.join(' · ') : undefined;
}

export function buildMatchup(input: {
  position: Position | string;
  priorPlayer?: TdPlayerSeason;
  ytdPlayer?: TdPlayerSeason;
  priorDef?: TdDefenseSeason;
  ytdDef?: TdDefenseSeason;
  oppYdsRank?: number;
  oppTdsRank?: number;
  leagueAvgOppTdsPg?: number;
  teamWinPct?: number | null;
  week: number;
  completedWeeks: number;
  thisWeekHome?: boolean;
  vsVenueHitRate?: number;
  vsVenueGames?: number;
  vsVenueTds?: number;
  vsVenueHits?: number;
}): TdMatchupView {
  const pos = asTdPos(input.position);
  if (!pos) return {};
  const w = currentSeasonWeight(input.completedWeeks);
  const hitRate = blendRates(
    perGame(input.ytdPlayer?.hitGames, input.ytdPlayer?.games),
    perGame(input.priorPlayer?.hitGames, input.priorPlayer?.games),
    input.completedWeeks,
  );
  const posTdShare = blendRates(
    share(input.ytdPlayer?.tds, input.ytdPlayer?.posTds),
    share(input.priorPlayer?.tds, input.priorPlayer?.posTds),
    input.completedWeeks,
  );
  const oppYdsPg = blendStat(
    perGame(input.ytdDef?.yds, input.ytdDef?.games),
    perGame(input.priorDef?.yds, input.priorDef?.games),
    w,
  );
  const oppTdsPg = blendStat(
    perGame(input.ytdDef?.tds, input.ytdDef?.games),
    perGame(input.priorDef?.tds, input.priorDef?.games),
    w,
  );
  const last =
    input.ytdDef?.lastWeek != null
      ? input.ytdDef
      : input.priorDef?.lastWeek != null
        ? input.priorDef
        : undefined;
  const lastWeekTds =
    input.completedWeeks > 0 ? input.ytdPlayer?.weeks.get(input.completedWeeks) : undefined;
  const newTeamBellcow = Boolean(
    input.ytdPlayer?.team &&
      input.priorPlayer?.team &&
      input.ytdPlayer.team !== input.priorPlayer.team &&
      (posTdShare ?? 0) >= 0.55,
  );
  const matchupRank = combinedMatchupRank(input.oppYdsRank, input.oppTdsRank);
  const tdChance = estimateTdChance({
    position: pos,
    hitRate,
    posShare: posTdShare,
    oppTdsPg,
    leagueAvgOppTdsPg: input.leagueAvgOppTdsPg,
    teamWinPct: input.teamWinPct,
    lastWeekTds,
    lastOppTds: last?.lastTds,
    newTeamBellcow,
    vsVenueHitRate: input.vsVenueHitRate,
    vsVenueGames: input.vsVenueGames,
  });
  return {
    tdChance,
    matchupRank,
    oppYdsPg: oppYdsPg != null ? Math.round(oppYdsPg * 10) / 10 : undefined,
    oppTdsPg: oppTdsPg != null ? Math.round(oppTdsPg * 100) / 100 : undefined,
    oppYdsRank: input.oppYdsRank,
    oppTdsRank: input.oppTdsRank,
    lastGameYds: last?.lastYds,
    lastGameTds: last?.lastTds,
    lastGameWeek: last?.lastWeek,
    lastGameOpp: last?.lastOpp,
    posTdShare: posTdShare != null ? Math.round(posTdShare * 1000) / 1000 : undefined,
    hitRate: hitRate != null ? Math.round(hitRate * 1000) / 1000 : undefined,
    scoredTd: scoredInWeek(input.ytdPlayer, input.week, input.completedWeeks),
    thisWeekHome: input.thisWeekHome,
    vsVenueTds: input.vsVenueTds,
    vsVenueGames: input.vsVenueGames,
    vsVenueHits: input.vsVenueHits,
  };
}

const OPP_ALIASES: Record<string, string> = {
  LAR: 'LA',
  STL: 'LA',
  JAC: 'JAX',
  WSH: 'WAS',
  GBP: 'GB',
  GNB: 'GB',
  SFO: 'SF',
  TAM: 'TB',
  NWE: 'NE',
  NOR: 'NO',
  KAN: 'KC',
  LVR: 'LV',
  OAK: 'LV',
  ARZ: 'ARI',
  SD: 'LAC',
};

export function canonOpp(raw?: string): string | undefined {
  if (!raw) return undefined;
  const key = raw
    .replace(/^@/, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/^(vs|at)\s+/i, '')
    .replace(/^(w|l)\s+/i, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!key || key === 'BYE') return undefined;
  return OPP_ALIASES[key] ?? key;
}

export function summarizeTdHistory(
  games: TdGameRow[],
  opp?: string,
  currentSeason?: number,
  enteredSeason?: number,
): TdHistoryView {
  const sorted = [...games].sort((a, b) => b.season - a.season || b.week - a.week);
  const last5 = sorted.slice(0, 5);
  const want = canonOpp(opp);
  const vs = want ? games.filter((g) => canonOpp(g.opp) === want) : [];
  const vsHits = vs.filter((g) => g.tds > 0).length;
  const n = vs.length;
  const avg = (pick: (g: TdGameRow) => number | undefined) => {
    if (!n) return undefined;
    const vals = vs.map(pick).filter((v): v is number => v != null);
    if (!vals.length) return undefined;
    return Math.round((vals.reduce((sum, v) => sum + v, 0) / vals.length) * 10) / 10;
  };
  const vsOppRushAtt = avg((g) => g.rushAtt);
  const vsOppRushYds = avg((g) => g.rushYds);
  const vsOppRec = avg((g) => g.rec);
  const vsOppRecYds = avg((g) => g.recYds);
  const vsOppTargets = avg((g) => g.targets);
  const vsOppTds = vs.reduce((sum, g) => sum + g.tds, 0);
  const vsOppHitPct = n ? Math.round((vsHits / n) * 1000) / 10 : undefined;
  const position = vs[0]?.position ?? sorted[0]?.position;
  const home = vs.filter((g) => g.home === true);
  const away = vs.filter((g) => g.home === false);
  const vsOppHomeTds = home.reduce((sum, g) => sum + g.tds, 0);
  const vsOppAwayTds = away.reduce((sum, g) => sum + g.tds, 0);
  const window = sampleYearsFromGames(games, currentSeason, enteredSeason);
  return {
    totalTds: games.reduce((sum, g) => sum + g.tds, 0),
    totalGames: games.length,
    last5Tds: last5.reduce((sum, g) => sum + g.tds, 0),
    last5Games: last5.length,
    vsOppTds,
    vsOppGames: n,
    vsOppHits: vsHits,
    vsOppHitPct,
    vsOppHomeTds,
    vsOppHomeGames: home.length,
    vsOppHomeHits: home.filter((g) => g.tds > 0).length,
    vsOppAwayTds,
    vsOppAwayGames: away.length,
    vsOppAwayHits: away.filter((g) => g.tds > 0).length,
    sampleYears: window.years,
    sampleYearsPlus: window.plus,
    vsOppRushAtt,
    vsOppRushYds,
    vsOppRec,
    vsOppRecYds,
    vsOppTargets,
    vsOppLine: want
      ? formatVsOppLine({
          opp: want,
          games: n,
          tds: vsOppTds,
          hitPct: vsOppHitPct,
          rushAtt: vsOppRushAtt,
          rushYds: vsOppRushYds,
          rec: vsOppRec,
          recYds: vsOppRecYds,
          targets: vsOppTargets,
          position,
        })
      : undefined,
  };
}

function statNum(n: number | undefined): string | undefined {
  if (n == null) return undefined;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatVsOppLine(input: {
  opp: string;
  games: number;
  tds: number;
  hitPct?: number;
  rushAtt?: number;
  rushYds?: number;
  rec?: number;
  recYds?: number;
  targets?: number;
  position?: string;
}): string | undefined {
  if (!input.games) return undefined;
  const gameWord = input.games === 1 ? 'game' : 'games';
  const pct = input.hitPct != null ? ` · ${Math.round(input.hitPct)}% of games` : '';
  const pos = (input.position ?? '').toUpperCase();
  const bits: string[] = [];
  if (pos === 'WR' || pos === 'TE') {
    const rec = statNum(input.rec);
    const tgt = statNum(input.targets);
    const yds = statNum(input.recYds);
    if (rec || tgt || yds) {
      bits.push([rec ? `${rec} rec` : null, tgt ? `${tgt} tgt` : null, yds ? `${yds} yds` : null].filter(Boolean).join(' / '));
    }
  } else if (pos === 'QB') {
    const att = statNum(input.rushAtt);
    const yds = statNum(input.rushYds);
    if (att || yds) bits.push([att ? `${att} car` : null, yds ? `${yds} rush yds` : null].filter(Boolean).join(' / '));
  } else {
    const att = statNum(input.rushAtt);
    const rushYds = statNum(input.rushYds);
    const rec = statNum(input.rec);
    const recYds = statNum(input.recYds);
    if (att || rushYds) bits.push([att ? `${att} car` : null, rushYds ? `${rushYds} yds` : null].filter(Boolean).join(' / '));
    if (rec || recYds) bits.push([rec ? `${rec} rec` : null, recYds ? `${recYds} yds` : null].filter(Boolean).join(' / '));
  }
  const extra = bits.length ? ` · ${bits.join(' · ')}${input.games > 1 ? ' avg' : ''}` : '';
  return `Career stats vs ${input.opp}: ${input.tds} TD in ${input.games} ${gameWord}${pct}${extra}`;
}

/** SOS/unit D ranks: 1 = leakiest. Display the inverse so 1 = they cover the position best. */
export function invertDefenseRank(rank?: number, teams = 32): number | undefined {
  if (rank == null || rank < 1) return undefined;
  return teams + 1 - rank;
}

/** Raw oppPosRank: 1 = leakiest D vs that position. Displayed rank is inverted. */
export function formatMismatch(position: string, posRank?: number, oppPosRank?: number): string | undefined {
  if (oppPosRank == null) return undefined;
  const shown = invertDefenseRank(oppPosRank) ?? oppPosRank;
  const vs = `their D vs ${position} ranks #${shown}`;
  let tone: string;
  if (oppPosRank <= 10 && (posRank == null || posRank <= 24)) tone = 'Mismatch in your favor';
  else if (oppPosRank >= 23 && posRank != null && posRank <= 12) tone = 'They match up well against him';
  else if (oppPosRank >= 23) tone = 'They cover this position well';
  else tone = 'Even matchup';
  return `${tone} — ${vs}`;
}
