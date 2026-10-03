import { listRankedBoard } from './draftRoutes';
import { canonicalTeam, enrichmentStore } from '../data/enrichment';
import { describeGameWeather } from './gameContext';
import { buildSurvivorBoard, loadContextAssets } from './survivor';
import { blendStat, currentSeasonWeight } from './sosBlend';
import {
  asTdPos,
  buildMatchup,
  formatMatchupLine,
  formatMatchupMeta,
  formatMismatch,
  formatTdReason,
  formatVenueSplit,
  perGame,
  ranksDesc,
  summarizeTdHistory,
  type TdMatchupView,
  type TdSkillPos,
} from './tdMatchup';
import { assignPrimaries, pickAlternate } from './tdPath';
import type { Position } from '../types';

export interface TdCandidate {
  playerName: string;
  position: Position;
  nflTeam?: string;
  posRank?: number;
  expectedPoints?: number;
  lastYearPts?: number;
  lastYearGames?: number;
  thisYearPts?: number;
  thisYearGames?: number;
  offenseRank?: number;
  sosRank?: number;
  status?: string;
  score: number;
  why: string;
  opp?: string;
  teamWinPct?: number | null;
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
  matchupLine?: string;
  reason?: string;
  totalTds?: number;
  totalGames?: number;
  last5Tds?: number;
  last5Games?: number;
  sampleYears?: number;
  sampleYearsPlus?: boolean;
  vsOppTds?: number;
  vsOppGames?: number;
  vsOppHitPct?: number;
  vsOppLine?: string;
  vsOppHomeTds?: number;
  vsOppHomeGames?: number;
  vsOppAwayTds?: number;
  vsOppAwayGames?: number;
  kickoff?: string;
  thisWeekHome?: boolean;
  venueSplit?: string;
  matchupMeta?: string;
  weather?: { kind: string; label: string };
  olineRank?: number;
  oppPosRank?: number;
  mismatch?: string;
}

export interface TdWeekPick {
  week: number;
  primary: TdCandidate | null;
  primary2: TdCandidate | null;
  alternate: TdCandidate | null;
  options: TdCandidate[];
  teamWinPct?: number | null;
  opp?: string;
  teamWinPct2?: number | null;
  opp2?: string;
  note: string;
}

export interface TdStreakBoard {
  season: number;
  note: string;
  candidates: TdCandidate[];
  path: TdWeekPick[];
}

const POS_OK: Position[] = ['RB', 'WR', 'TE', 'QB'];

function norm(n: number, lo: number, hi: number): number {
  if (hi <= lo) return 0.5;
  return Math.max(0, Math.min(1, (n - lo) / (hi - lo)));
}

function applyMatchup(c: TdCandidate, view: TdMatchupView): TdCandidate {
  const next = {
    ...c,
    ...view,
    matchupLine: formatMatchupLine(view, c.position),
  };
  return {
    ...next,
    reason: formatTdReason(view, { playerName: next.playerName, position: next.position, opp: next.opp }),
  };
}

function oppTeam(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^@/, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/^(vs|at)\s+/i, '')
    .trim();
  return canonicalTeam(cleaned) ?? (cleaned || undefined);
}

export async function buildTdStreakBoard(): Promise<TdStreakBoard> {
  await enrichmentStore.load();
  const season = enrichmentStore.latestRankingSeason() ?? 2026;
  const lastSeason = season - 1;
  const currentWeek = enrichmentStore.currentWeek();
  const completedWeeks = enrichmentStore.completedWeeks();
  const weight = currentSeasonWeight(completedWeeks);
  const board = await listRankedBoard();
  const survivor = await buildSurvivorBoard('win', currentWeek).catch(() => null);
  const context = await loadContextAssets();
  const winByTeamWeek = new Map<string, Map<number, { winPct: number | null; opp: string; bye: boolean }>>();
  for (const row of survivor?.seasonRows ?? []) {
    const m = new Map<number, { winPct: number | null; opp: string; bye: boolean }>();
    for (const cell of row.cells) m.set(cell.week, { winPct: cell.winPct, opp: cell.opp, bye: cell.bye });
    winByTeamWeek.set(row.team, m);
  }

  const leagueByPos = new Map<TdSkillPos, { ydsRank: Map<string, number>; tdsRank: Map<string, number>; avgTds?: number }>();
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as TdSkillPos[]) {
    const yds = new Map<string, number>();
    const tds = new Map<string, number>();
    const teams = new Set([
      ...enrichmentStore.listTdDefense(lastSeason, pos).map((r) => r.team),
      ...enrichmentStore.listTdDefense(season, pos).map((r) => r.team),
    ]);
    for (const team of teams) {
      const prior = enrichmentStore.getTdDefense(team, pos, lastSeason);
      const ytd = enrichmentStore.getTdDefense(team, pos, season);
      const ydsPg = blendStat(perGame(ytd?.yds, ytd?.games), perGame(prior?.yds, prior?.games), weight);
      const tdsPg = blendStat(perGame(ytd?.tds, ytd?.games), perGame(prior?.tds, prior?.games), weight);
      if (ydsPg != null) yds.set(team, ydsPg);
      if (tdsPg != null) tds.set(team, tdsPg);
    }
    const tdsVals = [...tds.values()];
    leagueByPos.set(pos, {
      ydsRank: ranksDesc(yds),
      tdsRank: ranksDesc(tds),
      avgTds: tdsVals.length ? tdsVals.reduce((sum, n) => sum + n, 0) / tdsVals.length : undefined,
    });
  }

  function weekCell(team: string | undefined, week: number) {
    if (!team) return undefined;
    return winByTeamWeek.get(team)?.get(week);
  }

  function decorate(c: TdCandidate, week: number): TdCandidate {
    const cell = weekCell(c.nflTeam, week);
    const pos = asTdPos(c.position);
    const sched = enrichmentStore.getScheduleGame(c.nflTeam, week);
    const schedOpp = sched?.opponent;
    const opp = oppTeam(cell?.opp) ?? schedOpp;
    const thisWeekHome =
      sched?.home ??
      (cell?.opp
        ? !cell.opp
            .replace(/^(w|l)\s+/i, '')
            .trim()
            .startsWith('@')
        : undefined);
    const league = pos ? leagueByPos.get(pos) : undefined;
    const games = enrichmentStore.getTdGames(c.playerName);
    const hist = summarizeTdHistory(games, opp, season, enrichmentStore.getFirstNflSeason(c.playerName));
    const venue =
      thisWeekHome === true
        ? { games: hist.vsOppHomeGames ?? 0, tds: hist.vsOppHomeTds ?? 0, hits: hist.vsOppHomeHits ?? 0 }
        : thisWeekHome === false
          ? { games: hist.vsOppAwayGames ?? 0, tds: hist.vsOppAwayTds ?? 0, hits: hist.vsOppAwayHits ?? 0 }
          : { games: 0, tds: 0, hits: 0 };
    const view = buildMatchup({
      position: c.position,
      priorPlayer: enrichmentStore.getTdPlayer(c.playerName, lastSeason),
      ytdPlayer: enrichmentStore.getTdPlayer(c.playerName, season),
      priorDef: opp && pos ? enrichmentStore.getTdDefense(opp, pos, lastSeason) : undefined,
      ytdDef: opp && pos ? enrichmentStore.getTdDefense(opp, pos, season) : undefined,
      oppYdsRank: opp ? league?.ydsRank.get(opp) : undefined,
      oppTdsRank: opp ? league?.tdsRank.get(opp) : undefined,
      leagueAvgOppTdsPg: league?.avgTds,
      teamWinPct: cell?.winPct ?? null,
      week,
      completedWeeks,
      thisWeekHome,
      vsVenueGames: venue.games || undefined,
      vsVenueTds: venue.games ? venue.tds : undefined,
      vsVenueHits: venue.games ? venue.hits : undefined,
      vsVenueHitRate: venue.games >= 2 ? venue.hits / venue.games : undefined,
    });
    const olineRank = enrichmentStore.getOlineRank(c.nflTeam);
    const oppPosRank = enrichmentStore.getOppPosDefenseRank(c.nflTeam, week, c.position);
    const venueTeam = canonicalTeam(thisWeekHome === false ? opp : c.nflTeam);
    const playerTeam = canonicalTeam(c.nflTeam);
    const venueInfo = venueTeam ? context.venues[venueTeam] : undefined;
    const forecast =
      (playerTeam ? context.forecasts[`${week}:${playerTeam}`] : undefined) ??
      (venueTeam ? context.forecasts[`${week}:${venueTeam}`] : undefined);
    const venueSplit = formatVenueSplit({
      homeGames: hist.vsOppHomeGames || undefined,
      homeTds: hist.vsOppHomeGames ? hist.vsOppHomeTds : undefined,
      awayGames: hist.vsOppAwayGames || undefined,
      awayTds: hist.vsOppAwayGames ? hist.vsOppAwayTds : undefined,
      thisWeekHome,
      opp: cell?.opp ?? opp,
      years: hist.sampleYears,
      plus: hist.sampleYearsPlus,
    });
    const matchupMeta = formatMatchupMeta({
      opp: cell?.opp ?? (thisWeekHome === false && opp ? `@${opp}` : opp),
      thisWeekHome,
      kickoff: sched?.kickoff,
    });
    const weatherRaw = describeGameWeather({
      roof: venueInfo?.roof,
      stadium: venueInfo?.name,
      forecast,
    });
    const weather =
      week < currentWeek && weatherRaw?.kind !== 'dome' ? undefined : weatherRaw;
    return {
      ...applyMatchup({ ...c, opp: cell?.opp, teamWinPct: cell?.winPct ?? null }, view),
      totalTds: hist.totalGames ? hist.totalTds : undefined,
      totalGames: hist.totalGames || undefined,
      last5Tds: hist.last5Games ? hist.last5Tds : undefined,
      last5Games: hist.last5Games || undefined,
      vsOppTds: hist.vsOppGames ? hist.vsOppTds : undefined,
      vsOppGames: hist.vsOppGames || undefined,
      vsOppHitPct: hist.vsOppHitPct,
      vsOppLine: hist.vsOppLine,
      vsOppHomeTds: hist.vsOppHomeGames ? hist.vsOppHomeTds : undefined,
      vsOppHomeGames: hist.vsOppHomeGames || undefined,
      vsOppAwayTds: hist.vsOppAwayGames ? hist.vsOppAwayTds : undefined,
      vsOppAwayGames: hist.vsOppAwayGames || undefined,
      sampleYears: hist.sampleYears,
      sampleYearsPlus: hist.sampleYearsPlus,
      kickoff: sched?.kickoff,
      thisWeekHome,
      venueSplit,
      matchupMeta,
      weather,
      olineRank,
      oppPosRank,
      mismatch: formatMismatch(c.position, c.posRank, oppPosRank),
    };
  }

  const pool = board.filter((p) => POS_OK.includes(p.position) && p.nflTeam && p.nflTeam !== 'FA');
  const lastPts = pool.map((p) => enrichmentStore.getFantasyPoints(p.playerName, lastSeason) ?? 0);
  const ytdPts = pool.map((p) => enrichmentStore.getFantasyPoints(p.playerName, season) ?? 0);
  const expPts = pool.map((p) => p.expectedPoints ?? 0);
  const lastMax = Math.max(...lastPts, 1);
  const ytdMax = Math.max(...ytdPts, 1);
  const expMax = Math.max(...expPts, 1);
  const ytdWeight = Math.min(0.32, 0.14 * Math.max(1, completedWeeks));
  const lastWeight = Math.max(0.1, 0.28 - ytdWeight);

  const rankedAll: TdCandidate[] = pool
    .map((p) => {
      const last = enrichmentStore.getSeasonPoints(p.playerName, lastSeason);
      const ytd = enrichmentStore.getSeasonPoints(p.playerName, season);
      const offense = enrichmentStore.getTeamRanks(p.nflTeam, season)?.offenseRank;
      const lastN = last?.fantasyPoints ?? 0;
      const ytdN = ytd?.fantasyPoints ?? 0;
      const exp = p.expectedPoints ?? 0;
      const posBoost = p.position === 'RB' ? 0.12 : p.position === 'WR' ? 0.08 : p.position === 'QB' ? 0.02 : 0.04;
      const offN = offense != null ? 1 - (offense - 1) / 31 : 0.5;
      const sosN = p.sosRank != null ? 1 - (p.sosRank - 1) / 31 : 0.5;
      const ytdPlayer = enrichmentStore.getTdPlayer(p.playerName, season);
      const priorPlayer = enrichmentStore.getTdPlayer(p.playerName, lastSeason);
      const lastWeekTds = completedWeeks > 0 ? ytdPlayer?.weeks.get(completedWeeks) ?? 0 : 0;
      const newTeam =
        Boolean(ytdPlayer?.team && priorPlayer?.team && ytdPlayer.team !== priorPlayer.team);
      const posShare = ytdPlayer && ytdPlayer.posTds > 0 ? ytdPlayer.tds / ytdPlayer.posTds : 0;
      const recentBoost = lastWeekTds >= 2 ? 0.14 : lastWeekTds === 1 ? 0.07 : 0;
      const bellcowBoost = newTeam && posShare >= 0.5 ? 0.08 : 0;
      const score =
        0.32 * norm(exp, 0, expMax) +
        lastWeight * norm(lastN, 0, lastMax) +
        ytdWeight * norm(ytdN, 0, ytdMax) +
        0.2 * offN +
        0.08 * sosN +
        posBoost +
        recentBoost +
        bellcowBoost;
      const bits = [
        p.posRank != null ? `${p.position}${p.posRank}` : p.position,
        exp ? `${Math.round(exp)} proj` : undefined,
        ytdN ? `${Math.round(ytdN)} PPR YTD` : undefined,
        lastN ? `${Math.round(lastN)} PPR last year` : undefined,
        offense != null ? `Off #${offense}` : undefined,
        p.sosRank != null ? `SOS #${p.sosRank}` : undefined,
      ].filter(Boolean);
      const base: TdCandidate = {
        playerName: p.playerName,
        position: p.position,
        nflTeam: canonicalTeam(p.nflTeam) ?? p.nflTeam,
        posRank: p.posRank,
        expectedPoints: p.expectedPoints,
        lastYearPts: last?.fantasyPoints,
        lastYearGames: last?.gamesPlayed,
        thisYearPts: ytd?.fantasyPoints,
        thisYearGames: ytd?.gamesPlayed,
        offenseRank: offense,
        sosRank: p.sosRank,
        status: p.status,
        score: Math.round(score * 1000) / 1000,
        why: bits.join(' · '),
      };
      const career = summarizeTdHistory(
        enrichmentStore.getTdGames(p.playerName),
        undefined,
        season,
        enrichmentStore.getFirstNflSeason(p.playerName),
      );
      const view = buildMatchup({
        position: p.position,
        priorPlayer: enrichmentStore.getTdPlayer(p.playerName, lastSeason),
        ytdPlayer: enrichmentStore.getTdPlayer(p.playerName, season),
        week: currentWeek,
        completedWeeks,
      });
      return {
        ...applyMatchup(base, view),
        totalTds: career.totalGames ? career.totalTds : undefined,
        totalGames: career.totalGames || undefined,
        last5Tds: career.last5Games ? career.last5Tds : undefined,
        last5Games: career.last5Games || undefined,
        sampleYears: career.sampleYears,
        sampleYearsPlus: career.sampleYearsPlus,
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = rankedAll.slice(0, 80);
  const kept = new Set(top.map((p) => p.playerName));
  const extras = rankedAll.filter((p) => {
    if (kept.has(p.playerName)) return false;
    const ytdPlayer = enrichmentStore.getTdPlayer(p.playerName, season);
    const lastWeekTds = completedWeeks > 0 ? ytdPlayer?.weeks.get(completedWeeks) ?? 0 : 0;
    return lastWeekTds > 0 || (p.thisYearPts ?? 0) >= 18;
  });
  const candidates: TdCandidate[] = [...top, ...extras].slice(0, 120).map((c) => decorate(c, currentWeek));

  function rankWeek(week: number, source: TdCandidate[]): TdCandidate[] {
    const open = source.filter((c) => {
      if (!c.nflTeam) return false;
      if (week === currentWeek && enrichmentStore.weekGameStarted(c.nflTeam, week)) return false;
      const cell = weekCell(c.nflTeam, week);
      return !cell?.bye;
    });
    return open
      .map((c) => decorate(c, week))
      .sort((a, b) => {
        const chance = (b.tdChance ?? 0) - (a.tdChance ?? 0);
        if (chance) return chance;
        const wa = a.teamWinPct ?? 50;
        const wb = b.teamWinPct ?? 50;
        const ctxA =
          week === currentWeek ? (survivor?.week.find((row) => row.team === a.nflTeam)?.contextAdj ?? 0) / 250 : 0;
        const ctxB =
          week === currentWeek ? (survivor?.week.find((row) => row.team === b.nflTeam)?.contextAdj ?? 0) / 250 : 0;
        const diff = b.score + wb / 250 + ctxB - (a.score + wa / 250 + ctxA);
        return diff || a.playerName.localeCompare(b.playerName);
      });
  }

  const candNames = new Set(candidates.map((c) => c.playerName));
  const byWeek = new Map<number, TdCandidate[]>();
  const optionByWeek = new Map<number, TdCandidate[]>();
  for (let week = 1; week <= 18; week++) {
    const full = rankWeek(week, rankedAll);
    optionByWeek.set(week, full);
    byWeek.set(week, full.filter((c) => candNames.has(c.playerName)));
  }
  const assigned = assignPrimaries(byWeek);
  const path: TdWeekPick[] = [];
  for (let week = 1; week <= 18; week++) {
    const pool = optionByWeek.get(week) ?? [];
    const slots = assigned.get(week);
    const primary = pool.find((c) => c.playerName === slots?.primary?.playerName) ?? null;
    const primary2 = week === 1 ? pool.find((c) => c.playerName === slots?.primary2?.playerName) ?? null : null;
    const primaries = [primary, primary2].filter((p): p is TdCandidate => Boolean(p));
    const alternate = pickAlternate(pool, primaries, new Set());
    const cell = weekCell(primary?.nflTeam, week);
    const cell2 = weekCell(primary2?.nflTeam, week);
    const doubleUp = week === 1;
    path.push({
      week,
      primary,
      primary2,
      alternate: alternate ? pool.find((c) => c.playerName === alternate.playerName) ?? null : null,
      options: pool,
      teamWinPct: cell?.winPct ?? null,
      opp: cell?.opp,
      teamWinPct2: cell2?.winPct ?? null,
      opp2: cell2?.opp,
      note: doubleUp
        ? primary
          ? `Start ${primary.playerName} and ${primary2?.playerName ?? '—'}. Either one scoring a TD advances you. ${alternate?.playerName ?? 'The alternate'} only if a starter is inactive.`
          : 'No remaining candidate this week.'
          : primary
          ? `Start ${primary.playerName}. ${alternate?.playerName ?? 'The alternate'} only if the starter is inactive.`
          : 'No remaining candidate this week.',
    });
  }

  return {
    season,
    note: 'Anytime-TD streak. Week 1: two starters from different games — either TD keeps you alive — plus a backup. Later weeks: one starter plus a backup if he is inactive. The path uses each player as a starter only once and fills the hardest weeks first so the 18-week survival chance is as high as we can make it. Sitting as a backup does not use that player. Green ring = they scored; red = they did not.',
    candidates,
    path,
  };
}
