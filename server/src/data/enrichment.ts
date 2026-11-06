import path from 'path';
import fs from 'fs/promises';
import type { AdpEntry, DepthRosterEntry, PlayerEnrichment, Position } from '../types';
import { enrichmentDir } from '../data/store';
import {
  blendDefStatsRates,
  blendOffStatsRates,
  currentSeasonWeight,
  mixScore,
  priorFade,
  ranksFromDefStats,
  ranksFromOffStats,
  rankToSosScore,
  softAnchorDefRanks,
  type DefStats as BlendDefStats,
  type OffStats as BlendOffStats,
} from '../analysis/sosBlend';
import { asTdPos } from '../analysis/tdMatchup';
import type { TdDefenseSeason, TdGameRow, TdPlayerSeason } from '../analysis/tdMatchup';

export interface SiteRankEntry {
  playerName: string;
  position: string;
  nflTeam?: string;
  adp?: number;
  fantasyPros?: number;
  espnRank?: number;
  espnVsFp?: number;
  landmine?: number;
  bye?: number;
}

export interface SiteAdpEntry {
  playerName: string;
  position: string;
  nflTeam?: string;
  espnAdp?: number;
  sleeperAdp?: number;
  yahooAdp?: number;
  underdogAdp?: number;
  espnMinusSleeper?: number;
  espnMinusUnderdog?: number;
}

export interface TeamRankEntry {
  team: string;
  offenseRank?: number;
  olineRank?: number;
}

export interface TeamQbEntry {
  playerName: string;
  rank: number;
}

export interface SosEntry {
  team: string;
  overall: number;
  qb?: number;
  rb?: number;
  wr?: number;
  te?: number;
}

export interface ConsensusRankEntry {
  playerName: string;
  position: string;
  nflTeam?: string;
  ecr: number;
  ecrPos?: number;
  ecrBest?: number;
  ecrWorst?: number;
  ecrStdev?: number;
  experts?: number;
}

export interface ConsensusUnitEntry {
  team: string;
  oline?: number;
  dline?: number;
  offense?: number;
  power?: number;
}

export interface ExpertTakeaway {
  id: string;
  topic: string;
  claim: string;
  sources: string[];
  players: string[];
  positions: string[];
  rounds: number[];
}

export interface DefenseRankEntry {
  team: string;
  overall: number;
  qb: number;
  rb: number;
  wr: number;
  te: number;
}

export interface OffenseRankEntry {
  team: string;
  overall: number;
}

export type GameStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';

export interface ScheduleGame {
  team: string;
  week: number;
  opponent?: string;
  home?: boolean;
  bye?: boolean;
  kickoff?: string;
  status?: GameStatus;
  teamScore?: number;
  oppScore?: number;
}

export interface SeasonState {
  season: number;
  completedWeeks: number;
  currentWeek: number;
  asOf?: string;
}

export interface DefStats {
  pa: number;
  oppPass: number;
  oppRush: number;
}

export interface OffStats {
  pointsFor: number;
}

/** nflverse usage metrics for My Team Stats (snap / air yards / YAC / aDOT / shares). */
export interface PlayerUsageEntry {
  playerName: string;
  season: number;
  position?: string;
  nflTeam?: string;
  snapPct?: number;
  airYards?: number;
  yac?: number;
  adot?: number;
  targetShare?: number;
  carryShare?: number;
  routePct?: number;
  targets?: number;
  carries?: number;
}

interface UnitAdj {
  offense?: number;
  oline?: number;
  latest: number;
  prior: number;
}

const TEAM_ALIASES: Record<string, string> = {
  LAR: 'LA',
  STL: 'LA',
  JAC: 'JAX',
  WSH: 'WAS',
  WAS: 'WAS',
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

export function canonicalTeam(team?: string): string | undefined {
  if (!team) return undefined;
  const key = team.toUpperCase().replace(/[^A-Z]/g, '');
  if (!key) return undefined;
  return TEAM_ALIASES[key] ?? key;
}

/** NFL nicknames → abbr (D/ST names like "Jaguars D/ST"). */
const NICK_TO_ABBR: Record<string, string> = {
  Cardinals: 'ARI',
  Falcons: 'ATL',
  Ravens: 'BAL',
  Bills: 'BUF',
  Panthers: 'CAR',
  Bears: 'CHI',
  Bengals: 'CIN',
  Browns: 'CLE',
  Cowboys: 'DAL',
  Broncos: 'DEN',
  Lions: 'DET',
  Packers: 'GB',
  Texans: 'HOU',
  Colts: 'IND',
  Jaguars: 'JAX',
  Chiefs: 'KC',
  Raiders: 'LV',
  Chargers: 'LAC',
  Rams: 'LA',
  Dolphins: 'MIA',
  Vikings: 'MIN',
  Patriots: 'NE',
  Saints: 'NO',
  Giants: 'NYG',
  Jets: 'NYJ',
  Eagles: 'PHI',
  Steelers: 'PIT',
  '49ers': 'SF',
  Seahawks: 'SEA',
  Buccaneers: 'TB',
  Titans: 'TEN',
  Commanders: 'WAS',
};

const ABBR_TO_NICK: Record<string, string> = Object.fromEntries(
  Object.entries(NICK_TO_ABBR).map(([nick, abbr]) => [abbr, nick])
);

/** Resolve NFL team from a D/ST display name ("Jaguars D/ST" → JAX). */
export function dstTeamFromName(name?: string): string | undefined {
  if (!name) return undefined;
  const cleaned = name.replace(/\s+D\/ST$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const nick = parts[parts.length - 1] ?? cleaned;
  return NICK_TO_ABBR[nick] ?? canonicalTeam(nick);
}

/** Abbr → nickname for D/ST display ("JAX" → "Jaguars"). */
export function dstNickFromTeam(team?: string): string | undefined {
  const abbr = canonicalTeam(team);
  if (!abbr) return undefined;
  return ABBR_TO_NICK[abbr];
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function readCsv(filePath: string): Promise<string[][]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map(parseCsvLine);
  } catch {
    return [];
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function num(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseHomeFlag(value: string | undefined): boolean | undefined {
  if (value == null || value.trim() === '') return undefined;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'h' || v === 'home') return true;
  if (v === '0' || v === 'false' || v === 'a' || v === 'away') return false;
  return undefined;
}

function parseTdWeeks(raw: string): Map<number, number> {
  const out = new Map<number, number>();
  if (!raw) return out;
  for (const part of raw.split('|')) {
    const [weekStr, tdStr] = part.split(':');
    const week = parseInt(weekStr ?? '', 10);
    const tds = parseFloat(tdStr ?? '');
    if (Number.isFinite(week) && week >= 1) out.set(week, Number.isFinite(tds) ? tds : 0);
  }
  return out;
}

function colIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const exact = normalized.indexOf(key);
    if (exact >= 0) return exact;
    const partial = normalized.findIndex((h) => h.includes(key));
    if (partial >= 0) return partial;
  }
  return -1;
}

export class EnrichmentStore {
  private points: PlayerEnrichment[] = [];
  private adp: AdpEntry[] = [];
  /** `${season}::${normalizedName}` -> overall PPR finish (1 = highest scorer) */
  private eosRankByKey = new Map<string, number>();
  /** normalized player name -> NFL draft year (rookie season) */
  private draftYearByName = new Map<string, number>();
  /** normalized player name -> first season with fantasy points (UDFA heuristic) */
  private firstPointsSeasonByName = new Map<string, number>();
  /** `${season}::${normalizedName}` exact indexes */
  private pointsByKey = new Map<string, PlayerEnrichment>();
  private adpByKey = new Map<string, AdpEntry>();
  private pointsBySeason = new Map<number, PlayerEnrichment[]>();
  private adpBySeason = new Map<number, AdpEntry[]>();
  private siteRankByName = new Map<string, SiteRankEntry>();
  private siteAdpByName = new Map<string, SiteAdpEntry>();
  private sosByTeam = new Map<string, SosEntry>();
  /** `${team}::QB|RB|WR|TE|ALL` -> 1 (easiest) through 32 (toughest) */
  private sosRankByPos = new Map<string, number>();
  private scheduleByTeam = new Map<string, ScheduleGame[]>();
  /** Blended remaining-slate D ranks (1 = easiest). */
  private defenseByTeam = new Map<string, DefenseRankEntry>();
  /** Through-week current-season D ranks when present. */
  private currentDefenseByTeam = new Map<string, DefenseRankEntry>();
  private offenseByTeam = new Map<string, OffenseRankEntry>();
  private currentOffenseByTeam = new Map<string, OffenseRankEntry>();
  private defenseStatsBySeason = new Map<number, Map<string, BlendDefStats>>();
  private offenseStatsBySeason = new Map<number, Map<string, BlendOffStats>>();
  private defenseRanksBySeason = new Map<number, Map<string, DefenseRankEntry>>();
  private offenseRanksBySeason = new Map<number, Map<string, OffenseRankEntry>>();
  /** Through-week O-line ranks from PBP sack rate (1 = lowest sack rate). */
  private olineRanksBySeason = new Map<number, Map<string, number>>();
  private dstRankByTeam = new Map<string, number>();
  private playerStatusByName = new Map<string, string>();
  /** season → depth-chart extras (not on the ranked ADP board) */
  private depthBySeason = new Map<number, DepthRosterEntry[]>();
  /** `${season}::${normalizeName}` → usage (snap / air / YAC / shares) */
  private usageByKey = new Map<string, PlayerUsageEntry>();
  /** season → all usage rows (for positional rank pools) */
  private usageBySeason = new Map<number, PlayerUsageEntry[]>();
  /** season → normalizeName → ESPN athlete id for game logs */
  private espnIdsBySeason = new Map<number, Map<string, number>>();
  private scheduleWeeks = 18;
  private seasonState: SeasonState | undefined;
  /** Preseason DraftEdge/FPA 1–5 before remaining-slate mix. */
  private priorSosByTeam = new Map<string, SosEntry>();
  /** season -> team -> ranks */
  private teamRanksBySeason = new Map<number, Map<string, TeamRankEntry>>();
  /** Latest vs prior season: positive = improved (rank moved toward 1). */
  private unitAdjByTeam = new Map<string, UnitAdj>();
  private unitSeasons: { latest: number; prior: number } | undefined;
  private qbByTeam = new Map<string, TeamQbEntry>();
  private consensusRankByName = new Map<string, ConsensusRankEntry>();
  private consensusUnitsByTeam = new Map<string, ConsensusUnitEntry>();
  private expertTakeaways: ExpertTakeaway[] = [];
  private sosSourceNote?: string;
  private tdPlayerByKey = new Map<string, TdPlayerSeason>();
  private tdDefenseByKey = new Map<string, TdDefenseSeason>();
  private tdGamesByName = new Map<string, TdGameRow[]>();
  private loaded = false;
  private loading: Promise<void> | null = null;
  private dataMtime = 0;

  async load(): Promise<void> {
    // Join an in-flight reload before (and after) the mtime check so a concurrent
    // reset cannot empty the store under a caller that already returned from load().
    if (this.loading) return this.loading;
    const mtime = await this.watchMtime();
    if (this.loading) return this.loading;
    if (this.loaded && mtime === this.dataMtime) return;
    this.loaded = false;
    this.loading = this.loadNow(mtime).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async watchMtime(): Promise<number> {
    const dir = enrichmentDir();
    const files = [
      'adp.csv',
      'season-state.json',
      'fantasy-points.csv',
      'poolgenius-survivor-2026.json',
      'game-context-2026.json',
      'consensus-sos-2026.csv',
      'td-player.csv',
      'td-defense-by-pos.csv',
      'td-player-games.csv',
      'espn-depth-2026.csv',
      'espn-ids-2026.csv',
      'espn-ppr-overall/2026.csv',
      'player-usage-2026.csv',
    ];
    let max = 0;
    for (const file of files) {
      try {
        max = Math.max(max, (await fs.stat(path.join(dir, file))).mtimeMs);
      } catch {
        // missing is fine
      }
    }
    return max;
  }

  private reset(): void {
    this.points = [];
    this.adp = [];
    this.eosRankByKey.clear();
    this.draftYearByName.clear();
    this.firstPointsSeasonByName.clear();
    this.pointsByKey.clear();
    this.adpByKey.clear();
    this.pointsBySeason.clear();
    this.adpBySeason.clear();
    this.siteRankByName.clear();
    this.siteAdpByName.clear();
    this.sosByTeam.clear();
    this.sosRankByPos.clear();
    this.scheduleByTeam.clear();
    this.defenseByTeam.clear();
    this.currentDefenseByTeam.clear();
    this.offenseByTeam.clear();
    this.currentOffenseByTeam.clear();
    this.defenseStatsBySeason.clear();
    this.offenseStatsBySeason.clear();
    this.defenseRanksBySeason.clear();
    this.offenseRanksBySeason.clear();
    this.olineRanksBySeason.clear();
    this.dstRankByTeam.clear();
    this.playerStatusByName.clear();
    this.depthBySeason.clear();
    this.usageByKey.clear();
    this.usageBySeason.clear();
    this.espnIdsBySeason.clear();
    this.scheduleWeeks = 18;
    this.seasonState = undefined;
    this.priorSosByTeam.clear();
    this.teamRanksBySeason.clear();
    this.unitAdjByTeam.clear();
    this.unitSeasons = undefined;
    this.qbByTeam.clear();
    this.consensusRankByName.clear();
    this.consensusUnitsByTeam.clear();
    this.expertTakeaways = [];
    this.sosSourceNote = undefined;
    this.tdPlayerByKey.clear();
    this.tdDefenseByKey.clear();
    this.tdGamesByName.clear();
  }

  private async loadNow(mtime: number): Promise<void> {
    this.reset();
    const dir = enrichmentDir();
    const pointsRows = await readCsv(path.join(dir, 'fantasy-points.csv'));
    const adpRows = await readCsv(path.join(dir, 'adp.csv'));
    const draftRows = await readCsv(path.join(dir, 'draft-picks.csv'));

    if (pointsRows.length > 1) {
      const headers = pointsRows[0].map((h) => h.toLowerCase());
      const nameIdx = headers.indexOf('playername');
      const seasonIdx = headers.indexOf('season');
      const posIdx = headers.indexOf('position');
      const teamIdx = headers.indexOf('nflteam');
      const ptsIdx = headers.indexOf('fantasypoints');
      const gpIdx = headers.indexOf('gamesplayed');

      for (const row of pointsRows.slice(1)) {
        const playerName = row[nameIdx];
        const season = parseInt(row[seasonIdx], 10);
        this.points.push({
          playerName,
          season,
          position: row[posIdx] as Position,
          nflTeam: row[teamIdx] ?? '',
          fantasyPoints: parseFloat(row[ptsIdx]) || 0,
          gamesPlayed: gpIdx >= 0 ? parseInt(row[gpIdx], 10) || undefined : undefined,
        });

        const key = normalizeName(playerName);
        const prev = this.firstPointsSeasonByName.get(key);
        if (prev == null || season < prev) {
          this.firstPointsSeasonByName.set(key, season);
        }
        const rowKey = `${season}::${key}`;
        const entry = this.points[this.points.length - 1];
        if (!this.pointsByKey.has(rowKey)) this.pointsByKey.set(rowKey, entry);
        const seasonList = this.pointsBySeason.get(season) ?? [];
        seasonList.push(entry);
        this.pointsBySeason.set(season, seasonList);
      }

      const bySeason = new Map<number, PlayerEnrichment[]>();
      for (const p of this.points) {
        const list = bySeason.get(p.season) ?? [];
        list.push(p);
        bySeason.set(p.season, list);
      }
      for (const [season, list] of bySeason) {
        list.sort((a, b) => b.fantasyPoints - a.fantasyPoints);
        list.forEach((p, i) => {
          this.eosRankByKey.set(`${season}::${normalizeName(p.playerName)}`, i + 1);
        });
      }
    }

    if (adpRows.length > 1) {
      const headers = adpRows[0].map((h) => h.toLowerCase());
      const nameIdx = headers.indexOf('playername');
      const seasonIdx = headers.indexOf('season');
      const posIdx = headers.indexOf('position');
      const adpIdx = headers.indexOf('adp');
      const expIdx = headers.indexOf('expectedpoints');

      for (const row of adpRows.slice(1)) {
        const entry: AdpEntry = {
          playerName: row[nameIdx],
          season: parseInt(row[seasonIdx], 10),
          position: row[posIdx] as Position,
          adp: parseFloat(row[adpIdx]) || 999,
          expectedPoints: expIdx >= 0 ? parseFloat(row[expIdx]) || undefined : undefined,
        };
        this.adp.push(entry);
        const rowKey = `${entry.season}::${normalizeName(entry.playerName)}`;
        if (!this.adpByKey.has(rowKey)) this.adpByKey.set(rowKey, entry);
        const seasonList = this.adpBySeason.get(entry.season) ?? [];
        seasonList.push(entry);
        this.adpBySeason.set(entry.season, seasonList);
      }
    }

    if (draftRows.length > 1) {
      const headers = draftRows[0].map((h) => h.toLowerCase());
      const nameIdx = headers.indexOf('playername');
      const yearIdx = headers.indexOf('draftyear');

      for (const row of draftRows.slice(1)) {
        const playerName = row[nameIdx];
        const draftYear = parseInt(row[yearIdx], 10);
        if (!playerName || !Number.isFinite(draftYear)) continue;
        const key = normalizeName(playerName);
        const prev = this.draftYearByName.get(key);
        // Keep earliest draft year if duplicates appear
        if (prev == null || draftYear < prev) {
          this.draftYearByName.set(key, draftYear);
        }
      }
    }

    const rankRows = await readCsv(path.join(dir, 'site-ranks-espn-ppr-2026.csv'));
    if (rankRows.length > 1) {
      const headers = rankRows[0];
      const nameIdx = colIndex(headers, 'name', 'player', 'playername');
      const posIdx = colIndex(headers, 'pos', 'position');
      const teamIdx = colIndex(headers, 'team');
      const adpIdx = colIndex(headers, 'adp');
      const fpIdx = colIndex(headers, 'fantasypros', 'fp', 'ecr');
      const espnIdx = colIndex(headers, 'espn');
      const vsIdx = colIndex(headers, 'espnvfp');
      const mineIdx = colIndex(headers, 'landmine');
      const byeIdx = colIndex(headers, 'bye');
      if (nameIdx >= 0) {
        for (const row of rankRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          if (!playerName) continue;
          const entry: SiteRankEntry = {
            playerName,
            position: row[posIdx] ?? '',
            nflTeam: teamIdx >= 0 ? row[teamIdx] : undefined,
            adp: num(row[adpIdx]),
            fantasyPros: num(row[fpIdx]),
            espnRank: num(row[espnIdx]),
            espnVsFp: num(row[vsIdx]),
            landmine: num(row[mineIdx]),
            bye: byeIdx >= 0 ? num(row[byeIdx]) : undefined,
          };
          this.siteRankByName.set(normalizeName(playerName), entry);
        }
      }
    }

    const siteAdpRows = await readCsv(path.join(dir, 'site-adp-2026.csv'));
    if (siteAdpRows.length > 1) {
      const headers = siteAdpRows[0];
      const nameIdx = colIndex(headers, 'player', 'playername', 'name');
      const posIdx = colIndex(headers, 'position', 'pos');
      const teamIdx = colIndex(headers, 'team');
      const espnIdx = colIndex(headers, 'espn');
      const sleeperIdx = colIndex(headers, 'sleeper');
      const yahooIdx = colIndex(headers, 'yahoo');
      const udIdx = colIndex(headers, 'underdog');
      const vsSleeperIdx = headers.findIndex((h) =>
        /espn\s*-\s*sleeper/i.test(h)
      );
      const vsUdIdx = headers.findIndex((h) => /espn\s*-\s*underdog/i.test(h));
      if (nameIdx >= 0) {
        for (const row of siteAdpRows.slice(1)) {
          const playerName = row[nameIdx]?.trim();
          if (!playerName) continue;
          const entry: SiteAdpEntry = {
            playerName,
            position: row[posIdx] ?? '',
            nflTeam: teamIdx >= 0 ? row[teamIdx] : undefined,
            espnAdp: num(row[espnIdx]),
            sleeperAdp: num(row[sleeperIdx]),
            yahooAdp: num(row[yahooIdx]),
            underdogAdp: num(row[udIdx]),
            espnMinusSleeper: vsSleeperIdx >= 0 ? num(row[vsSleeperIdx]) : undefined,
            espnMinusUnderdog: vsUdIdx >= 0 ? num(row[vsUdIdx]) : undefined,
          };
          this.siteAdpByName.set(normalizeName(playerName), entry);
        }
      }
    }

    await this.loadSosFile(path.join(dir, 'sos-2026.csv'));
    this.sosSourceNote = undefined;

    const files = await fs.readdir(dir);
    for (const file of files) {
      const teamRankMatch = /^team-ranks-(\d{4})\.csv$/i.exec(file);
      if (teamRankMatch) {
        const season = Number(teamRankMatch[1]);
        const teamRankRows = await readCsv(path.join(dir, file));
        if (teamRankRows.length < 2) continue;
        const headers = teamRankRows[0];
        const teamIdx = colIndex(headers, 'team');
        const offIdx = colIndex(headers, 'offenserank', 'offense');
        const olIdx = colIndex(headers, 'olinerank', 'oline');
        if (teamIdx < 0) continue;
        const byTeam = this.teamRanksBySeason.get(season) ?? new Map<string, TeamRankEntry>();
        for (const row of teamRankRows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          if (!team) continue;
          byTeam.set(team, {
            team,
            offenseRank: offIdx >= 0 ? num(row[offIdx]) : undefined,
            olineRank: olIdx >= 0 ? num(row[olIdx]) : undefined,
          });
        }
        this.teamRanksBySeason.set(season, byTeam);
        continue;
      }

      const defStatsMatch = /^defense-stats-(\d{4})\.csv$/i.exec(file);
      if (defStatsMatch) {
        const season = Number(defStatsMatch[1]);
        const rows = await readCsv(path.join(dir, file));
        if (rows.length < 2) continue;
        const headers = rows[0];
        const teamIdx = colIndex(headers, 'team');
        const paIdx = colIndex(headers, 'pa', 'pointsagainst');
        const passIdx = colIndex(headers, 'opppass', 'pass');
        const rushIdx = colIndex(headers, 'opprush', 'rush');
        if (teamIdx < 0) continue;
        const byTeam = this.defenseStatsBySeason.get(season) ?? new Map<string, BlendDefStats>();
        for (const row of rows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          const pa = num(row[paIdx]);
          if (!team || pa == null) continue;
          byTeam.set(team, {
            pa,
            oppPass: num(row[passIdx]) ?? pa,
            oppRush: num(row[rushIdx]) ?? pa,
          });
        }
        this.defenseStatsBySeason.set(season, byTeam);
        continue;
      }

      const offStatsMatch = /^offense-stats-(\d{4})\.csv$/i.exec(file);
      if (offStatsMatch) {
        const season = Number(offStatsMatch[1]);
        const rows = await readCsv(path.join(dir, file));
        if (rows.length < 2) continue;
        const headers = rows[0];
        const teamIdx = colIndex(headers, 'team');
        const pfIdx = colIndex(headers, 'pointsfor', 'pf', 'points');
        if (teamIdx < 0) continue;
        const byTeam = this.offenseStatsBySeason.get(season) ?? new Map<string, BlendOffStats>();
        for (const row of rows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          const pointsFor = num(row[pfIdx]);
          if (!team || pointsFor == null) continue;
          byTeam.set(team, { pointsFor });
        }
        this.offenseStatsBySeason.set(season, byTeam);
        continue;
      }

      const defMatch = /^defense-ranks-(\d{4})\.csv$/i.exec(file);
      if (defMatch) {
        const season = Number(defMatch[1]);
        const defRows = await readCsv(path.join(dir, file));
        if (defRows.length < 2) continue;
        const headers = defRows[0];
        const teamIdx = colIndex(headers, 'team');
        const overallIdx = colIndex(headers, 'overall');
        const qbIdx = colIndex(headers, 'qb');
        const rbIdx = colIndex(headers, 'rb');
        const wrIdx = colIndex(headers, 'wr');
        const teIdx = colIndex(headers, 'te');
        if (teamIdx < 0) continue;
        const byTeam = this.defenseRanksBySeason.get(season) ?? new Map<string, DefenseRankEntry>();
        for (const row of defRows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          const overall = num(row[overallIdx]);
          if (!team || overall == null) continue;
          byTeam.set(team, {
            team,
            overall,
            qb: num(row[qbIdx]) ?? overall,
            rb: num(row[rbIdx]) ?? overall,
            wr: num(row[wrIdx]) ?? overall,
            te: num(row[teIdx]) ?? overall,
          });
        }
        this.defenseRanksBySeason.set(season, byTeam);
        continue;
      }

      const offMatch = /^offense-ranks-(\d{4})\.csv$/i.exec(file);
      if (offMatch) {
        const season = Number(offMatch[1]);
        const offRows = await readCsv(path.join(dir, file));
        if (offRows.length < 2) continue;
        const headers = offRows[0];
        const teamIdx = colIndex(headers, 'team');
        const overallIdx = colIndex(headers, 'overall');
        if (teamIdx < 0) continue;
        const byTeam = this.offenseRanksBySeason.get(season) ?? new Map<string, OffenseRankEntry>();
        for (const row of offRows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          const overall = num(row[overallIdx]);
          if (!team || overall == null) continue;
          byTeam.set(team, { team, overall });
        }
        this.offenseRanksBySeason.set(season, byTeam);
        continue;
      }

      const olineMatch = /^oline-ranks-(\d{4})\.csv$/i.exec(file);
      if (olineMatch) {
        const season = Number(olineMatch[1]);
        const olRows = await readCsv(path.join(dir, file));
        if (olRows.length < 2) continue;
        const headers = olRows[0];
        const teamIdx = colIndex(headers, 'team');
        const overallIdx = colIndex(headers, 'overall', 'rank');
        if (teamIdx < 0 || overallIdx < 0) continue;
        const byTeam = this.olineRanksBySeason.get(season) ?? new Map<string, number>();
        for (const row of olRows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          const overall = num(row[overallIdx]);
          if (!team || overall == null) continue;
          byTeam.set(team, overall);
        }
        this.olineRanksBySeason.set(season, byTeam);
        continue;
      }

      const statusMatch = /^player-status-(\d{4})\.csv$/i.exec(file);
      if (statusMatch) {
        const statusRows = await readCsv(path.join(dir, file));
        if (statusRows.length < 2) continue;
        const headers = statusRows[0];
        const nameIdx = colIndex(headers, 'playername', 'name', 'player');
        const statusIdx = colIndex(headers, 'status', 'injurystatus');
        if (nameIdx < 0 || statusIdx < 0) continue;
        for (const row of statusRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          const status = row[statusIdx]?.trim();
          if (!playerName || !status) continue;
          this.playerStatusByName.set(normalizeName(playerName), status);
        }
        continue;
      }

      const depthMatch = /^espn-depth-(\d{4})\.csv$/i.exec(file);
      if (depthMatch) {
        const season = Number(depthMatch[1]);
        const depthRows = await readCsv(path.join(dir, file));
        if (depthRows.length < 2) continue;
        const headers = depthRows[0];
        const nameIdx = colIndex(headers, 'playername', 'name', 'player');
        const posIdx = colIndex(headers, 'position', 'pos');
        const teamIdx = colIndex(headers, 'nflteam', 'team');
        const rankIdx = colIndex(headers, 'espnrank', 'rank');
        const idIdx = colIndex(headers, 'espnid', 'athleteid', 'id');
        const statusIdx = colIndex(headers, 'status');
        const ownedIdx = colIndex(headers, 'percentowned', 'owned');
        if (nameIdx < 0 || posIdx < 0) continue;
        const list: DepthRosterEntry[] = [];
        for (const row of depthRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          const position = row[posIdx]?.trim() as Position;
          if (!playerName || !position) continue;
          const espnId = idIdx >= 0 ? num(row[idIdx]) : undefined;
          list.push({
            playerName,
            season,
            position,
            nflTeam: teamIdx >= 0 ? canonicalTeam(row[teamIdx]) : undefined,
            espnRank: rankIdx >= 0 ? num(row[rankIdx]) : undefined,
            espnId: espnId != null && espnId > 0 ? espnId : undefined,
            status: statusIdx >= 0 ? row[statusIdx]?.trim() || undefined : undefined,
            percentOwned: ownedIdx >= 0 ? num(row[ownedIdx]) : undefined,
          });
        }
        this.depthBySeason.set(season, list);
        continue;
      }

      const usageMatch = /^player-usage-(\d{4})\.csv$/i.exec(file);
      if (usageMatch) {
        const season = Number(usageMatch[1]);
        const usageRows = await readCsv(path.join(dir, file));
        if (usageRows.length < 2) continue;
        const headers = usageRows[0];
        const nameIdx = colIndex(headers, 'playername', 'name', 'player');
        const posIdx = colIndex(headers, 'position', 'pos');
        const teamIdx = colIndex(headers, 'nflteam', 'team');
        const snapIdx = colIndex(headers, 'snappct', 'snap');
        const airIdx = colIndex(headers, 'airyards', 'air');
        const yacIdx = colIndex(headers, 'yac');
        const adotIdx = colIndex(headers, 'adot');
        const tgtShareIdx = colIndex(headers, 'targetshare');
        const carryShareIdx = colIndex(headers, 'carryshare');
        const routeIdx = colIndex(headers, 'routepct', 'route');
        const targetsIdx = colIndex(headers, 'targets');
        const carriesIdx = colIndex(headers, 'carries');
        if (nameIdx < 0) continue;
        for (const row of usageRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          if (!playerName) continue;
          const entry: PlayerUsageEntry = {
            playerName,
            season,
            position: posIdx >= 0 ? row[posIdx]?.trim() || undefined : undefined,
            nflTeam: teamIdx >= 0 ? canonicalTeam(row[teamIdx]) : undefined,
            snapPct: snapIdx >= 0 ? num(row[snapIdx]) : undefined,
            airYards: airIdx >= 0 ? num(row[airIdx]) : undefined,
            yac: yacIdx >= 0 ? num(row[yacIdx]) : undefined,
            adot: adotIdx >= 0 ? num(row[adotIdx]) : undefined,
            targetShare: tgtShareIdx >= 0 ? num(row[tgtShareIdx]) : undefined,
            carryShare: carryShareIdx >= 0 ? num(row[carryShareIdx]) : undefined,
            routePct: routeIdx >= 0 ? num(row[routeIdx]) : undefined,
            targets: targetsIdx >= 0 ? num(row[targetsIdx]) : undefined,
            carries: carriesIdx >= 0 ? num(row[carriesIdx]) : undefined,
          };
          this.usageByKey.set(`${season}::${normalizeName(playerName)}`, entry);
          const usageList = this.usageBySeason.get(season) ?? [];
          usageList.push(entry);
          this.usageBySeason.set(season, usageList);
        }
        continue;
      }

      const idsMatch = /^espn-ids-(\d{4})\.csv$/i.exec(file);
      if (idsMatch) {
        const season = Number(idsMatch[1]);
        const idRows = await readCsv(path.join(dir, file));
        if (idRows.length < 2) continue;
        const headers = idRows[0];
        const nameIdx = colIndex(headers, 'playername', 'name', 'player');
        const idIdx = colIndex(headers, 'espnid', 'athleteid', 'id');
        if (nameIdx < 0 || idIdx < 0) continue;
        const byName = new Map<string, number>();
        for (const row of idRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          const espnId = num(row[idIdx]);
          if (!playerName || espnId == null || espnId <= 0) continue;
          byName.set(normalizeName(playerName), espnId);
        }
        this.espnIdsBySeason.set(season, byName);
        continue;
      }

      const schedMatch = /^nfl-schedule-(\d{4})\.csv$/i.exec(file);
      if (schedMatch) {
        const schedRows = await readCsv(path.join(dir, file));
        if (schedRows.length < 2) continue;
        const headers = schedRows[0];
        const teamIdx = colIndex(headers, 'team');
        const weekIdx = colIndex(headers, 'week');
        const oppIdx = colIndex(headers, 'opponent');
        const homeIdx = colIndex(headers, 'home');
        const kickIdx = colIndex(headers, 'kickoff', 'date');
        const statusIdx = colIndex(headers, 'status');
        const teamScoreIdx = colIndex(headers, 'teamscore');
        const oppScoreIdx = colIndex(headers, 'oppscore');
        if (teamIdx < 0 || weekIdx < 0) continue;
        for (const row of schedRows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          const week = num(row[weekIdx]);
          if (!team || week == null) continue;
          const rawOpp = row[oppIdx]?.trim();
          const bye = !rawOpp || rawOpp.toUpperCase() === 'BYE';
          const opponent = bye ? undefined : canonicalTeam(rawOpp);
          const rawStatus = row[statusIdx]?.trim().toUpperCase();
          const status: GameStatus | undefined =
            rawStatus === 'FINAL' || rawStatus === 'IN_PROGRESS' || rawStatus === 'SCHEDULED'
              ? rawStatus
              : undefined;
          const list = this.scheduleByTeam.get(team) ?? [];
          list.push({
            team,
            week,
            opponent,
            home: bye ? undefined : num(row[homeIdx]) === 1,
            bye,
            kickoff: kickIdx >= 0 ? row[kickIdx]?.trim() || undefined : undefined,
            status: bye ? 'FINAL' : status,
            teamScore: teamScoreIdx >= 0 ? num(row[teamScoreIdx]) : undefined,
            oppScore: oppScoreIdx >= 0 ? num(row[oppScoreIdx]) : undefined,
          });
          this.scheduleByTeam.set(team, list);
          if (week > this.scheduleWeeks) this.scheduleWeeks = week;
        }
      }
    }

    await this.loadSeasonState(dir);
    await this.loadConsensusLayer(dir);
    await this.loadTdMatchups(dir);

    this.buildTeamQbs();
    this.buildUnitAdj();
    await this.buildBlendedRanks();
    this.mixRemainingSos();
    this.buildSosRanks();
    this.buildDstRanks();

    this.loaded = true;
    this.dataMtime = mtime;
  }

  private findPoints(playerName: string, season: number): PlayerEnrichment | undefined {
    const key = normalizeName(playerName);
    const exact = this.pointsByKey.get(`${season}::${key}`);
    if (exact) return exact;
    if (key.length < 3) return undefined;

    return (this.pointsBySeason.get(season) ?? []).find(
      (p) =>
        normalizeName(p.playerName).includes(key) || key.includes(normalizeName(p.playerName))
    );
  }

  hasSeasonPoints(season: number): boolean {
    if ((this.pointsBySeason.get(season) ?? []).length === 0) return false;
    const latest = this.latestRankingSeason();
    if (season === latest && this.completedWeeks() < 18) return false;
    return true;
  }

  getSeasonState(): SeasonState | undefined {
    return this.seasonState;
  }

  completedWeeks(): number {
    return this.seasonState?.completedWeeks ?? 0;
  }

  currentWeek(): number {
    return this.seasonState?.currentWeek ?? 1;
  }

  getScheduleGame(nflTeam: string | undefined, week: number): ScheduleGame | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    return (this.scheduleByTeam.get(team) ?? []).find((g) => g.week === week);
  }

  getTeamSchedule(nflTeam: string | undefined): ScheduleGame[] {
    const team = canonicalTeam(nflTeam);
    if (!team) return [];
    return [...(this.scheduleByTeam.get(team) ?? [])].sort((a, b) => a.week - b.week);
  }

  weekGameStarted(nflTeam: string | undefined, week: number): boolean {
    const game = this.getScheduleGame(nflTeam, week);
    if (!game || game.bye) return false;
    return game.status === 'FINAL' || game.status === 'IN_PROGRESS';
  }

  getFantasyPoints(playerName: string, season: number): number | undefined {
    return this.findPoints(playerName, season)?.fantasyPoints;
  }

  getSeasonPoints(playerName: string, season: number): PlayerEnrichment | undefined {
    return this.findPoints(playerName, season);
  }

  /**
   * Current NFL team when the rank files have none.
   * Prefers this season's fantasy-points row, then ESPN depth, then the TD file.
   * Skips blank and FA.
   */
  rosterTeam(playerName: string, season: number): string | undefined {
    const candidates = [
      this.getSeasonPoints(playerName, season)?.nflTeam,
      this.getDepthPlayer(playerName, season)?.nflTeam,
      this.getTdPlayer(playerName, season)?.team,
    ];
    for (const raw of candidates) {
      const team = canonicalTeam(raw);
      if (team && team !== 'FA') return team;
    }
    return undefined;
  }

  /** Positional PPR finish for that season (1 = highest scorer at the position). */
  getPositionalEosRank(playerName: string, season: number): number | undefined {
    const row = this.findPoints(playerName, season);
    if (!row) return undefined;
    const list = [...(this.pointsBySeason.get(season) ?? [])]
      .filter((p) => p.position === row.position)
      .sort((a, b) => b.fantasyPoints - a.fantasyPoints);
    const key = normalizeName(row.playerName);
    const idx = list.findIndex((p) => normalizeName(p.playerName) === key);
    return idx >= 0 ? idx + 1 : undefined;
  }

  getTeamRanks(nflTeam: string | undefined, season?: number): TeamRankEntry | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const year =
      season ?? [...this.teamRanksBySeason.keys()].sort((a, b) => b - a)[0];
    if (year == null) return undefined;
    return this.teamRanksBySeason.get(year)?.get(team);
  }

  /** ESPN positional rank among players at the same position (1 = first at pos). */
  getEspnPosRank(playerName: string, position?: string): number | undefined {
    const self = this.getSiteRank(playerName);
    const pos = (position ?? self?.position ?? '').toUpperCase().replace('DST', 'D/ST');
    if (!self?.espnRank || !pos) return undefined;
    const ranked = [...this.siteRankByName.values()]
      .filter((p) => p.espnRank != null && p.position.toUpperCase().replace('DST', 'D/ST') === pos)
      .sort((a, b) => (a.espnRank ?? 999) - (b.espnRank ?? 999));
    const key = normalizeName(self.playerName);
    const idx = ranked.findIndex((p) => normalizeName(p.playerName) === key);
    return idx >= 0 ? idx + 1 : undefined;
  }

  getByeWeek(nflTeam: string | undefined): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const bye = (this.scheduleByTeam.get(team) ?? []).find((g) => g.bye);
    return bye?.week;
  }

  getPlayerStatus(playerName: string): string | undefined {
    return this.playerStatusByName.get(normalizeName(playerName));
  }

  getTeamQb(nflTeam: string | undefined): TeamQbEntry | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    return this.qbByTeam.get(team);
  }

  yearsWithQb(
    playerName: string,
    qbName: string,
    nflTeam: string | undefined,
    season: number
  ): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team || !qbName) return undefined;
    let years = 1;
    for (let y = season - 1; y >= season - 12; y--) {
      const player = this.findPoints(playerName, y);
      const qb = this.findPoints(qbName, y);
      if (!player || !qb) break;
      if (canonicalTeam(player.nflTeam) !== team || canonicalTeam(qb.nflTeam) !== team) break;
      years += 1;
    }
    return years;
  }

  /** End-of-season overall PPR rank (1 = highest scorer). */
  getEosRank(playerName: string, season: number): number | undefined {
    const key = `${season}::${normalizeName(playerName)}`;
    const exact = this.eosRankByKey.get(key);
    if (exact != null) return exact;

    const match = this.findPoints(playerName, season);
    if (!match) return undefined;
    return this.eosRankByKey.get(`${season}::${normalizeName(match.playerName)}`);
  }

  rankingSeasons(): number[] {
    return [...this.adpBySeason.keys()].sort((a, b) => a - b);
  }

  latestRankingSeason(): number | undefined {
    const seasons = this.rankingSeasons();
    return seasons[seasons.length - 1];
  }

  getAdpBoard(season: number): AdpEntry[] {
    return [...(this.adpBySeason.get(season) ?? [])].sort((a, b) => a.adp - b.adp);
  }

  getDepthRoster(season: number): DepthRosterEntry[] {
    return [...(this.depthBySeason.get(season) ?? [])];
  }

  getDepthPlayer(playerName: string, season?: number): DepthRosterEntry | undefined {
    const key = normalizeName(playerName);
    const seasons =
      season != null
        ? [season]
        : [...this.depthBySeason.keys()].sort((a, b) => b - a);
    for (const year of seasons) {
      const hit = (this.depthBySeason.get(year) ?? []).find((p) => normalizeName(p.playerName) === key);
      if (hit) return hit;
    }
    return undefined;
  }

  getPlayerUsage(playerName: string, season: number): PlayerUsageEntry | undefined {
    return this.usageByKey.get(`${season}::${normalizeName(playerName)}`);
  }

  /** All usage rows for a season (positional rank pools). */
  listPlayerUsage(season: number): PlayerUsageEntry[] {
    return [...(this.usageBySeason.get(season) ?? [])];
  }

  /** Team defense PA/YA for a season (D/ST rank pools). */
  listDefenseSeasonStats(season: number): Array<[string, { pa: number; ya: number }]> {
    const out: Array<[string, { pa: number; ya: number }]> = [];
    for (const [team, row] of this.defenseStatsBySeason.get(season) ?? []) {
      out.push([team, { pa: row.pa, ya: row.oppPass + row.oppRush }]);
    }
    return out;
  }

  /** NFL teams present on the loaded schedule (for D/ST pools). */
  listScheduleTeams(): string[] {
    return [...this.scheduleByTeam.keys()].sort();
  }

  /**
   * D/ST remaining-slate SOS rank (1 = easiest = opponents who score fewest).
   * Distinct from skill-position Source A SOS.
   */
  getDstSosRank(nflTeam: string | undefined): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    return this.dstRankByTeam.get(team);
  }

  /**
   * Through-week defense rank vs the pass / run (1 = fewest yards allowed).
   * From `defense-stats-{season}.csv` oppPass / oppRush.
   */
  getDefensePassStopRank(nflTeam: string | undefined, season?: number): number | undefined {
    return this.defenseYardsAllowedRank(nflTeam, season, 'oppPass');
  }

  getDefenseRushStopRank(nflTeam: string | undefined, season?: number): number | undefined {
    return this.defenseYardsAllowedRank(nflTeam, season, 'oppRush');
  }

  /** Pass/rush yards allowed per game through completed weeks (bye weeks excluded). */
  getDefenseYardsAllowedAvg(
    nflTeam: string | undefined,
    season: number | undefined,
    field: 'oppPass' | 'oppRush'
  ): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const year =
      season ??
      [...this.defenseStatsBySeason.keys()].sort((a, b) => b - a)[0];
    if (year == null) return undefined;
    const total = this.defenseStatsBySeason.get(year)?.get(team)?.[field];
    if (total == null || !Number.isFinite(total)) return undefined;
    const games = this.teamGamesPlayedThrough(team);
    if (games <= 0) return undefined;
    return Math.round((total / games) * 10) / 10;
  }

  /** Non-bye games on the schedule through `completedWeeks`. */
  teamGamesPlayedThrough(nflTeam: string | undefined): number {
    const team = canonicalTeam(nflTeam);
    if (!team) return 0;
    const done = this.completedWeeks();
    if (done <= 0) return 0;
    return (this.scheduleByTeam.get(team) ?? []).filter((g) => !g.bye && g.week <= done).length;
  }

  private defenseYardsAllowedRank(
    nflTeam: string | undefined,
    season: number | undefined,
    field: 'oppPass' | 'oppRush'
  ): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const year =
      season ??
      [...this.defenseStatsBySeason.keys()].sort((a, b) => b - a)[0];
    if (year == null) return undefined;
    const map = this.defenseStatsBySeason.get(year);
    if (!map?.has(team)) return undefined;
    const ranked = [...map.entries()]
      .map(([t, row]) => ({ team: t, value: row[field] }))
      .sort((a, b) => a.value - b.value || a.team.localeCompare(b.team));
    const idx = ranked.findIndex((row) => row.team === team);
    return idx >= 0 ? idx + 1 : undefined;
  }

  /** ESPN athlete id from the weekly ranks/depth sweep (for game logs past the top board). */
  getEspnAthleteId(playerName: string, season?: number): number | undefined {
    const key = normalizeName(playerName);
    const seasons =
      season != null
        ? [season]
        : [...this.espnIdsBySeason.keys()].sort((a, b) => b - a);
    for (const year of seasons) {
      const id = this.espnIdsBySeason.get(year)?.get(key);
      if (id != null) return id;
    }
    const depth = this.getDepthPlayer(playerName, season);
    return depth?.espnId;
  }

  /** Skill-position YTD scorers for a season (search fallback when ESPN drops a name). */
  listSeasonPoints(season: number): PlayerEnrichment[] {
    return [...(this.pointsBySeason.get(season) ?? [])];
  }

  /** Career games with fantasy-points rows (all seasons). */
  getCareerGames(playerName: string): number {
    const key = normalizeName(playerName);
    let games = 0;
    for (const list of this.pointsBySeason.values()) {
      const hit = list.find((p) => normalizeName(p.playerName) === key);
      if (hit?.gamesPlayed != null) games += hit.gamesPlayed;
    }
    return games;
  }

  /**
   * QB / RB / WR candidates for a team this season (injury + usage overlay).
   * Merges YTD points, usage snaps/shares, site rank, and injury status.
   */
  listTeamSkillPlayers(
    nflTeam: string | undefined,
    season: number
  ): Array<{
    playerName: string;
    position: 'QB' | 'RB' | 'WR';
    status?: string;
    fantasyPoints?: number;
    games?: number;
    snapPct?: number;
    sharePct?: number;
    rank?: number;
    rookie?: boolean;
    careerGames?: number;
  }> {
    const team = canonicalTeam(nflTeam);
    if (!team) return [];
    const byName = new Map<
      string,
      {
        playerName: string;
        position: 'QB' | 'RB' | 'WR';
        status?: string;
        fantasyPoints?: number;
        games?: number;
        snapPct?: number;
        sharePct?: number;
        rank?: number;
        rookie?: boolean;
        careerGames?: number;
      }
    >();

    const upsert = (
      playerName: string,
      position: 'QB' | 'RB' | 'WR',
      patch: Partial<{
        fantasyPoints: number;
        games: number;
        snapPct: number;
        sharePct: number;
        rank: number;
      }>
    ) => {
      const key = normalizeName(playerName);
      const cur = byName.get(key) ?? {
        playerName,
        position,
        status: this.getPlayerStatus(playerName),
        rookie: this.isRookie(playerName, season, position),
        careerGames: this.getCareerGames(playerName),
      };
      byName.set(key, { ...cur, position, ...patch, playerName: cur.playerName || playerName });
    };

    for (const p of this.pointsBySeason.get(season) ?? []) {
      if (p.position !== 'QB' && p.position !== 'RB' && p.position !== 'WR') continue;
      if (canonicalTeam(p.nflTeam) !== team) continue;
      upsert(p.playerName, p.position, {
        fantasyPoints: p.fantasyPoints,
        games: p.gamesPlayed,
      });
    }

    for (const u of this.usageBySeason.get(season) ?? []) {
      const pos = u.position;
      if (pos !== 'QB' && pos !== 'RB' && pos !== 'WR') continue;
      if (canonicalTeam(u.nflTeam) !== team) continue;
      upsert(u.playerName, pos, {
        snapPct: u.snapPct,
        sharePct: pos === 'RB' ? u.carryShare : pos === 'WR' ? u.targetShare : undefined,
      });
    }

    for (const entry of this.siteRankByName.values()) {
      if (entry.position !== 'QB' && entry.position !== 'RB' && entry.position !== 'WR') continue;
      if (canonicalTeam(entry.nflTeam) !== team) continue;
      upsert(entry.playerName, entry.position as 'QB' | 'RB' | 'WR', {
        rank: entry.espnRank,
      });
    }

    return [...byName.values()];
  }

  getSiteRank(playerName: string): SiteRankEntry | undefined {
    const key = normalizeName(playerName);
    const exact = this.siteRankByName.get(key);
    if (exact) return exact;
    if (key.length < 3) return undefined;
    for (const [name, entry] of this.siteRankByName) {
      if (name.includes(key) || key.includes(name)) return entry;
    }
    return undefined;
  }

  getSiteAdp(playerName: string): SiteAdpEntry | undefined {
    const key = normalizeName(playerName);
    const exact = this.siteAdpByName.get(key);
    if (exact) return exact;
    if (key.length < 3) return undefined;
    for (const [name, entry] of this.siteAdpByName) {
      if (name.includes(key) || key.includes(name)) return entry;
    }
    return undefined;
  }

  listSiteRanks(): SiteRankEntry[] {
    return [...this.siteRankByName.values()];
  }

  listSiteAdp(): SiteAdpEntry[] {
    return [...this.siteAdpByName.values()];
  }

  getConsensusRank(playerName: string): ConsensusRankEntry | undefined {
    const key = normalizeName(playerName);
    const exact = this.consensusRankByName.get(key);
    if (exact) return exact;
    if (key.length < 3) return undefined;
    for (const [name, entry] of this.consensusRankByName) {
      if (name.includes(key) || key.includes(name)) return entry;
    }
    return undefined;
  }

  getConsensusUnits(nflTeam: string | undefined): ConsensusUnitEntry | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    return this.consensusUnitsByTeam.get(team);
  }

  listExpertTakeaways(): ExpertTakeaway[] {
    return [...this.expertTakeaways];
  }

  takeawaysForPlayer(playerName: string): ExpertTakeaway[] {
    const key = normalizeName(playerName);
    return this.expertTakeaways.filter((t) =>
      t.players.some((p) => normalizeName(p) === key)
    );
  }

  takeawaysForPick(opts: {
    playerName: string;
    position: string;
    round?: number;
    already?: string[];
  }): ExpertTakeaway[] {
    const named = this.takeawaysForPlayer(opts.playerName);
    const pos = opts.position.toUpperCase();
    const round = opts.round;
    const already = opts.already ?? [];
    const contextual = this.expertTakeaways.filter((t) => {
      if (t.players.length > 0) return false;
      if (t.positions.length > 0 && !t.positions.map((p) => p.toUpperCase()).includes(pos)) {
        return false;
      }
      if (round != null && t.rounds.length > 0 && !t.rounds.includes(round)) return false;
      if (t.id === 'hero-rb-2026') {
        return pos === 'RB' && round != null && round <= 3 && !already.includes('RB');
      }
      return t.positions.length > 0 || t.rounds.length > 0;
    });
    const seen = new Set<string>();
    const out: ExpertTakeaway[] = [];
    for (const t of [...named, ...contextual]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }

  sosListNote(): string | undefined {
    return this.sosSourceNote;
  }

  private async loadSosFile(filePath: string): Promise<boolean> {
    const sosRows = await readCsv(filePath);
    if (sosRows.length < 2) return false;
    const headers = sosRows[0];
    const teamIdx = colIndex(headers, 'team');
    const overallIdx = colIndex(headers, 'overall');
    const qbIdx = colIndex(headers, 'qb');
    const rbIdx = colIndex(headers, 'rb');
    const wrIdx = colIndex(headers, 'wr');
    const teIdx = colIndex(headers, 'te');
    if (teamIdx < 0) return false;
    let count = 0;
    for (const row of sosRows.slice(1)) {
      const team = canonicalTeam(row[teamIdx]);
      const overall = num(row[overallIdx]);
      if (!team || overall == null) continue;
      this.sosByTeam.set(team, {
        team,
        overall,
        qb: qbIdx >= 0 ? num(row[qbIdx]) : undefined,
        rb: rbIdx >= 0 ? num(row[rbIdx]) : undefined,
        wr: wrIdx >= 0 ? num(row[wrIdx]) : undefined,
        te: teIdx >= 0 ? num(row[teIdx]) : undefined,
      });
      count += 1;
    }
    return count > 0;
  }

  private async loadConsensusLayer(dir: string): Promise<void> {
    const consensusSos = path.join(dir, 'consensus-sos-2026.csv');
    if (await this.loadSosFile(consensusSos)) {
      this.sosSourceNote =
        'List mixes remaining 2026 matchups with a fading DraftEdge + FPA preseason prior';
    }

    const rankRows = await readCsv(path.join(dir, 'consensus-ranks-2026.csv'));
    if (rankRows.length > 1) {
      const headers = rankRows[0];
      const nameIdx = colIndex(headers, 'playername', 'player', 'name');
      const posIdx = colIndex(headers, 'pos', 'position');
      const teamIdx = colIndex(headers, 'team');
      const ecrIdx = colIndex(headers, 'ecr');
      const ecrPosIdx = colIndex(headers, 'ecrpos');
      const bestIdx = colIndex(headers, 'ecrbest');
      const worstIdx = colIndex(headers, 'ecrworst');
      const stdevIdx = colIndex(headers, 'ecrstdev');
      const expertsIdx = colIndex(headers, 'experts');
      if (nameIdx >= 0 && ecrIdx >= 0) {
        for (const row of rankRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          const ecr = num(row[ecrIdx]);
          if (!playerName || ecr == null) continue;
          this.consensusRankByName.set(normalizeName(playerName), {
            playerName,
            position: row[posIdx] ?? '',
            nflTeam: teamIdx >= 0 ? canonicalTeam(row[teamIdx]) : undefined,
            ecr,
            ecrPos: num(row[ecrPosIdx]),
            ecrBest: num(row[bestIdx]),
            ecrWorst: num(row[worstIdx]),
            ecrStdev: num(row[stdevIdx]),
            experts: num(row[expertsIdx]),
          });
        }
      }
    }

    const unitRows = await readCsv(path.join(dir, 'consensus-units-2026.csv'));
    if (unitRows.length > 1) {
      const headers = unitRows[0];
      const teamIdx = colIndex(headers, 'team');
      const olIdx = colIndex(headers, 'oline');
      const dlIdx = colIndex(headers, 'dline');
      const offIdx = colIndex(headers, 'offense');
      const powerIdx = colIndex(headers, 'power');
      if (teamIdx >= 0) {
        const season = 2026;
        const byTeam = this.teamRanksBySeason.get(season) ?? new Map<string, TeamRankEntry>();
        for (const row of unitRows.slice(1)) {
          const team = canonicalTeam(row[teamIdx]);
          if (!team) continue;
          const entry: ConsensusUnitEntry = {
            team,
            oline: olIdx >= 0 ? num(row[olIdx]) : undefined,
            dline: dlIdx >= 0 ? num(row[dlIdx]) : undefined,
            offense: offIdx >= 0 ? num(row[offIdx]) : undefined,
            power: powerIdx >= 0 ? num(row[powerIdx]) : undefined,
          };
          this.consensusUnitsByTeam.set(team, entry);
          const prior = byTeam.get(team);
          byTeam.set(team, {
            team,
            offenseRank: entry.offense ?? prior?.offenseRank,
            olineRank: entry.oline ?? prior?.olineRank,
          });
        }
        this.teamRanksBySeason.set(season, byTeam);
      }
    }

    try {
      const raw = await fs.readFile(path.join(dir, 'expert-takeaways.json'), 'utf-8');
      const parsed = JSON.parse(raw) as ExpertTakeaway[];
      if (Array.isArray(parsed)) {
        this.expertTakeaways = parsed.filter((t) => t?.id && t?.claim);
      }
    } catch {
      this.expertTakeaways = [];
    }
  }

  /** Position SOS, 1 = toughest opposing defenses, 5 = easiest. Includes 2026 vs prior offense/O-line. */
  getSos(nflTeam: string | undefined, position: Position): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const row = this.sosByTeam.get(team);
    if (!row) return undefined;
    return this.adjustedSosScore(row, position);
  }

  /** NFL SOS rank, 1 = easiest remaining schedule, 32 = toughest. */
  getSosRank(nflTeam: string | undefined, position: Position): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const key = this.sosRankKey(position);
    return this.sosRankByPos.get(`${team}::${key}`) ?? this.sosRankByPos.get(`${team}::ALL`);
  }

  listSosBoard(): {
    season: number;
    weeks: number;
    currentWeek: number;
    completedWeeks: number;
    unitSeasons?: { latest: number; prior: number };
    sourceNote?: string;
    teams: Array<{
      team: string;
      overall: { score?: number; rank?: number };
      qb: { score?: number; rank?: number };
      rb: { score?: number; rank?: number };
      wr: { score?: number; rank?: number };
      te: { score?: number; rank?: number };
      dst: { score?: number; rank?: number };
      dline?: number;
      /** Through-week defense quality rank (1 = fewest points allowed). Defense chart Top ranked. */
      defense?: number;
      /** Consensus offense unit rank (1 = best). Used to order the Offense chart by top-ranked teams. */
      offense?: number;
      unitChange?: { offense?: number; oline?: number };
      games: Array<{
        week: number;
        opponent?: string;
        home?: boolean;
        bye?: boolean;
        overall?: number;
        qb?: number;
        rb?: number;
        wr?: number;
        te?: number;
        dst?: number;
      }>;
    }>;
  } {
    const season = this.latestRankingSeason() ?? new Date().getFullYear();
    const weeks = this.scheduleWeeks;
    const teamNames = new Set([...this.sosByTeam.keys(), ...this.scheduleByTeam.keys()]);
    const defenseQuality = this.throughWeekDefenseQualityRanks();
    const teams = [...teamNames].map((team) => {
      const row = this.sosByTeam.get(team);
      const adj = this.unitAdjByTeam.get(team);
      const byWeek = new Map((this.scheduleByTeam.get(team) ?? []).map((g) => [g.week, g]));
      const games = Array.from({ length: weeks }, (_, i) => {
        const week = i + 1;
        const game = byWeek.get(week);
        const def = game?.opponent ? this.matchupDefense(team, week, Boolean(game?.bye)) : undefined;
        const off = game?.opponent ? this.matchupOffense(week, Boolean(game?.bye), game.opponent) : undefined;
        return {
          week,
          opponent: game?.opponent,
          home: game?.home,
          bye: game?.bye ?? (!game && byWeek.size > 0),
          overall: this.adjustedMatchup(team, def?.overall),
          qb: this.adjustedMatchup(team, def?.qb),
          rb: this.adjustedMatchup(team, def?.rb),
          wr: this.adjustedMatchup(team, def?.wr),
          te: this.adjustedMatchup(team, def?.te),
          dst: off?.overall,
        };
      });
      return {
        team,
        overall: {
          score: row ? this.adjustedSosScore(row, 'K') : undefined,
          rank: this.sosRankByPos.get(`${team}::ALL`),
        },
        qb: {
          score: row ? this.adjustedSosScore(row, 'QB') : undefined,
          rank: this.sosRankByPos.get(`${team}::QB`),
        },
        rb: {
          score: row ? this.adjustedSosScore(row, 'RB') : undefined,
          rank: this.sosRankByPos.get(`${team}::RB`),
        },
        wr: {
          score: row ? this.adjustedSosScore(row, 'WR') : undefined,
          rank: this.sosRankByPos.get(`${team}::WR`),
        },
        te: {
          score: row ? this.adjustedSosScore(row, 'TE') : undefined,
          rank: this.sosRankByPos.get(`${team}::TE`),
        },
        dst: this.dstStat(team, games),
        dline: this.consensusUnitsByTeam.get(team)?.dline,
        defense: defenseQuality.get(team),
        offense: this.consensusUnitsByTeam.get(team)?.offense ?? this.getTeamRanks(team)?.offenseRank,
        // Off/OL Δ only matters while the early-season prior is still fading (gone by week 4).
        unitChange:
          priorFade(this.completedWeeks()) > 0 &&
          adj &&
          (adj.offense != null || adj.oline != null)
            ? { offense: adj.offense, oline: adj.oline }
            : undefined,
        games,
      };
    });
    teams.sort((a, b) => (a.overall.rank ?? 99) - (b.overall.rank ?? 99) || a.team.localeCompare(b.team));
    const fadedIn = priorFade(this.completedWeeks()) <= 0;
    return {
      season,
      weeks,
      currentWeek: this.currentWeek(),
      completedWeeks: this.completedWeeks(),
      unitSeasons: fadedIn ? undefined : this.unitSeasons,
      sourceNote: fadedIn
        ? 'List ranks use remaining 2026 matchups (current-season opponent rates).'
        : this.sosSourceNote,
      teams,
    };
  }

  /**
   * Through-week defense quality: 1 = fewest points allowed (stingiest).
   * Matchup ranks use the opposite scale (1 = most PA / easiest to face).
   */
  private throughWeekDefenseQualityRanks(): Map<string, number> {
    const scored = [...this.currentDefenseByTeam.entries()]
      .map(([team, row]) => ({ team, easyRank: row.overall }))
      .filter((row): row is { team: string; easyRank: number } => row.easyRank != null);
    if (scored.length === 0) {
      // Fall back to current-season PA when ranks are missing.
      const years = [...this.defenseStatsBySeason.keys()].sort((a, b) => b - a);
      const current = years[0] != null ? this.defenseStatsBySeason.get(years[0]) : undefined;
      if (!current) return new Map();
      const byPa = [...current.entries()].map(([team, stats]) => ({ team, pa: stats.pa }));
      byPa.sort((a, b) => a.pa - b.pa || a.team.localeCompare(b.team));
      const fromStats = new Map<string, number>();
      byPa.forEach((row, i) => fromStats.set(row.team, i + 1));
      return fromStats;
    }
    // easyRank 32 = fewest PA → quality #1
    scored.sort((a, b) => b.easyRank - a.easyRank || a.team.localeCompare(b.team));
    const out = new Map<string, number>();
    scored.forEach((row, i) => out.set(row.team, i + 1));
    return out;
  }

  private sosScore(row: SosEntry, position: Position): number | undefined {
    if (position === 'QB') return row.qb ?? row.overall;
    if (position === 'RB') return row.rb ?? row.overall;
    if (position === 'WR') return row.wr ?? row.overall;
    if (position === 'TE') return row.te ?? row.overall;
    return row.overall;
  }

  private adjustedSosScore(row: SosEntry, position: Position): number | undefined {
    const raw = this.sosScore(row, position);
    if (raw == null) return undefined;
    return Math.round((raw + this.envBoost(row.team)) * 10) / 10;
  }

  private envBoost(team: string): number {
    const adj = this.unitAdjByTeam.get(team);
    if (!adj) return 0;
    const parts = [adj.offense, adj.oline].filter((n): n is number => n != null);
    if (parts.length === 0) return 0;
    const avg = parts.reduce((sum, n) => sum + n, 0) / parts.length;
    // Same calendar as Source A DraftEdge/FPA prior: full preseason → 0 by week 4.
    return clamp(avg / 20, -0.9, 0.9) * priorFade(this.completedWeeks());
  }

  private adjustedMatchup(team: string, defRank?: number): number | undefined {
    if (defRank == null) return undefined;
    const adj = this.unitAdjByTeam.get(team);
    if (!adj) return defRank;
    const parts = [adj.offense, adj.oline].filter((n): n is number => n != null);
    if (parts.length === 0) return defRank;
    const avg = parts.reduce((sum, n) => sum + n, 0) / parts.length;
    const fade = priorFade(this.completedWeeks());
    const shift = clamp(Math.round((-avg / 4) * fade), -6, 6);
    return clamp(defRank + shift, 1, 32);
  }

  private async loadSeasonState(dir: string): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(dir, 'season-state.json'), 'utf-8');
      const parsed = JSON.parse(raw) as SeasonState;
      if (parsed && Number.isFinite(parsed.completedWeeks) && Number.isFinite(parsed.currentWeek)) {
        this.seasonState = {
          season: parsed.season,
          completedWeeks: parsed.completedWeeks,
          currentWeek: parsed.currentWeek,
          asOf: parsed.asOf,
        };
      }
    } catch {
      this.seasonState = undefined;
    }
  }

  private async loadTdMatchups(dir: string): Promise<void> {
    const playerRows = await readCsv(path.join(dir, 'td-player.csv'));
    if (playerRows.length > 1) {
      const headers = playerRows[0];
      const nameIdx = colIndex(headers, 'playername', 'player');
      const seasonIdx = colIndex(headers, 'season');
      const posIdx = colIndex(headers, 'position', 'pos');
      const teamIdx = colIndex(headers, 'nflteam', 'team');
      const gamesIdx = colIndex(headers, 'games');
      const tdsIdx = colIndex(headers, 'tds');
      const ydsIdx = colIndex(headers, 'yds');
      const hitIdx = colIndex(headers, 'hitgames');
      const teamTdsIdx = colIndex(headers, 'teamtds');
      const posTdsIdx = colIndex(headers, 'posTds', 'postds');
      const weeksIdx = colIndex(headers, 'weeks');
      if (nameIdx >= 0 && seasonIdx >= 0) {
        for (const row of playerRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          const season = num(row[seasonIdx]);
          const position = asTdPos(row[posIdx]);
          if (!playerName || season == null || !position) continue;
          const entry: TdPlayerSeason = {
            playerName,
            season,
            position,
            team: canonicalTeam(row[teamIdx]) ?? row[teamIdx],
            games: num(row[gamesIdx]) ?? 0,
            tds: num(row[tdsIdx]) ?? 0,
            yds: num(row[ydsIdx]) ?? 0,
            hitGames: num(row[hitIdx]) ?? 0,
            teamTds: num(row[teamTdsIdx]) ?? 0,
            posTds: num(row[posTdsIdx]) ?? 0,
            weeks: parseTdWeeks(row[weeksIdx] ?? ''),
          };
          this.tdPlayerByKey.set(`${season}::${normalizeName(playerName)}`, entry);
        }
      }
    }

    const defRows = await readCsv(path.join(dir, 'td-defense-by-pos.csv'));
    if (defRows.length > 1) {
      const headers = defRows[0];
      const seasonIdx = colIndex(headers, 'season');
      const teamIdx = colIndex(headers, 'team');
      const posIdx = colIndex(headers, 'position', 'pos');
      const gamesIdx = colIndex(headers, 'games');
      const ydsIdx = colIndex(headers, 'yds');
      const tdsIdx = colIndex(headers, 'tds');
      const lastWeekIdx = colIndex(headers, 'lastweek');
      const lastYdsIdx = colIndex(headers, 'lastyds');
      const lastTdsIdx = colIndex(headers, 'lasttds');
      const lastOppIdx = colIndex(headers, 'lastopp');
      if (seasonIdx >= 0 && teamIdx >= 0 && posIdx >= 0) {
        for (const row of defRows.slice(1)) {
          const season = num(row[seasonIdx]);
          const team = canonicalTeam(row[teamIdx]);
          const position = asTdPos(row[posIdx]);
          if (season == null || !team || !position) continue;
          const entry: TdDefenseSeason = {
            team,
            season,
            position,
            games: num(row[gamesIdx]) ?? 0,
            yds: num(row[ydsIdx]) ?? 0,
            tds: num(row[tdsIdx]) ?? 0,
            lastWeek: num(row[lastWeekIdx]),
            lastYds: num(row[lastYdsIdx]),
            lastTds: num(row[lastTdsIdx]),
            lastOpp: row[lastOppIdx] ? canonicalTeam(row[lastOppIdx]) ?? row[lastOppIdx] : undefined,
          };
          this.tdDefenseByKey.set(`${season}::${team}::${position}`, entry);
        }
      }
    }

    const gameRows = await readCsv(path.join(dir, 'td-player-games.csv'));
    if (gameRows.length > 1) {
      const headers = gameRows[0];
      const nameIdx = colIndex(headers, 'playername', 'player');
      const seasonIdx = colIndex(headers, 'season');
      const weekIdx = colIndex(headers, 'week');
      const posIdx = colIndex(headers, 'position', 'pos');
      const teamIdx = colIndex(headers, 'nflteam', 'team');
      const oppIdx = colIndex(headers, 'opp', 'opponent');
      const tdsIdx = colIndex(headers, 'tds');
      const rushAttIdx = colIndex(headers, 'rushatt');
      const rushYdsIdx = colIndex(headers, 'rushyds');
      const recIdx = colIndex(headers, 'rec');
      const recYdsIdx = colIndex(headers, 'recyds');
      const tgtIdx = colIndex(headers, 'targets');
      const homeIdx = colIndex(headers, 'home');
      if (nameIdx >= 0 && seasonIdx >= 0 && weekIdx >= 0 && oppIdx >= 0) {
        const currentSeason = this.seasonState?.season;
        for (const row of gameRows.slice(1)) {
          const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
          const season = num(row[seasonIdx]);
          const week = num(row[weekIdx]);
          const opp = canonicalTeam(row[oppIdx]) ?? row[oppIdx]?.trim();
          if (!playerName || season == null || week == null || !opp) continue;
          const nflTeam = canonicalTeam(row[teamIdx]) ?? row[teamIdx];
          let home = homeIdx >= 0 ? parseHomeFlag(row[homeIdx]) : undefined;
          if (home == null && nflTeam && currentSeason === season) {
            home = this.getScheduleGame(nflTeam, week)?.home;
          }
          const entry: TdGameRow = {
            playerName,
            season,
            week,
            position: asTdPos(row[posIdx]),
            nflTeam,
            opp,
            tds: num(row[tdsIdx]) ?? 0,
            home,
            rushAtt: rushAttIdx >= 0 ? num(row[rushAttIdx]) : undefined,
            rushYds: rushYdsIdx >= 0 ? num(row[rushYdsIdx]) : undefined,
            rec: recIdx >= 0 ? num(row[recIdx]) : undefined,
            recYds: recYdsIdx >= 0 ? num(row[recYdsIdx]) : undefined,
            targets: tgtIdx >= 0 ? num(row[tgtIdx]) : undefined,
          };
          const key = normalizeName(playerName);
          const list = this.tdGamesByName.get(key);
          if (list) list.push(entry);
          else this.tdGamesByName.set(key, [entry]);
        }
        for (const rows of this.tdGamesByName.values()) {
          rows.sort((a, b) => b.season - a.season || b.week - a.week);
        }
      }
    }
  }

  getTdPlayer(playerName: string, season: number): TdPlayerSeason | undefined {
    const key = normalizeName(playerName);
    const exact = this.tdPlayerByKey.get(`${season}::${key}`);
    if (exact) return exact;
    if (key.length < 3) return undefined;
    for (const [mapKey, row] of this.tdPlayerByKey) {
      if (!mapKey.startsWith(`${season}::`)) continue;
      const name = normalizeName(row.playerName);
      if (name.includes(key) || key.includes(name)) return row;
    }
    return undefined;
  }

  getTdDefense(team: string | undefined, position: string | undefined, season: number): TdDefenseSeason | undefined {
    const nfl = canonicalTeam(team);
    const pos = asTdPos(position);
    if (!nfl || !pos) return undefined;
    return this.tdDefenseByKey.get(`${season}::${nfl}::${pos}`);
  }

  listTdDefense(season: number, position: string | undefined): TdDefenseSeason[] {
    const pos = asTdPos(position);
    if (!pos) return [];
    const out: TdDefenseSeason[] = [];
    for (const row of this.tdDefenseByKey.values()) {
      if (row.season === season && row.position === pos) out.push(row);
    }
    return out;
  }

  getTdGames(playerName: string): TdGameRow[] {
    const key = normalizeName(playerName);
    const exact = this.tdGamesByName.get(key);
    if (exact) return exact;
    if (key.length < 3) return [];
    for (const [name, rows] of this.tdGamesByName) {
      if (name.includes(key) || key.includes(name)) return rows;
    }
    return [];
  }

  getOlineRank(nflTeam: string | undefined): number | undefined {
    return this.getConsensusUnits(nflTeam)?.oline ?? this.getTeamRanks(nflTeam)?.olineRank;
  }

  /**
   * Through-week team offense rank from ESPN points-for (`offense-ranks`).
   * File polarity is 1 = fewest PF; this returns 1 = most PF (best scoring offense).
   */
  getThroughWeekOffenseRank(nflTeam: string | undefined, season?: number): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const year = season ?? this.seasonState?.season ?? 2026;
    const overall = this.offenseRanksBySeason.get(year)?.get(team)?.overall;
    if (overall == null || overall < 1 || overall > 32) return undefined;
    return 33 - overall;
  }

  /** Through-week O-line rank from nflverse PBP sack rate (1 = lowest sack rate). */
  getThroughWeekOlineRank(nflTeam: string | undefined, season?: number): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const year = season ?? this.seasonState?.season ?? 2026;
    return this.olineRanksBySeason.get(year)?.get(team);
  }

  getOppPosDefenseRank(nflTeam: string | undefined, week: number, position: string): number | undefined {
    const team = canonicalTeam(nflTeam);
    const pos = asTdPos(position);
    if (!team || !pos) return undefined;
    const game = this.getScheduleGame(team, week);
    const def = this.matchupDefense(team, week, Boolean(game?.bye));
    if (!def) return undefined;
    if (pos === 'QB') return def.qb;
    if (pos === 'RB') return def.rb;
    if (pos === 'WR') return def.wr;
    return def.te;
  }

  /** Opponent offense points-scored rank for D/ST (1 = fewest points / easiest). */
  getOppOffenseRank(nflTeam: string | undefined, week: number): number | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const game = this.getScheduleGame(team, week);
    if (!game || game.bye || !game.opponent) return undefined;
    return this.matchupOffense(week, false, game.opponent)?.overall;
  }

  /** Team defense YTD points/yards allowed for D/ST Stats view. */
  getDefenseSeasonStats(
    nflTeam: string | undefined,
    season?: number
  ): { pa: number; ya: number } | undefined {
    const team = canonicalTeam(nflTeam);
    if (!team) return undefined;
    const year =
      season ??
      [...this.defenseStatsBySeason.keys()].sort((a, b) => b - a)[0];
    if (year == null) return undefined;
    const row = this.defenseStatsBySeason.get(year)?.get(team);
    if (!row) return undefined;
    return { pa: row.pa, ya: row.oppPass + row.oppRush };
  }

  private remainingGames(team: string): ScheduleGame[] {
    const done = this.completedWeeks();
    return (this.scheduleByTeam.get(team) ?? []).filter((g) => !g.bye && g.week > done && g.opponent);
  }

  private matchupDefense(team: string, week: number, bye: boolean): DefenseRankEntry | undefined {
    if (bye) return undefined;
    const game = this.getScheduleGame(team, week);
    const opp = game?.opponent;
    if (!opp) return undefined;
    const remaining = week > this.completedWeeks();
    const map =
      remaining || this.currentDefenseByTeam.size === 0 ? this.defenseByTeam : this.currentDefenseByTeam;
    return map.get(opp);
  }

  private matchupOffense(week: number, bye: boolean, opponent: string): OffenseRankEntry | undefined {
    if (bye) return undefined;
    const remaining = week > this.completedWeeks();
    const map =
      remaining || this.currentOffenseByTeam.size === 0 ? this.offenseByTeam : this.currentOffenseByTeam;
    return map.get(opponent);
  }

  private async loadEspnOprkRatings(
    season: number
  ): Promise<Record<string, Record<string, number>> | null> {
    try {
      const raw = await fs.readFile(
        path.join(enrichmentDir(), `espn-oprk-${season}.json`),
        'utf-8'
      );
      const data = JSON.parse(raw) as { ratings?: Record<string, Record<string, number>> };
      if (!data.ratings || Object.keys(data.ratings).length === 0) return null;
      return data.ratings;
    } catch {
      return null;
    }
  }

  private async buildBlendedRanks(): Promise<void> {
    this.defenseByTeam.clear();
    this.offenseByTeam.clear();
    this.currentDefenseByTeam.clear();
    this.currentOffenseByTeam.clear();

    const years = [...new Set([...this.defenseStatsBySeason.keys(), ...this.defenseRanksBySeason.keys()])].sort(
      (a, b) => b - a
    );
    const currentYear = years[0] ?? this.latestRankingSeason() ?? new Date().getFullYear();
    const priorYear = years.find((y) => y < currentYear) ?? currentYear - 1;
    const completed = this.completedWeeks();
    const weight = currentSeasonWeight(completed);
    const currentGames = Math.max(1, completed);

    const currentDefStats = this.defenseStatsBySeason.get(currentYear);
    const priorDefStats = this.defenseStatsBySeason.get(priorYear);
    if (currentDefStats || priorDefStats) {
      const teams = new Set([
        ...(currentDefStats?.keys() ?? []),
        ...(priorDefStats?.keys() ?? []),
      ]);
      const blended = new Map<string, BlendDefStats>();
      for (const team of teams) {
        const mixed = blendDefStatsRates(
          currentDefStats?.get(team),
          priorDefStats?.get(team),
          weight,
          currentGames
        );
        if (mixed) blended.set(team, mixed);
      }
      let ranked = ranksFromDefStats(blended);
      const espnOprk = await this.loadEspnOprkRatings(currentYear);
      ranked = softAnchorDefRanks(ranked, espnOprk);
      for (const [team, ranks] of ranked) {
        this.defenseByTeam.set(team, { team, ...ranks });
      }
    } else {
      const fallback =
        this.defenseRanksBySeason.get(priorYear) ?? this.defenseRanksBySeason.get(currentYear);
      if (fallback) {
        for (const [team, row] of fallback) this.defenseByTeam.set(team, row);
      }
    }

    const currentOffStats = this.offenseStatsBySeason.get(currentYear);
    const priorOffStats = this.offenseStatsBySeason.get(priorYear);
    if (currentOffStats || priorOffStats) {
      const teams = new Set([
        ...(currentOffStats?.keys() ?? []),
        ...(priorOffStats?.keys() ?? []),
      ]);
      const blended = new Map<string, BlendOffStats>();
      for (const team of teams) {
        const mixed = blendOffStatsRates(
          currentOffStats?.get(team),
          priorOffStats?.get(team),
          weight,
          currentGames
        );
        if (mixed) blended.set(team, mixed);
      }
      for (const [team, overall] of ranksFromOffStats(blended)) {
        this.offenseByTeam.set(team, { team, overall });
      }
    } else {
      const fallback =
        this.offenseRanksBySeason.get(priorYear) ?? this.offenseRanksBySeason.get(currentYear);
      if (fallback) {
        for (const [team, row] of fallback) this.offenseByTeam.set(team, row);
      }
    }

    const currentDefRanks = this.defenseRanksBySeason.get(currentYear);
    if (currentDefRanks) {
      for (const [team, row] of currentDefRanks) this.currentDefenseByTeam.set(team, row);
    }
    const currentOffRanks = this.offenseRanksBySeason.get(currentYear);
    if (currentOffRanks) {
      for (const [team, row] of currentOffRanks) this.currentOffenseByTeam.set(team, row);
    }
  }

  private mixRemainingSos(): void {
    this.priorSosByTeam = new Map(this.sosByTeam);
    const fade = priorFade(this.completedWeeks());
    const teams = new Set([...this.sosByTeam.keys(), ...this.scheduleByTeam.keys()]);
    for (const team of teams) {
      const prior = this.priorSosByTeam.get(team);
      const remaining = this.remainingGames(team);
      const avg = (key: 'overall' | 'qb' | 'rb' | 'wr' | 'te') => {
        const ranks = remaining
          .map((g) => (g.opponent ? this.defenseByTeam.get(g.opponent)?.[key] : undefined))
          .filter((n): n is number => n != null);
        if (ranks.length === 0) return undefined;
        return rankToSosScore(ranks.reduce((sum, n) => sum + n, 0) / ranks.length);
      };
      const computedOverall = avg('overall');
      const mixed: SosEntry = {
        team,
        overall: mixScore(prior?.overall, computedOverall, fade) ?? computedOverall ?? prior?.overall ?? 3,
        qb: mixScore(prior?.qb ?? prior?.overall, avg('qb'), fade),
        rb: mixScore(prior?.rb ?? prior?.overall, avg('rb'), fade),
        wr: mixScore(prior?.wr ?? prior?.overall, avg('wr'), fade),
        te: mixScore(prior?.te ?? prior?.overall, avg('te'), fade),
      };
      this.sosByTeam.set(team, mixed);
    }
  }

  private sosRankKey(position: Position): 'QB' | 'RB' | 'WR' | 'TE' | 'ALL' {
    if (position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE') {
      return position;
    }
    return 'ALL';
  }

  private buildUnitAdj(): void {
    this.unitAdjByTeam.clear();
    this.unitSeasons = undefined;
    const years = [...this.teamRanksBySeason.keys()].sort((a, b) => b - a);
    const latest = years[0];
    const prior = years[1];
    if (latest == null || prior == null) return;
    const nowMap = this.teamRanksBySeason.get(latest);
    const prevMap = this.teamRanksBySeason.get(prior);
    if (!nowMap || !prevMap) return;
    this.unitSeasons = { latest, prior };
    for (const [team, now] of nowMap) {
      const prev = prevMap.get(team);
      if (!prev) continue;
      const offense =
        prev.offenseRank != null && now.offenseRank != null ? prev.offenseRank - now.offenseRank : undefined;
      const oline =
        prev.olineRank != null && now.olineRank != null ? prev.olineRank - now.olineRank : undefined;
      if (offense == null && oline == null) continue;
      this.unitAdjByTeam.set(team, { offense, oline, latest, prior });
    }
  }

  private buildSosRanks(): void {
    this.sosRankByPos.clear();
    const groups: Array<{ key: 'QB' | 'RB' | 'WR' | 'TE' | 'ALL'; scoreOf: (row: SosEntry) => number | undefined }> = [
      { key: 'ALL', scoreOf: (row) => this.adjustedSosScore(row, 'K') },
      { key: 'QB', scoreOf: (row) => this.adjustedSosScore(row, 'QB') },
      { key: 'RB', scoreOf: (row) => this.adjustedSosScore(row, 'RB') },
      { key: 'WR', scoreOf: (row) => this.adjustedSosScore(row, 'WR') },
      { key: 'TE', scoreOf: (row) => this.adjustedSosScore(row, 'TE') },
    ];
    for (const { key, scoreOf } of groups) {
      const ranked = [...this.sosByTeam.values()]
        .map((row) => ({ team: row.team, score: scoreOf(row) }))
        .filter((row): row is { team: string; score: number } => row.score != null)
        .sort((a, b) => b.score - a.score || a.team.localeCompare(b.team));
      ranked.forEach((row, i) => this.sosRankByPos.set(`${row.team}::${key}`, i + 1));
    }
  }

  private dstStat(
    team: string,
    games: Array<{ week: number; bye?: boolean; dst?: number }>
  ): { score?: number; rank?: number } {
    const done = this.completedWeeks();
    const ranks = games
      .filter((g) => !g.bye && g.dst != null && g.week > done)
      .map((g) => g.dst as number);
    const score =
      ranks.length > 0
        ? Math.round((ranks.reduce((sum, n) => sum + n, 0) / ranks.length) * 10) / 10
        : undefined;
    return { score, rank: this.dstRankByTeam.get(team) };
  }

  private buildDstRanks(): void {
    this.dstRankByTeam.clear();
    const avgs: Array<{ team: string; avg: number }> = [];
    for (const team of this.scheduleByTeam.keys()) {
      const ranks = this.remainingGames(team)
        .map((g) => (g.opponent ? this.offenseByTeam.get(g.opponent)?.overall : undefined))
        .filter((n): n is number => n != null);
      if (ranks.length === 0) continue;
      avgs.push({ team, avg: ranks.reduce((sum, n) => sum + n, 0) / ranks.length });
    }
    avgs.sort((a, b) => a.avg - b.avg || a.team.localeCompare(b.team));
    avgs.forEach((row, i) => this.dstRankByTeam.set(row.team, i + 1));
  }

  private buildTeamQbs(): void {
    this.qbByTeam.clear();
    for (const entry of this.siteRankByName.values()) {
      if (entry.position !== 'QB') continue;
      const team = canonicalTeam(entry.nflTeam);
      if (!team) continue;
      const rank = entry.espnRank ?? 999;
      const cur = this.qbByTeam.get(team);
      if (!cur || rank < cur.rank) {
        this.qbByTeam.set(team, { playerName: entry.playerName, rank });
      }
    }
    const seasons = [...this.pointsBySeason.keys()].sort((a, b) => b - a);
    const latest = seasons[0];
    if (latest == null) return;
    const qbs = (this.pointsBySeason.get(latest) ?? []).filter((p) => p.position === 'QB');
    const bestByTeam = new Map<string, PlayerEnrichment>();
    for (const qb of qbs) {
      const team = canonicalTeam(qb.nflTeam);
      if (!team) continue;
      const cur = bestByTeam.get(team);
      if (!cur || qb.fantasyPoints > cur.fantasyPoints) bestByTeam.set(team, qb);
    }
    for (const [team, qb] of bestByTeam) {
      if (this.qbByTeam.has(team)) continue;
      this.qbByTeam.set(team, { playerName: qb.playerName, rank: 999 });
    }
  }

  getAdp(playerName: string, season: number): AdpEntry | undefined {
    const key = normalizeName(playerName);
    const exact = this.adpByKey.get(`${season}::${key}`);
    if (exact) return exact;
    if (key.length < 3) return undefined;

    return (this.adpBySeason.get(season) ?? []).find(
      (a) =>
        normalizeName(a.playerName).includes(key) || key.includes(normalizeName(a.playerName))
    );
  }

  getDraftYear(playerName: string): number | undefined {
    const key = normalizeName(playerName);
    const exact = this.draftYearByName.get(key);
    if (exact != null) return exact;
    if (key.length < 3) return undefined;

    for (const [name, year] of this.draftYearByName) {
      if (name.includes(key) || key.includes(name)) return year;
    }
    return undefined;
  }

  /**
   * Rookie if NFL draft year matches season, else fallback:
   * first season appearing in fantasy-points equals this season (covers many UDFAs).
   * D/ST and kickers without draft data are not marked via the points heuristic alone
   * when the name looks like a team defense.
   */
  isRookie(playerName: string, season: number, position?: string): boolean {
    if (position === 'D/ST') return false;

    const draftYear = this.getDraftYear(playerName);
    if (draftYear != null) return draftYear === season;

    const firstPoints = this.firstPointsSeasonByName.get(normalizeName(playerName));
    if (firstPoints != null) return firstPoints === season;
    return false;
  }

  /** NFL draft year, else first season with fantasy points (covers many UDFAs). */
  getFirstNflSeason(playerName: string): number | undefined {
    const draft = this.getDraftYear(playerName);
    const points = this.firstPointsSeasonByName.get(normalizeName(playerName));
    if (draft != null && points != null) return Math.min(draft, points);
    return draft ?? points;
  }
}

export const enrichmentStore = new EnrichmentStore();

export { normalizeName };
