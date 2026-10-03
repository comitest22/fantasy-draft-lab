import type {
  AdpEntry,
  ContenderPlaybook,
  DraftFile,
  DraftRoute,
  DraftRouteBook,
  LeagueConfig,
  MarketBoard,
  MarketValueRow,
  OpeningPattern,
  DepthChartPlayer,
  PlayerCompare,
  Position,
  RankedPlayer,
  RosterSettings,
  RouteBoardPlayer,
  RoutePick,
  SeatLabel,
  SlotOutcome,
  SlotRoutePlan,
} from '../types';
import { canonicalTeam, enrichmentStore, normalizeName } from '../data/enrichment';
import { enrichmentDir } from '../data/store';
import fs from 'fs/promises';
import path from 'path';
import { hasSuperflex } from './leagueFormats';
import {
  draftSlotFor,
  getSeasonStandings,
  openingPicks,
} from './contenderPlaybook';

const DEFAULT_ROSTER: RosterSettings = {
  qb: 1,
  rb: 2,
  wr: 2,
  te: 1,
  flex: 1,
  superflex: 0,
  dst: 1,
  k: 1,
  bench: 5,
};

function rosterOf(config: LeagueConfig): RosterSettings {
  return { ...DEFAULT_ROSTER, ...config.roster };
}

export function rosterSpotCount(roster: RosterSettings): number {
  return (
    roster.qb +
    roster.rb +
    roster.wr +
    roster.te +
    roster.flex +
    (roster.superflex ?? 0) +
    roster.dst +
    roster.k +
    (roster.bench ?? 0)
  );
}

/** Live round count: current roster first, then newest uploaded draft, then config. */
export function draftRounds(config: LeagueConfig, drafts: DraftFile[] = []): number {
  const fromRoster = rosterSpotCount(rosterOf(config));
  const newest = [...drafts].sort((a, b) => b.season - a.season)[0];
  const fromDraft = newest?.rounds;
  if (fromRoster >= 10) return fromRoster;
  return fromDraft ?? config.rounds ?? 14;
}

function formatRoster(roster: RosterSettings): string {
  const bench = roster.bench ?? 5;
  const sf = hasSuperflex(roster) ? ` · ${roster.superflex} SUPERFLEX` : '';
  return `${roster.qb}QB · ${roster.wr}WR · ${roster.rb}RB · ${roster.te}TE · ${roster.flex}FLEX${sf} · D/ST · K · ${bench} bench`;
}

function posCount(already: Position[], pos: Position): number {
  return already.filter((p) => p === pos).length;
}

function rosterAdjust(
  player: RankedPlayer,
  round: number,
  already: Position[],
  roster: RosterSettings,
  eliteTe: Set<string>,
  totalRounds: number
): number {
  const rb = posCount(already, 'RB');
  const wr = posCount(already, 'WR');
  const te = posCount(already, 'TE');
  const rbNeed = Math.max(0, roster.rb - rb);
  const wrNeed = Math.max(0, roster.wr - wr);
  const teNeed = Math.max(0, roster.te - te);
  let adj = 0;

  if (player.position === 'RB') {
    if (rb === 0 && round >= 2) adj += 75;
    else if (rbNeed > 0 && round >= 3) adj += 70;
    else if (rbNeed > 0) adj += 18;
    else if (wrNeed > 0 && round <= 6) adj -= 12;
    else if (rb >= roster.rb + roster.flex + (roster.bench ?? 5) - 2) adj -= 20;
  }

  if (player.position === 'WR') {
    if (round === 1) adj += 12;
    else if (wrNeed > 0 && rb >= 1) adj += 18;
    else if (wrNeed > 0) adj += 8;
    if (wrNeed >= 2 && round <= 4) adj += 22;
    if (wr >= roster.wr + Math.max(0, roster.flex - 1) && rbNeed > 0 && round <= 6) adj -= 60;
    if (wr >= roster.wr + roster.flex + 2 && round <= 10) adj -= 20;
  }

  if (player.position === 'TE') {
    if (round === 1) adj -= 55;
    if (rb === 0 && round <= 4 && !eliteTe.has(player.playerName)) adj -= 50;
    else if (rb === 0 && round <= 4) adj -= 14;
    if (teNeed > 0 && eliteTe.has(player.playerName) && round >= 2 && round <= 3) {
      adj += rb >= 1 ? 42 : 22;
    } else if (teNeed > 0 && round >= 5 && round <= 10) adj += 90;
    if (te >= roster.te && round <= 8) adj -= 35;
  }

  if (player.position === 'QB') {
    const qbNeed = Math.max(0, roster.qb + (roster.superflex ?? 0) - posCount(already, 'QB'));
    if (hasSuperflex(roster)) {
      if (qbNeed > 0 && round >= 3 && round <= 8) adj += 80;
      else if (qbNeed > 0 && round <= 2) adj += 18;
      else if (qbNeed <= 0 && round <= 10) adj -= 40;
    } else if (round >= 5 && round <= 8 && !already.includes('QB')) {
      adj += 24;
    }
  }

  if (player.position === 'D/ST') {
    if (round >= totalRounds - 1 && !already.includes('D/ST')) adj += 130;
    else adj -= 80;
  }

  if (player.position === 'K') {
    if (round >= totalRounds && !already.includes('K')) adj += 150;
    else if (round >= totalRounds - 1 && already.includes('D/ST') && !already.includes('K')) adj += 90;
    else adj -= 80;
  }

  return adj;
}

export function snakeOverall(slot: number, round: number, leagueSize: number): number {
  if (round % 2 === 1) return (round - 1) * leagueSize + slot;
  return leagueSize * round - slot + 1;
}

function siteAdpMean(player: {
  espnAdp?: number;
  sleeperAdp?: number;
  yahooAdp?: number;
  underdogAdp?: number;
}): number | undefined {
  const vals = [player.espnAdp, player.sleeperAdp, player.yahooAdp, player.underdogAdp].filter(
    (n): n is number => n != null && Number.isFinite(n)
  );
  if (vals.length === 0) return undefined;
  return vals.reduce((sum, n) => sum + n, 0) / vals.length;
}

function toPlayer(entry: AdpEntry): RankedPlayer {
  const rank = enrichmentStore.getSiteRank(entry.playerName);
  const siteAdp = enrichmentStore.getSiteAdp(entry.playerName);
  const ecrRow = enrichmentStore.getConsensusRank(entry.playerName);
  const listed = canonicalTeam(rank?.nflTeam ?? siteAdp?.nflTeam ?? ecrRow?.nflTeam);
  const nflTeam =
    listed && listed !== 'FA' ? listed : enrichmentStore.rosterTeam(entry.playerName, entry.season);
  const units = enrichmentStore.getConsensusUnits(nflTeam);
  const espnRank = Math.round(entry.adp);
  const ecr = ecrRow?.ecr;
  const adpMean = siteAdpMean(siteAdp ?? {}) ?? rank?.adp;
  const spread =
    ecrRow?.ecrStdev ??
    (ecrRow?.ecrBest != null && ecrRow?.ecrWorst != null
      ? Math.round((ecrRow.ecrWorst - ecrRow.ecrBest) * 10) / 10
      : undefined);
  const sos = enrichmentStore.getSos(nflTeam, entry.position);
  return {
    rank: espnRank,
    playerName: entry.playerName,
    position: entry.position,
    nflTeam,
    expectedPoints: entry.expectedPoints,
    fantasyPros: rank?.fantasyPros,
    espnVsFp: rank?.espnVsFp,
    landmine: rank?.landmine,
    espnAdp: siteAdp?.espnAdp,
    sleeperAdp: siteAdp?.sleeperAdp,
    yahooAdp: siteAdp?.yahooAdp,
    underdogAdp: siteAdp?.underdogAdp,
    espnMinusSleeper: siteAdp?.espnMinusSleeper,
    espnMinusUnderdog: siteAdp?.espnMinusUnderdog,
    sos,
    sosRank: enrichmentStore.getSosRank(nflTeam, entry.position),
    adp: rank?.adp ?? siteAdp?.espnAdp,
    posRank: enrichmentStore.getEspnPosRank(entry.playerName, entry.position),
    byeWeek: rank?.bye ?? enrichmentStore.getByeWeek(nflTeam),
    status: enrichmentStore.getPlayerStatus(entry.playerName),
    ecr,
    ecrPos: ecrRow?.ecrPos,
    espnMinusEcr: ecr != null ? Math.round((espnRank - ecr) * 10) / 10 : undefined,
    ecrMinusAdp: ecr != null && adpMean != null ? Math.round((ecr - adpMean) * 10) / 10 : undefined,
    expertSpread: spread,
    consensusSos: sos,
    consensusOline: units?.oline,
    consensusDline: units?.dline,
    consensusPower: units?.power,
  };
}

function slimBoard(board: RankedPlayer[]): RouteBoardPlayer[] {
  return board.map((p) => ({
    playerName: p.playerName,
    position: p.position,
    rank: p.rank,
  }));
}

function patternOf(positions: Position[]): string {
  return positions.join('-') || '—';
}

function mostCommon(items: string[]): string | undefined {
  if (items.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function slotForOverall(overall: number, leagueSize: number): number {
  const round = Math.ceil(overall / leagueSize);
  const pickInRound = ((overall - 1) % leagueSize) + 1;
  if (round % 2 === 1) return pickInRound;
  return leagueSize - pickInRound + 1;
}

function remainingPlayers(board: RankedPlayer[], taken: Set<string>): RankedPlayer[] {
  return board.filter((p) => !taken.has(p.playerName));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function consensusAdp(player: RankedPlayer): number | undefined {
  const vals = [player.sleeperAdp, player.yahooAdp, player.underdogAdp, player.fantasyPros].filter(
    (n): n is number => n != null && Number.isFinite(n)
  );
  if (vals.length === 0) return undefined;
  return vals.reduce((sum, n) => sum + n, 0) / vals.length;
}

const SKILL_POS = new Set<Position>(['WR', 'RB', 'TE']);
const ALT_LIMIT = 5;
const STEAL_MAX = 2;
const KIND_ORDER = { steal: 0, pivot: 1, reach: 2 } as const;

function valueKind(player: RankedPlayer, overall: number): 'steal' | 'pivot' | 'reach' {
  if (player.rank + 3 <= overall) return 'steal';
  if (player.rank > overall + 4) return 'reach';
  return 'pivot';
}

/** Players the ESPN room will take before your next pick, plus steals and need-based reaches. */
function valueCandidates(
  remaining: RankedPlayer[],
  overall: number,
  nextOverall: number,
  already: Position[],
  roster: RosterSettings,
  eliteTe: Set<string>,
  round: number
): RankedPlayer[] {
  let until = nextOverall;
  if (until <= overall + 1) until = Math.max(until, overall + 8);

  const leaving = remaining.filter((p) => p.rank < until);
  const later = remaining.filter((p) => p.rank >= until);
  const extras = later
    .filter(
      (p) =>
        (p.espnMinusEcr != null && p.espnMinusEcr >= 8) ||
        (p.ecrMinusAdp != null && p.ecrMinusAdp <= -8) ||
        (p.espnMinusSleeper != null && p.espnMinusSleeper >= 8)
    )
    .slice(0, 4);

  const rbNeed = posCount(already, 'RB') < roster.rb;
  const wrNeed = posCount(already, 'WR') < roster.wr;
  const teNeed = posCount(already, 'TE') < roster.te;
  const reaches =
    round <= 2
      ? later
          .filter((p) => {
            if (p.rank > overall + 18) return false;
            if (eliteTe.has(p.playerName) && teNeed) return true;
            if (p.position === 'RB' && rbNeed) return true;
            if (p.position === 'WR' && wrNeed) return true;
            return p.position === 'TE' && teNeed && p.rank <= overall + 12;
          })
          .slice(0, 6)
      : [];

  const seen = new Set<string>();
  const pool: RankedPlayer[] = [];
  for (const p of [...leaving, ...extras, ...reaches]) {
    if (seen.has(p.playerName)) continue;
    seen.add(p.playerName);
    pool.push(p);
  }
  return pool.length > 0 ? pool : remaining.slice(0, 8);
}

function valueScore(
  player: RankedPlayer,
  round: number,
  overall: number,
  nextOverall: number,
  already: Position[],
  alreadyPlayers: RankedPlayer[],
  roster: RosterSettings,
  eliteTe: Set<string>,
  totalRounds: number
): number {
  let score = player.expectedPoints ?? Math.max(0, 280 - player.rank);

  if (player.position === 'QB' && round < 5 && !hasSuperflex(roster)) score -= 420;
  if (player.position === 'QB' && already.includes('QB') && !hasSuperflex(roster)) score -= 400;
  if (
    player.position === 'QB' &&
    hasSuperflex(roster) &&
    posCount(already, 'QB') >= roster.qb + (roster.superflex ?? 0)
  ) {
    score -= 400;
  }
  if ((player.position === 'K' || player.position === 'D/ST') && round < 10) score -= 500;

  const rosterPts = rosterAdjust(player, round, already, roster, eliteTe, totalRounds);
  const isReach = player.rank > overall + 4;
  score += isReach && round > 2 ? rosterPts * 0.3 : rosterPts;

  // Positive espnMinusEcr = ESPN ranks him later than industry ECR = steal in this room.
  if (player.espnMinusEcr != null) score += clamp(player.espnMinusEcr, -12, 16) * 2.2;

  // High expert spread is volatility, not an ESPN-room landmine.
  if (player.expertSpread != null) score -= clamp(player.expertSpread, 0, 25) * 0.9;

  // Negative ecrMinusAdp = experts rank him above ADP = industry sleeper.
  if (player.ecrMinusAdp != null && player.ecrMinusAdp < 0) {
    score += clamp(-player.ecrMinusAdp, 0, 16) * 1.1;
  }

  if (player.espnMinusSleeper != null) {
    // Modest room-vs-industry signal. +18 ADP spots must not outweigh ~40 projected points.
    score += clamp(player.espnMinusSleeper, -8, 8) * 1.0;
  }
  if (player.espnMinusUnderdog != null) {
    score += clamp(player.espnMinusUnderdog, -10, 14) * 1.4;
  }

  // SOS 5 = easiest opposing defenses, 1 = toughest.
  if (player.sos != null) score += (player.sos - 3) * 11;

  const consensus = consensusAdp(player);
  if (consensus != null && player.rank + 8 < consensus) {
    score -= (consensus - player.rank - 4) * 5;
  }

  // Mild reaches for value / roster construction are fine; autodrafting 20 spots down is not.
  const reachStart = round > 2 ? 4 : 6;
  const reachTax = round > 2 ? 12 : 7;
  if (player.rank > overall + reachStart) {
    const teReach = eliteTe.has(player.playerName) && round <= 3;
    score -= (player.rank - overall - reachStart) * (teReach ? 2.5 : reachTax);
  }

  // Light bye stacking tax: first skill player on a week is free.
  if (player.position !== 'K' && player.position !== 'D/ST' && player.byeWeek != null) {
    const same = alreadyPlayers.filter(
      (p) => p.position !== 'K' && p.position !== 'D/ST' && p.byeWeek === player.byeWeek
    ).length;
    if (same >= 1) score -= Math.min(25, same * 10);
  }

  // In an ESPN room he survives until his rank — wait unless he is a snipe risk.
  if (player.rank >= nextOverall) {
    const snipe =
      (player.espnMinusEcr != null && player.espnMinusEcr >= 10) ||
      (player.ecrMinusAdp != null && player.ecrMinusAdp <= -8) ||
      (eliteTe.has(player.playerName) && round <= 3);
    score -= snipe ? 8 : 28;
  }

  return score;
}

function shortName(name: string): string {
  const cleaned = name.replace(/\s+(Jr\.?|Sr\.?|III|II|IV)$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2 && /^St\.?$/i.test(parts[parts.length - 2])) {
    return `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] ?? name;
}

function expertTake(
  player: RankedPlayer,
  round: number,
  already: Position[],
  eliteTe: Set<string>,
  roster: RosterSettings
): string {
  const name = shortName(player.playerName);
  const rb = posCount(already, 'RB');
  const wr = posCount(already, 'WR');
  const te = posCount(already, 'TE');
  const easy = player.sos != null && player.sos >= 4;
  const tough = player.sos != null && player.sos <= 2;
  const sleeper = player.ecrMinusAdp != null && player.ecrMinusAdp <= -8;
  const volatile = player.expertSpread != null && player.expertSpread >= 8;
  const value =
    (player.espnMinusEcr != null && player.espnMinusEcr >= 8) ||
    sleeper ||
    (player.espnMinusSleeper != null && player.espnMinusSleeper >= 4);

  const matched = enrichmentStore.takeawaysForPick({
    playerName: player.playerName,
    position: player.position,
    round,
    already,
  });
  const cite = matched[0]?.claim;

  if (player.position === 'WR' && wr === 0) {
    if (easy) return `${name} is the WR1 I’d take in this window — locked-in targets and a friendly slate, so you’re buying weekly starts, not hope.`;
    if (value) return `${name} is sliding relative to the rest of the industry. That’s a real WR1 you can get without paying the sticker price.`;
    return `${name} is the safest true WR1 left. In a ${roster.wr}-WR league you want this kind of volume before the position turns into committee noise.`;
  }
  if (player.position === 'WR' && wr + 1 < roster.wr) {
    return `${name} is WR${wr + 1}. You still need ${roster.wr - wr - 1} more starting receiver${roster.wr - wr - 1 === 1 ? '' : 's'} before the flex.`;
  }
  if (player.position === 'WR' && wr + 1 === roster.wr) {
    if (easy) return `${name} pairs as your WR${roster.wr} with a soft schedule. That’s a starter you’ll actually plug in, not a depth chart dart.`;
    return `${name} finishes the starting WR group. Get ${roster.wr} every-week receiver${roster.wr === 1 ? '' : 's'} before you chase extras for the flex.`;
  }
  if (player.position === 'WR') {
    if (sleeper && cite) return `${name} is a late WR add. ${cite}`;
    if (sleeper) return `${name} is an industry sleeper vs ADP — stash him after the starters are set.`;
    return `${name} is bench/flex insurance. With five bench spots, this is the upside WR you stash after the starters are set.`;
  }

  if (player.position === 'RB' && rb === 0) {
    if (cite && round <= 3) return `${name} is the RB1 in this range. ${cite}`;
    if (easy) return `${name} is a feature back with one of the easier RB slates. That’s how you lock an RB1 without reaching for a committee.`;
    return `${name} is the RB1 in this range. You start two backs here, so don’t leave the round without a workhorse.`;
  }
  if (player.position === 'RB' && rb === 1) {
    if (easy) return `${name} is the RB2 I’d rather have than another receiver — easy matchups and a defined job.`;
    if (volatile) return `${name} fills RB2, but experts disagree on him. I’d take him over a third WR and live with the volatility.`;
    return `${name} gets you the second starter at RB before the position turns into handcuffs and committees.`;
  }
  if (player.position === 'RB') {
    if (sleeper && cite) return `${name} is a late RB add. ${cite}`;
    if (sleeper) return `${name} is an industry sleeper vs ADP — pass-catching/committee upside for a deep bench.`;
    return `${name} is bench depth at RB. Injuries always hit this position; this is the spare tire you actually want.`;
  }

  if (player.position === 'TE') {
    if (eliteTe.has(player.playerName) && round <= 3) {
      if (rb >= 1) {
        return `${name} is the elite TE window. Recent champs spent a top-3 pick here when the name was this good — take him if the board gave him to you, then still finish the second RB by round 4.`;
      }
      return `${name} is the elite TE. I’d rather have an RB first, but if this is the name falling, taking him and getting the back next is a live path in this league.`;
    }
    if (te === 0) return `${name} is a fine TE1 once the RB/WR starters are on track. Don’t let the position go barren into the teens.`;
    return `${name} is TE depth. Stream if you have to, but a second tight end is cheap insurance on a five-spot bench.`;
  }

  if (player.position === 'QB') {
    const qbs = posCount(already, 'QB');
    if (hasSuperflex(roster) && qbs === 0) {
      return `${name} is the Superflex QB1. You start two passers here — don’t wait until the 1-QB window.`;
    }
    if (hasSuperflex(roster) && qbs === 1) {
      return `${name} is your second starting QB (Superflex). Treat him like a flex starter, not a backup.`;
    }
    if (value) return `${name} is the first QB I’d take — the room is slower on him than the market, and waiting this long is the winning pattern.`;
    return `${name} is the QB1 in the wait range. You don’t need two; you need one you trust from here on out.`;
  }

  if (player.position === 'D/ST') {
    return `${name} is the streaming defense to start with — grab a unit and don’t spend a skill pick on this.`;
  }
  if (player.position === 'K') {
    return `${name} is kicker. Take one late, don’t think twice, and move on.`;
  }

  if (tough) return `${name} is talent over matchups. The slate is rocky, so you’re betting the player, not the schedule.`;
  return `${name} is the best leftover skill player in this range — keep building a lineup you can actually start.`;
}

function altTake(
  player: RankedPlayer,
  lead: RankedPlayer,
  overall: number,
  round: number,
  eliteTe: Set<string>
): string {
  const name = shortName(player.playerName);
  const leadName = shortName(lead.playerName);
  if (player.rank + 3 <= overall) {
    return `${name} if the room reaches elsewhere — that’s a steal at this pick.`;
  }
  if (eliteTe.has(player.playerName) && round <= 3) {
    return `${name} if he’s there — elite TE in the first three is a winning pattern here. Still get RB2 by round 4.`;
  }
  if (player.rank > overall + 4) {
    return `${name} is a reach, but he fills the ${player.position} you still need for a complete lineup.`;
  }
  if (player.position !== lead.position) {
    return `If ${leadName} is gone, pivot to ${name} (${player.position}) and rebuild the rest of the path.`;
  }
  if (player.sos != null && player.sos >= 4) {
    return `${name} if ${leadName} is off the board — similar role, easier remaining schedule.`;
  }
  if ((player.espnMinusEcr ?? 0) > (lead.espnMinusEcr ?? 0)) {
    return `${name} is the value pivot if ${leadName} doesn’t make it back.`;
  }
  return `${name} if ${leadName} is taken — same position, next guy I’d live with.`;
}

function pickAlternates(
  lead: RankedPlayer,
  ranked: RankedPlayer[],
  remaining: RankedPlayer[],
  fallers: RankedPlayer[],
  round: number,
  overall: number,
  already: Position[],
  roster: RosterSettings,
  eliteTe: Set<string>
): RankedPlayer[] {
  const chosen: RankedPlayer[] = [];
  const seen = new Set([lead.playerName]);
  const stealCount = () => chosen.filter((p) => valueKind(p, overall) === 'steal').length;
  const push = (p?: RankedPlayer) => {
    if (!p || seen.has(p.playerName) || chosen.length >= ALT_LIMIT) return;
    if (valueKind(p, overall) === 'steal' && stealCount() >= STEAL_MAX) return;
    seen.add(p.playerName);
    chosen.push(p);
  };

  const rest = ranked.filter((p) => p.playerName !== lead.playerName);
  const stealPool: RankedPlayer[] = [];
  const stealSeen = new Set<string>();
  for (const p of [...fallers, ...remaining].sort((a, b) => a.rank - b.rank)) {
    if (
      !SKILL_POS.has(p.position) ||
      valueKind(p, overall) !== 'steal' ||
      p.playerName === lead.playerName ||
      stealSeen.has(p.playerName)
    ) {
      continue;
    }
    stealSeen.add(p.playerName);
    stealPool.push(p);
  }

  const eliteSteals = stealPool.filter((p) => eliteTe.has(p.playerName) && round <= 3);
  const otherSteals = stealPool.filter((p) => !eliteSteals.includes(p));
  for (const p of [...eliteSteals, ...otherSteals].slice(0, STEAL_MAX)) push(p);

  if (round >= 2 && round <= 3 && posCount(already, 'TE') === 0 && lead.position !== 'TE') {
    const tes = [...remaining, ...fallers]
      .filter((p) => eliteTe.has(p.playerName))
      .sort((a, b) => Math.abs(a.rank - overall) - Math.abs(b.rank - overall) || a.rank - b.rank);
    for (const te of tes) push(te);
  }

  for (const p of rest.filter((x) => valueKind(x, overall) === 'pivot').slice(0, 2)) push(p);

  const rbNeed = posCount(already, 'RB') < roster.rb;
  const wrNeed = posCount(already, 'WR') < roster.wr;
  const teNeed = posCount(already, 'TE') < roster.te;
  const reaches = remaining
    .filter((p) => {
      if (valueKind(p, overall) !== 'reach') return false;
      if (p.rank > overall + 16) return false;
      if (p.position === 'RB' && rbNeed) return true;
      if (p.position === 'WR' && wrNeed) return true;
      if (p.position === 'TE' && (teNeed || eliteTe.has(p.playerName))) return true;
      return false;
    })
    .sort((a, b) => a.rank - b.rank);
  for (const p of reaches.slice(0, 2)) push(p);

  if (new Set(chosen.map((p) => p.position)).size <= 1) {
    push(rest.find((p) => p.position !== lead.position && valueKind(p, overall) !== 'steal'));
  }

  for (const p of rest) push(p);

  return [...chosen].sort((a, b) => {
    const byKind = KIND_ORDER[valueKind(a, overall)] - KIND_ORDER[valueKind(b, overall)];
    if (byKind !== 0) return byKind;
    return a.rank - b.rank;
  });
}

function leagueThesis(slot: number, roster: RosterSettings, commonPodiumShape?: string): string {
  const hist = commonPodiumShape
    ? ` Podium teams from pick ${slot} have often opened ${commonPodiumShape}.`
    : '';
  const wrBy = roster.wr >= 3 ? 5 : 4;
  const qbLine = hasSuperflex(roster)
    ? 'a Superflex QB in the 3–7 range'
    : 'TE/flex, QB in the 5–8 range';
  return `Fill ${roster.rb} RB and ${roster.wr} WR starters by round ${wrBy}, then ${qbLine}, and D/ST then K at the end. Bench is ${roster.bench ?? 5} spots — that’s where seasons get won.${hist}`;
}

function parseOpening(raw?: string): Position[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split('-').map((p) => p.trim().toUpperCase());
  if (parts.length !== 3) return undefined;
  if (!parts.every((p) => p === 'WR' || p === 'RB' || p === 'TE')) return undefined;
  return parts as Position[];
}

function isSkillPattern(pattern: string): boolean {
  const parts = pattern.split('-');
  return parts.length === 3 && parts.every((p) => p === 'WR' || p === 'RB' || p === 'TE');
}

export function skillOpenings(playbook: ContenderPlaybook): OpeningPattern[] {
  return [...playbook.openingPatterns]
    .filter((p) => isSkillPattern(p.pattern))
    .sort((a, b) => b.top3Pct - a.top3Pct || b.top3Count - a.top3Count);
}

/** WR/RB/TE opens for a seat: podium from that slot first, then league podium. */
export function skillOpeningsForSlot(
  drafts: DraftFile[],
  config: LeagueConfig,
  slot: number,
  leagueFill: OpeningPattern[]
): OpeningPattern[] {
  const rows: { pattern: string; standing: number }[] = [];
  for (const draft of drafts) {
    for (const team of getSeasonStandings(config, draft.season)) {
      if (draftSlotFor(draft, team.teamName) !== slot) continue;
      const pattern = openingPicks(draft, team.teamName, 3)
        .map((p) => p.position)
        .join('-');
      if (!isSkillPattern(pattern)) continue;
      rows.push({ pattern, standing: team.standing });
    }
  }

  const podiumN = rows.filter((r) => r.standing <= 3).length;
  const byPat = new Map<string, { n: number; top3: number }>();
  for (const r of rows) {
    const cur = byPat.get(r.pattern) ?? { n: 0, top3: 0 };
    cur.n += 1;
    if (r.standing <= 3) cur.top3 += 1;
    byPat.set(r.pattern, cur);
  }

  const slotRanked: OpeningPattern[] = [...byPat.entries()]
    .map(([pattern, c]) => ({
      pattern,
      top3Count: c.top3,
      top3Pct: podiumN > 0 ? c.top3 / podiumN : 0,
      leaguePct: rows.length > 0 ? c.n / rows.length : 0,
    }))
    .sort(
      (a, b) => b.top3Count - a.top3Count || b.leaguePct - a.leaguePct || b.top3Pct - a.top3Pct
    );

  const out: OpeningPattern[] = [];
  const seen = new Set<string>();
  const push = (p: OpeningPattern) => {
    if (seen.has(p.pattern)) return;
    out.push(p);
    seen.add(p.pattern);
  };

  for (const p of slotRanked.filter((x) => x.top3Count > 0)) push(p);
  for (const p of leagueFill) push(p);
  for (const p of slotRanked) push(p);
  return out;
}

function pickFromCands(
  cands: RankedPlayer[],
  round: number,
  overall: number,
  nextOverall: number,
  already: Position[],
  alreadyPlayers: RankedPlayer[],
  roster: RosterSettings,
  eliteTe: Set<string>,
  totalRounds: number
): RankedPlayer[] {
  return [...cands].sort(
    (a, b) =>
      valueScore(b, round, overall, nextOverall, already, alreadyPlayers, roster, eliteTe, totalRounds) -
      valueScore(a, round, overall, nextOverall, already, alreadyPlayers, roster, eliteTe, totalRounds)
  );
}

export interface RouteReplayOpts {
  slot: number;
  opening?: string;
  locks?: Array<{ round: number; playerName: string }>;
}

function buildValueRoute(
  board: RankedPlayer[],
  slot: number,
  leagueSize: number,
  roster: RosterSettings,
  eliteTe: Set<string>,
  thesis: string,
  totalRounds: number,
  opts: RouteReplayOpts = { slot }
): DraftRoute {
  const positionLocks = parseOpening(opts.opening);
  const playerLocks = new Map((opts.locks ?? []).map((l) => [l.round, l.playerName]));
  const reserved = new Set(playerLocks.values());
  const taken = new Set<string>();
  const picks: RoutePick[] = [];
  const lastOverall = leagueSize * totalRounds;
  const sinceLast: RankedPlayer[] = [];
  const dstRound = Math.max(1, totalRounds - 1);
  const kRound = totalRounds;

  for (let overall = 1; overall <= lastOverall; overall++) {
    const round = Math.ceil(overall / leagueSize);
    const remaining = remainingPlayers(board, taken);
    if (remaining.length === 0) break;

    if (slotForOverall(overall, leagueSize) !== slot) {
      const nxt = remaining.find((p) => !reserved.has(p.playerName));
      if (nxt) {
        taken.add(nxt.playerName);
        sinceLast.push(nxt);
      }
      continue;
    }

    const already = picks.map((p) => p.player.position);
    const alreadyPlayers = picks.map((p) => p.player);
    const nextOverall =
      round < totalRounds ? snakeOverall(slot, round + 1, leagueSize) : overall + leagueSize;
    const recent = sinceLast.filter((p) => SKILL_POS.has(p.position));
    const eliteFallers = sinceLast.filter((p) => eliteTe.has(p.playerName));
    const fallerNames = new Set<string>();
    const fallers: RankedPlayer[] = [];
    for (const p of [...eliteFallers, ...recent]) {
      if (fallerNames.has(p.playerName)) continue;
      fallerNames.add(p.playerName);
      fallers.push(p);
    }
    let cands = valueCandidates(remaining, overall, nextOverall, already, roster, eliteTe, round);
    if (round >= dstRound) {
      const specialists = remaining.filter((p) => p.position === 'D/ST' || p.position === 'K');
      const names = new Set(cands.map((p) => p.playerName));
      cands = [...cands, ...specialists.filter((p) => !names.has(p.playerName))];
    }

    const posLock = positionLocks?.[round - 1];
    if (posLock) {
      const atPos = cands.filter((p) => p.position === posLock);
      cands = atPos.length > 0 ? atPos : remaining.filter((p) => p.position === posLock).slice(0, 8);
    }

    const needTe = posCount(already, 'TE') < roster.te;
    if (needTe && round >= 2 && round <= 3 && !posLock) {
      const elites = remaining.filter((p) => eliteTe.has(p.playerName));
      const names = new Set(cands.map((p) => p.playerName));
      cands = [...cands, ...elites.filter((p) => !names.has(p.playerName))];
    }
    if (needTe && round >= 7 && round <= 9 && !posLock) {
      const tes = remaining.filter((p) => p.position === 'TE').slice(0, 6);
      if (tes.length > 0) cands = tes;
    } else if (needTe && round >= 6 && round <= 10 && !posLock) {
      const tes = remaining.filter((p) => p.position === 'TE').slice(0, 6);
      const names = new Set(cands.map((p) => p.playerName));
      cands = [...cands, ...tes.filter((p) => !names.has(p.playerName))];
    }

    if (!posLock && round >= dstRound && !already.includes('D/ST')) {
      const dst = remaining.filter((p) => p.position === 'D/ST').slice(0, 6);
      if (dst.length > 0) cands = dst;
    } else if (!posLock && round >= kRound && !already.includes('K')) {
      const ks = remaining.filter((p) => p.position === 'K').slice(0, 6);
      if (ks.length > 0) cands = ks;
    }

    const lockedName = playerLocks.get(round);
    const locked = lockedName
      ? remaining.find((p) => p.playerName === lockedName) ??
        fallers.find((p) => p.playerName === lockedName) ??
        board.find((p) => p.playerName === lockedName && !taken.has(p.playerName))
      : undefined;

    const ranked = pickFromCands(
      cands,
      round,
      overall,
      nextOverall,
      already,
      alreadyPlayers,
      roster,
      eliteTe,
      totalRounds
    );
    const player = locked ?? ranked[0];
    if (!player) continue;

    const alts = pickAlternates(
      player,
      ranked,
      remaining,
      fallers,
      round,
      overall,
      already,
      roster,
      eliteTe
    ).map((p) => ({ player: p, reason: altTake(p, player, overall, round, eliteTe) }));

    taken.add(player.playerName);
    sinceLast.length = 0;
    picks.push({
      round,
      overallPick: overall,
      player,
      reason: expertTake(player, round, already, eliteTe, roster),
      alternates: alts,
    });
  }

  return {
    id: 'league-shape',
    name: opts.opening ? `${opts.opening} open` : 'Your path',
    thesis,
    shape: patternOf(picks.slice(0, 3).map((p) => p.player.position)),
    picks,
    projectedPoints: Math.round(
      picks
        .filter((p) => p.player.position !== 'QB' && p.player.position !== 'K' && p.player.position !== 'D/ST')
        .reduce((sum, p) => sum + (p.player.expectedPoints ?? 0), 0)
    ),
  };
}

function seatFor(
  slot: number,
  leagueSize: number,
  outcomes: SlotOutcome[]
): { label: SeatLabel; detail: string } {
  const row = outcomes.find((s) => s.slot === slot);
  const best = [...outcomes].sort((a, b) => a.avgFinish - b.avgFinish)[0];
  const worst = [...outcomes].sort((a, b) => b.avgFinish - a.avgFinish)[0];

  if (row && best && row.slot === best.slot && row.top3Rate >= 0.4) {
    return {
      label: 'edge',
      detail: `This league’s best seat: ${row.titles} titles, ${pct(row.top3Rate)} top-3, average finish ${row.avgFinish.toFixed(2)}.`,
    };
  }
  if (row && worst && row.slot === worst.slot && row.top3Rate <= 0.15) {
    return {
      label: 'trap',
      detail: `Historical trap: ${row.titles} titles, ${pct(row.top3Rate)} top-3, average finish ${row.avgFinish.toFixed(2)}. Hunt the best remaining skill player into the turn rather than forcing a stack.`,
    };
  }
  if (slot === 1) {
    return {
      label: 'early',
      detail: row
        ? `The 1.01 has ${row.titles} titles here (average finish ${row.avgFinish.toFixed(2)}). Take the best RB or WR — you still need two starting RBs by round 4.`
        : 'Early pick. Best player available at RB or WR; do not lock hero RB just because you pick first.',
    };
  }
  if (slot >= leagueSize - 1) {
    return {
      label: 'turn',
      detail: row
        ? `Late-turn value: ${row.titles} titles, ${pct(row.top3Rate)} top-3, average finish ${row.avgFinish.toFixed(2)}. You get two of the first ${leagueSize + 2} players.`
        : 'Late-turn seat — you draft twice in a row at the 1/2 turn.',
    };
  }
  if (slot <= 3) {
    return {
      label: 'early',
      detail: row
        ? `Average finish ${row.avgFinish.toFixed(2)}, ${row.titles} titles. Take a true difference-maker at RB or WR; fill both starting RBs before a third WR.`
        : 'Early pick — lock a difference-maker at RB or WR.',
    };
  }
  return {
    label: 'middle',
    detail: row
      ? `Average finish ${row.avgFinish.toFixed(2)}, ${pct(row.top3Rate)} top-3. Draft like a turn team: WR or RB in round 1, the other starter next, and RB2 by round 4 before TE or a third WR.`
      : 'Middle slot — stay flexible at the 2/3 turn.',
  };
}

function podiumShapesBySlot(
  drafts: DraftFile[],
  config: LeagueConfig
): Map<number, string[]> {
  const bySlot = new Map<number, string[]>();
  for (const draft of drafts) {
    const standings = getSeasonStandings(config, draft.season).filter((t) => t.standing <= 3);
    for (const team of standings) {
      const slot = draftSlotFor(draft, team.teamName);
      if (slot == null) continue;
      const shape = openingPicks(draft, team.teamName, 3)
        .map((p) => p.position)
        .join('-');
      const list = bySlot.get(slot) ?? [];
      list.push(shape);
      bySlot.set(slot, list);
    }
  }
  return bySlot;
}

function lastUserSlot(drafts: DraftFile[], config: LeagueConfig): number | undefined {
  const newest = [...drafts].sort((a, b) => b.season - a.season)[0];
  if (!newest) return undefined;
  const name = config.seasons[String(newest.season)]?.userTeamName;
  if (!name) return undefined;
  return draftSlotFor(newest, name);
}

function consensusMarketFields(playerName: string, espnRank?: number) {
  const ecrRow = enrichmentStore.getConsensusRank(playerName);
  const siteAdp = enrichmentStore.getSiteAdp(playerName);
  const siteRank = enrichmentStore.getSiteRank(playerName);
  const adpMean = siteAdpMean(siteAdp ?? {}) ?? siteRank?.adp;
  const ecr = ecrRow?.ecr;
  const spread =
    ecrRow?.ecrStdev ??
    (ecrRow?.ecrBest != null && ecrRow?.ecrWorst != null
      ? Math.round((ecrRow.ecrWorst - ecrRow.ecrBest) * 10) / 10
      : undefined);
  return {
    ecr,
    espnMinusEcr: ecr != null && espnRank != null ? Math.round((espnRank - ecr) * 10) / 10 : undefined,
    ecrMinusAdp: ecr != null && adpMean != null ? Math.round((ecr - adpMean) * 10) / 10 : undefined,
    expertSpread: spread,
  };
}

function toMarketRowFromRank(
  row: ReturnType<typeof enrichmentStore.listSiteRanks>[number]
): MarketValueRow {
  return {
    playerName: row.playerName,
    position: (row.position as Position) || 'WR',
    espnRank: row.espnRank,
    fantasyPros: row.fantasyPros,
    adp: row.adp,
    espnVsFp: row.espnVsFp,
    landmine: row.landmine,
    ...consensusMarketFields(row.playerName, row.espnRank),
  };
}

function buildMarketBoard(draftPicks = 140): MarketBoard {
  const ranks = enrichmentStore
    .listSiteRanks()
    .filter((r) => (r.espnRank ?? 999) <= draftPicks && r.position !== 'K' && r.position !== 'D/ST')
    .map(toMarketRowFromRank);

  const values = [...ranks]
    .filter((r) => r.espnMinusEcr != null && r.espnMinusEcr >= 8)
    .sort((a, b) => (b.espnMinusEcr ?? 0) - (a.espnMinusEcr ?? 0))
    .map((r) => r);

  const sleepers = [...ranks]
    .filter((r) => r.ecrMinusAdp != null && r.ecrMinusAdp <= -8)
    .sort((a, b) => (a.ecrMinusAdp ?? 0) - (b.ecrMinusAdp ?? 0));

  const landmines = [...ranks]
    .filter(
      (r) =>
        (r.landmine != null && r.landmine >= 6.2) ||
        (r.espnMinusEcr != null && r.espnMinusEcr <= -8)
    )
    .sort(
      (a, b) =>
        (a.espnMinusEcr ?? 0) - (b.espnMinusEcr ?? 0) || (b.landmine ?? 5.5) - (a.landmine ?? 5.5)
    );

  const currentNames = new Set(
    enrichmentStore.listSiteRanks().map((r) => normalizeName(r.playerName))
  );
  const adp = enrichmentStore
    .listSiteAdp()
    .filter(
      (a) =>
        currentNames.has(normalizeName(a.playerName)) && (a.espnAdp ?? 999) <= draftPicks
    );

  const adpValues: MarketValueRow[] = [...adp]
    .filter((a) => (a.espnMinusSleeper ?? 0) >= 3)
    .sort((a, b) => (b.espnMinusSleeper ?? 0) - (a.espnMinusSleeper ?? 0))
    .map((a) => ({
      playerName: a.playerName,
      position: (a.position as Position) || 'WR',
      espnAdp: a.espnAdp,
      sleeperAdp: a.sleeperAdp,
      yahooAdp: a.yahooAdp,
      underdogAdp: a.underdogAdp,
      espnMinusSleeper: a.espnMinusSleeper,
      espnMinusUnderdog: a.espnMinusUnderdog,
    }));

  const adpLandmines: MarketValueRow[] = [...adp]
    .filter((a) => (a.espnMinusSleeper ?? 0) <= -3.5)
    .sort((a, b) => (a.espnMinusSleeper ?? 0) - (b.espnMinusSleeper ?? 0))
    .map((a) => ({
      playerName: a.playerName,
      position: (a.position as Position) || 'WR',
      espnAdp: a.espnAdp,
      sleeperAdp: a.sleeperAdp,
      yahooAdp: a.yahooAdp,
      underdogAdp: a.underdogAdp,
      espnMinusSleeper: a.espnMinusSleeper,
      espnMinusUnderdog: a.espnMinusUnderdog,
    }));

  return {
    ranksSource: 'ESPN room vs industry ECR (FantasyPros consensus) and multi-site ADP',
    ranksCount: enrichmentStore.listSiteRanks().length,
    adpSource: 'Cross-site ADP (ESPN vs Sleeper / Yahoo / Underdog, Aug 24)',
    adpCount: enrichmentStore.listSiteAdp().length,
    draftDepth: draftPicks,
    values,
    sleepers,
    landmines,
    adpValues,
    adpLandmines,
  };
}

let routeEngine: {
  board: RankedPlayer[];
  eliteTe: Set<string>;
  roster: RosterSettings;
  leagueSize: number;
  rounds: number;
  playbook: ContenderPlaybook;
} | null = null;

async function ranksNote(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(enrichmentDir(), 'espn-ranks-meta.json'), 'utf-8');
    const meta = JSON.parse(raw) as { fetchedAt?: string };
    if (!meta.fetchedAt) return '';
    const day = new Date(meta.fetchedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return ` ESPN PPR ranks pulled ${day}.`;
  } catch {
    return '';
  }
}

export async function buildDraftRouteBook(
  drafts: DraftFile[],
  config: LeagueConfig,
  playbook: ContenderPlaybook
): Promise<DraftRouteBook> {
  await enrichmentStore.load();
  const roster = rosterOf(config);
  const season = enrichmentStore.latestRankingSeason();
  const wantedRounds = draftRounds(config, drafts);
  const liveNote = await ranksNote();
  const empty: DraftRouteBook = {
    season: season ?? new Date().getFullYear(),
    source: 'ESPN PPR overall',
    leagueSize: config.leagueSize,
    boardSize: 0,
    suggestedSlot: 5,
    slots: [],
    rosterLabel: formatRoster(roster),
    valueNote: `${wantedRounds}-round path from this league’s roster (${rosterSpotCount(roster)} spots) and recent drafts. Optionals include steals if the room passes and reaches that fill a need — tap one to rebuild the rest of the draft.${liveNote}`,
    openings: [],
    board: [],
  };
  if (season == null) return empty;

  const board = enrichmentStore.getAdpBoard(season).map(toPlayer);
  const maxRounds = Math.max(10, Math.floor(board.length / Math.max(1, config.leagueSize)));
  const rounds = Math.min(wantedRounds, maxRounds);
  const pathNote = `${rounds}-round path from this league’s roster (${rosterSpotCount(roster)} spots) and recent drafts. Optionals include steals if the room passes and reaches that fill a need — tap one to rebuild the rest of the draft.${liveNote}`;
  if (board.length < config.leagueSize * 10) {
    return {
      ...empty,
      season,
      boardSize: board.length,
      board: slimBoard(board),
      valueNote: pathNote,
    };
  }

  const eliteCutoff = config.leagueSize * 3;
  const eliteTe = new Set(
    board.filter((p) => p.position === 'TE' && p.rank <= eliteCutoff).map((p) => p.playerName)
  );
  if (eliteTe.size < 2) {
    for (const p of board.filter((p) => p.position === 'TE').slice(0, 2)) {
      eliteTe.add(p.playerName);
    }
  }
  const shapes = podiumShapesBySlot(drafts, config);
  const leagueOpenings = skillOpenings(playbook);
  const bestSlot = [...playbook.slotOutcomes].sort((a, b) => a.avgFinish - b.avgFinish)[0]?.slot;
  const suggestedSlot = Math.min(
    config.upcomingDraftSlot ?? lastUserSlot(drafts, config) ?? bestSlot ?? 5,
    config.leagueSize
  );

  const slots: SlotRoutePlan[] = [];
  for (let slot = 1; slot <= config.leagueSize; slot++) {
    const outcome = playbook.slotOutcomes.find((s) => s.slot === slot);
    const seat = seatFor(slot, config.leagueSize, playbook.slotOutcomes);
    const snakePicks = Array.from({ length: rounds }, (_, i) =>
      snakeOverall(slot, i + 1, config.leagueSize)
    );
    const slotShapes = shapes.get(slot) ?? [];
    const commonPodiumShape = mostCommon(slotShapes);

    const league = buildValueRoute(
      board,
      slot,
      config.leagueSize,
      roster,
      eliteTe,
      leagueThesis(slot, roster, commonPodiumShape),
      rounds
    );

    slots.push({
      slot,
      snakePicks,
      seatLabel: seat.label,
      seatDetail: seat.detail,
      historical: {
        avgFinish: outcome?.avgFinish ?? 0,
        titles: outcome?.titles ?? 0,
        top3Rate: outcome?.top3Rate ?? 0,
        commonPodiumShape,
        podiumSample: slotShapes.length,
      },
      routes: [league],
      openings: skillOpeningsForSlot(drafts, config, slot, leagueOpenings),
    });
  }

  routeEngine = {
    board,
    eliteTe,
    roster,
    leagueSize: config.leagueSize,
    rounds,
    playbook,
  };

  return {
    season,
    source: `ESPN PPR overall ${season}`,
    leagueSize: config.leagueSize,
    boardSize: board.length,
    board: slimBoard(board),
    suggestedSlot,
    slots,
    market: buildMarketBoard(config.leagueSize * rounds),
    rosterLabel: formatRoster(roster),
    valueNote: pathNote,
    openings: leagueOpenings,
  };
}

export async function listRankedBoard(): Promise<RankedPlayer[]> {
  if (routeEngine) return routeEngine.board;
  await enrichmentStore.load();
  const season = enrichmentStore.latestRankingSeason();
  if (season == null) return [];
  return enrichmentStore.getAdpBoard(season).map(toPlayer);
}

export async function listRouteBoard(): Promise<RouteBoardPlayer[]> {
  return slimBoard(await listRankedBoard());
}

const SEARCH_POS = new Set<Position>(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']);

/**
 * Ranked ESPN board plus depth-chart / YTD extras for header search.
 * Draft path scoring still uses listRankedBoard only.
 */
export async function listSearchBoard(): Promise<RouteBoardPlayer[]> {
  await enrichmentStore.load();
  const season = enrichmentStore.latestRankingSeason();
  if (season == null) return [];
  const ranked = await listRankedBoard();
  const seen = new Set(ranked.map((p) => normalizeName(p.playerName)));
  const extras: RouteBoardPlayer[] = [];
  let nextRank = ranked.length + 1;

  for (const d of enrichmentStore.getDepthRoster(season)) {
    if (!SEARCH_POS.has(d.position)) continue;
    const key = normalizeName(d.playerName);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push({
      playerName: d.playerName,
      position: d.position,
      rank: d.espnRank && d.espnRank > 0 ? d.espnRank : nextRank++,
    });
  }

  for (const p of enrichmentStore.listSeasonPoints(season)) {
    if (!SEARCH_POS.has(p.position)) continue;
    const key = normalizeName(p.playerName);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push({
      playerName: p.playerName,
      position: p.position,
      rank: nextRank++,
    });
  }

  extras.sort(
    (a, b) => a.rank - b.rank || a.playerName.localeCompare(b.playerName)
  );
  return [...slimBoard(ranked), ...extras];
}

/** Same team as the compare card — ranks / roster resolution, not stale site ADP alone. */
function boardTeam(player: RankedPlayer): string | undefined {
  return canonicalTeam(player.nflTeam);
}

function buildDepthChart(board: RankedPlayer[], player: RankedPlayer): DepthChartPlayer[] {
  const team = boardTeam(player);
  if (!team || team === 'FA') return [];
  const season = enrichmentStore.latestRankingSeason();
  type Row = DepthChartPlayer & { sortRank: number };
  const byName = new Map<string, Row>();

  for (const p of board) {
    if (boardTeam(p) !== team || p.position !== player.position) continue;
    byName.set(normalizeName(p.playerName), {
      playerName: p.playerName,
      depth: 0,
      rank: p.rank,
      posRank: p.posRank,
      status: p.status,
      sortRank: p.rank,
    });
  }

  if (season != null) {
    for (const d of enrichmentStore.getDepthRoster(season)) {
      if (d.position !== player.position) continue;
      if (canonicalTeam(d.nflTeam) !== team) continue;
      // Skip historical / empty ESPN stubs (no rank and no ownership).
      if (d.espnRank == null && (d.percentOwned == null || d.percentOwned <= 0)) {
        continue;
      }
      const key = normalizeName(d.playerName);
      const existing = byName.get(key);
      if (existing) {
        if (!existing.status && d.status) existing.status = d.status;
        continue;
      }
      const rank = d.espnRank && d.espnRank > 0 ? d.espnRank : 9999;
      byName.set(key, {
        playerName: d.playerName,
        depth: 0,
        rank,
        status: d.status,
        sortRank: rank,
      });
    }
  }

  return [...byName.values()]
    .sort((a, b) => a.sortRank - b.sortRank || a.playerName.localeCompare(b.playerName))
    .map((p, i) => ({
      playerName: p.playerName,
      depth: i + 1,
      rank: p.rank,
      posRank: p.posRank,
      status: p.status,
    }));
}

export async function buildPlayerCompare(playerName: string): Promise<PlayerCompare | null> {
  await enrichmentStore.load();
  const season = enrichmentStore.latestRankingSeason();
  if (season == null) return null;
  const board = routeEngine?.board ?? enrichmentStore.getAdpBoard(season).map(toPlayer);
  const key = normalizeName(playerName);
  let player =
    board.find((p) => normalizeName(p.playerName) === key) ??
    board.find(
      (p) =>
        key.length >= 3 &&
        (normalizeName(p.playerName).includes(key) || key.includes(normalizeName(p.playerName)))
    );

  if (!player) {
    const depth = enrichmentStore.getDepthPlayer(playerName, season);
    const points = enrichmentStore.getSeasonPoints(playerName, season);
    const site = enrichmentStore.getSiteRank(playerName);
    const ecr = enrichmentStore.getConsensusRank(playerName);
    const name =
      depth?.playerName ??
      points?.playerName ??
      site?.playerName ??
      ecr?.playerName;
    const position = (depth?.position ??
      points?.position ??
      site?.position ??
      ecr?.position) as Position | undefined;
    if (!name || !position || !SEARCH_POS.has(position)) return null;
    player = toPlayer({
      playerName: name,
      season,
      position,
      adp: depth?.espnRank ?? site?.espnRank ?? 9999,
      expectedPoints: undefined,
    });
    if (!player.nflTeam) {
      player = {
        ...player,
        nflTeam:
          depth?.nflTeam ??
          points?.nflTeam ??
          site?.nflTeam ??
          ecr?.nflTeam ??
          player.nflTeam,
      };
    }
  }

  const lastSeason = season - 1;
  const priorSeason = season - 2;
  const thisYear = enrichmentStore.getSeasonPoints(player.playerName, season);
  const last = enrichmentStore.getSeasonPoints(player.playerName, lastSeason);
  const prior = enrichmentStore.getSeasonPoints(player.playerName, priorSeason);
  const thisGames = thisYear?.gamesPlayed && thisYear.gamesPlayed > 0 ? thisYear.gamesPlayed : undefined;
  const games = last?.gamesPlayed && last.gamesPlayed > 0 ? last.gamesPlayed : undefined;
  const priorGames = prior?.gamesPlayed && prior.gamesPlayed > 0 ? prior.gamesPlayed : undefined;
  const qb = enrichmentStore.getTeamQb(player.nflTeam);
  const team = enrichmentStore.getTeamRanks(player.nflTeam, season);
  const teamPrev = enrichmentStore.getTeamRanks(player.nflTeam, lastSeason);
  const posRank =
    board
      .filter((p) => p.position === player.position)
      .sort((a, b) => a.rank - b.rank)
      .findIndex((p) => p.playerName === player.playerName) + 1;
  const qbRank = qb
    ? enrichmentStore.getEspnPosRank(qb.playerName, 'QB')
    : undefined;

  return {
    player,
    posRank: posRank > 0 ? posRank : enrichmentStore.getEspnPosRank(player.playerName, player.position),
    qbName: qb?.playerName,
    qbRank,
    yearsWithQb:
      qb && player.nflTeam
        ? enrichmentStore.yearsWithQb(player.playerName, qb.playerName, player.nflTeam, season)
        : undefined,
    offenseRank: team?.offenseRank,
    offenseRankPrev: teamPrev?.offenseRank,
    olineRank: team?.olineRank,
    olineRankPrev: teamPrev?.olineRank,
    lastSeason,
    lastYearPoints: last?.fantasyPoints,
    lastYearRank: last ? enrichmentStore.getEosRank(player.playerName, lastSeason) : undefined,
    lastYearPosRank: last
      ? enrichmentStore.getPositionalEosRank(player.playerName, lastSeason)
      : undefined,
    lastYearGames: games,
    lastYearAvg:
      last && games != null ? Math.round((last.fantasyPoints / games) * 10) / 10 : undefined,
    thisSeason: thisYear ? season : undefined,
    thisYearPoints: thisYear?.fantasyPoints,
    thisYearGames: thisGames,
    thisYearAvg:
      thisYear && thisGames != null
        ? Math.round((thisYear.fantasyPoints / thisGames) * 10) / 10
        : undefined,
    priorSeason: prior ? priorSeason : undefined,
    priorYearPoints: prior?.fantasyPoints,
    priorYearAvg:
      prior && priorGames != null
        ? Math.round((prior.fantasyPoints / priorGames) * 10) / 10
        : undefined,
    takeaways: enrichmentStore.takeawaysForPlayer(player.playerName),
    depthChart: buildDepthChart(board, player),
    depthChartTeam: boardTeam(player),
  };
}

function engineMatches(config: LeagueConfig): boolean {
  if (!routeEngine) return false;
  const roster = rosterOf(config);
  return (
    routeEngine.leagueSize === config.leagueSize &&
    routeEngine.roster.wr === roster.wr &&
    routeEngine.roster.flex === roster.flex &&
    (routeEngine.roster.superflex ?? 0) === (roster.superflex ?? 0) &&
    routeEngine.roster.rb === roster.rb
  );
}

export async function replayDraftRoute(
  drafts: DraftFile[],
  config: LeagueConfig,
  playbook: ContenderPlaybook,
  opts: RouteReplayOpts
): Promise<DraftRoute> {
  if (!engineMatches(config)) {
    await buildDraftRouteBook(drafts, config, playbook);
  }
  const engine = routeEngine;
  if (!engine) {
    throw new Error('Draft board is not loaded');
  }
  const shapes = podiumShapesBySlot(drafts, config);
  const commonPodiumShape = mostCommon(shapes.get(opts.slot) ?? []);
  return buildValueRoute(
    engine.board,
    opts.slot,
    engine.leagueSize,
    engine.roster,
    engine.eliteTe,
    leagueThesis(opts.slot, engine.roster, commonPodiumShape),
    engine.rounds,
    opts
  );
}
