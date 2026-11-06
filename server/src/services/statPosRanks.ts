/**
 * Build NFL positional ranks for My Team Stats value tooltips.
 * Pools: nflverse player_stats (box), player-usage (snap/RTE/air/…), fantasy-points, defense-stats.
 */
import fs from 'fs/promises';
import path from 'path';
import { enrichmentStore, type PlayerUsageEntry } from '../data/enrichment';
import type { MyTeamSeasonStats, Position } from '../types';

export type StatRank = { rank: number; of: number };

type NumMap = Record<string, number>;

const ROOT = path.resolve(__dirname, '../../..');
const CACHE_DIR = path.join(ROOT, '.cache/nflverse');

const LOWER_BETTER = new Set(['int', 'fuml', 'pa', 'ya']);

type PoolCache = {
  season: number;
  mtime: number;
  /** position -> field -> sorted values (best first) */
  byPosField: Map<string, Map<string, number[]>>;
};

let poolCache: PoolCache | null = null;

/** position -> field -> playerKey -> value (deduped) */
type Builder = Map<string, Map<string, Map<string, number>>>;

function setField(builder: Builder, pos: string, field: string, playerKey: string, value: number | undefined) {
  if (value == null || Number.isNaN(value)) return;
  let fields = builder.get(pos);
  if (!fields) {
    fields = new Map();
    builder.set(pos, fields);
  }
  let byPlayer = fields.get(field);
  if (!byPlayer) {
    byPlayer = new Map();
    fields.set(field, byPlayer);
  }
  byPlayer.set(playerKey, value);
}

function builderToSorted(builder: Builder): Map<string, Map<string, number[]>> {
  const byPosField = new Map<string, Map<string, number[]>>();
  for (const [pos, fields] of builder) {
    const outFields = new Map<string, number[]>();
    for (const [field, byPlayer] of fields) {
      const values = [...byPlayer.values()];
      const lower = LOWER_BETTER.has(field);
      values.sort((a, b) => (lower ? a - b : b - a));
      outFields.set(field, values);
    }
    byPosField.set(pos, outFields);
  }
  return byPosField;
}

function normalizePos(pos: string): string {
  const p = (pos || '').toUpperCase().trim();
  if (p === 'FB') return 'RB';
  if (p === 'DST') return 'D/ST';
  return p;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch === '\r') {
      /* ignore */
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function num(v: string | undefined): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function nflPasserRating(cmp: number, att: number, yds: number, td: number, ints: number): number {
  const clamp = (n: number) => Math.min(2.375, Math.max(0, n));
  const a = clamp((cmp / att - 0.3) * 5);
  const b = clamp((yds / att - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - (ints / att) * 25);
  return Math.round(((a + b + c + d) / 6) * 1000) / 10;
}

async function loadPlayerStatsAggregates(season: number): Promise<Map<string, { pos: string; stats: NumMap; games: number }>> {
  const cachePath = path.join(CACHE_DIR, `player_stats_week_${season}.csv`);
  let text: string;
  try {
    text = await fs.readFile(cachePath, 'utf-8');
  } catch {
    return new Map();
  }
  const rows = parseCsv(text);
  if (rows.length < 2) return new Map();
  const h = rows[0].map((x) => x.toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = h.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iName = col('player_display_name', 'player_name');
  const iPos = col('position');
  const iSeasonType = col('season_type');
  const iCmp = col('completions');
  const iAtt = col('attempts');
  const iPassYds = col('passing_yards');
  const iPassTd = col('passing_tds');
  const iInt = col('passing_interceptions');
  const iCar = col('carries', 'rushing_attempts');
  const iRushYds = col('rushing_yards');
  const iRushTd = col('rushing_tds');
  const iRec = col('receptions');
  const iRecYds = col('receiving_yards');
  const iRecTd = col('receiving_tds');
  const iTgt = col('targets');
  const iFuml = col('rushing_fumbles_lost', 'receiving_fumbles_lost', 'sack_fumbles_lost');
  if (iName < 0 || iPos < 0) return new Map();

  type Agg = { pos: string; stats: NumMap; games: number; weeks: Set<number> };
  const byPlayer = new Map<string, Agg>();
  const iWeek = col('week');

  for (const row of rows.slice(1)) {
    const seasonType = iSeasonType >= 0 ? (row[iSeasonType] ?? '').toUpperCase() : 'REG';
    if (seasonType && seasonType !== 'REG') continue;
    const name = (row[iName] ?? '').trim();
    const pos = normalizePos(row[iPos] ?? '');
    if (!name || !['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    const key = normalizeName(name);
    let agg = byPlayer.get(key);
    if (!agg) {
      agg = { pos, stats: {}, games: 0, weeks: new Set() };
      byPlayer.set(key, agg);
    }
    agg.pos = pos;
    const week = iWeek >= 0 ? num(row[iWeek]) : 0;
    const add = (field: string, idx: number) => {
      if (idx < 0) return;
      const v = num(row[idx]);
      if (!v && v !== 0) return;
      agg!.stats[field] = (agg!.stats[field] ?? 0) + v;
    };
    add('cmp', iCmp);
    add('att', iAtt);
    add('passYds', iPassYds);
    add('passTd', iPassTd);
    add('int', iInt);
    add('rushCar', iCar);
    add('rushYds', iRushYds);
    add('rushTd', iRushTd);
    add('rec', iRec);
    add('recYds', iRecYds);
    add('recTd', iRecTd);
    add('targets', iTgt);
    if (iFuml >= 0) add('fuml', iFuml);

    const played =
      (iAtt >= 0 && num(row[iAtt]) > 0) ||
      (iCar >= 0 && num(row[iCar]) > 0) ||
      (iTgt >= 0 && num(row[iTgt]) > 0) ||
      (iRec >= 0 && num(row[iRec]) > 0);
    if (played && week > 0 && !agg.weeks.has(week)) {
      agg.weeks.add(week);
      agg.games += 1;
    }
  }

  for (const agg of byPlayer.values()) {
    const s = agg.stats;
    if (s.cmp != null && s.att != null && s.att > 0) {
      s.pct = round1((s.cmp / s.att) * 100);
      s.passerRating = nflPasserRating(s.cmp, s.att, s.passYds ?? 0, s.passTd ?? 0, s.int ?? 0);
    }
    if (s.rushCar != null && s.rushCar > 0 && s.rushYds != null) {
      s.rushAvg = round1(s.rushYds / s.rushCar);
    }
    if (s.rec != null && s.rec > 0 && s.recYds != null) {
      s.recAvg = round1(s.recYds / s.rec);
    }
    if (s.targets != null && agg.games > 0) {
      s.tgtPg = round1(s.targets / agg.games);
    }
    if (s.rushTd != null || s.recTd != null) {
      s.totalTd = (s.rushTd ?? 0) + (s.recTd ?? 0);
    }
  }

  return byPlayer;
}

async function ensurePools(season: number): Promise<PoolCache> {
  let mtime = 0;
  try {
    mtime = (await fs.stat(path.join(CACHE_DIR, `player_stats_week_${season}.csv`))).mtimeMs;
  } catch {
    mtime = 0;
  }
  if (poolCache && poolCache.season === season && poolCache.mtime === mtime) {
    return poolCache;
  }

  await enrichmentStore.load();
  const builder: Builder = new Map();

  const box = await loadPlayerStatsAggregates(season);
  for (const [playerKey, agg] of box) {
    for (const [field, value] of Object.entries(agg.stats)) {
      setField(builder, agg.pos, field, playerKey, value);
    }
  }

  // Usage overwrites overlapping box fields (snap/route/air/yac/adot/carry/targets)
  const usageFields: Array<keyof PlayerUsageEntry> = [
    'snapPct',
    'routePct',
    'airYards',
    'yac',
    'adot',
    'carryShare',
    'targetShare',
    'targets',
  ];
  for (const entry of enrichmentStore.listPlayerUsage(season)) {
    const pos = normalizePos(entry.position ?? '');
    if (!pos || !['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    const playerKey = normalizeName(entry.playerName);
    for (const field of usageFields) {
      const v = entry[field];
      if (typeof v === 'number') setField(builder, pos, field, playerKey, v);
    }
  }

  for (const p of enrichmentStore.listSeasonPoints(season)) {
    const pos = normalizePos(p.position);
    if (!pos) continue;
    const playerKey = normalizeName(p.playerName);
    setField(builder, pos, 'fpts', playerKey, p.fantasyPoints);
    if (p.gamesPlayed && p.gamesPlayed > 0) {
      setField(builder, pos, 'avg', playerKey, round1(p.fantasyPoints / p.gamesPlayed));
    }
  }

  for (const [team, def] of enrichmentStore.listDefenseSeasonStats(season)) {
    setField(builder, 'D/ST', 'pa', team, def.pa);
    setField(builder, 'D/ST', 'ya', team, def.ya);
  }

  poolCache = { season, mtime, byPosField: builderToSorted(builder) };
  return poolCache;
}

function rankInSorted(sorted: number[], value: number, lowerBetter: boolean): number {
  // Dense rank: count how many are strictly better (list is sorted best-first).
  let better = 0;
  for (const v of sorted) {
    if (lowerBetter ? v < value : v > value) better += 1;
    else break;
  }
  return better + 1;
}

export async function rankSeasonStats(
  _playerName: string,
  position: Position,
  season: number,
  seasonStats: MyTeamSeasonStats | undefined,
  extras: { fantasyPoints?: number; avgPoints?: number }
): Promise<Record<string, StatRank>> {
  const pools = await ensurePools(season);
  const pos = normalizePos(position);
  const fields = pools.byPosField.get(pos);
  const out: Record<string, StatRank> = {};
  if (!fields) return out;

  const values: NumMap = { ...extras };
  if (seasonStats) {
    for (const [k, v] of Object.entries(seasonStats)) {
      if (k === 'kind') continue;
      if (typeof v === 'number' && Number.isFinite(v)) values[k] = v;
    }
  }

  for (const [field, value] of Object.entries(values)) {
    if (value == null || Number.isNaN(value)) continue;
    const sorted = fields.get(field);
    if (!sorted || sorted.length === 0) continue;
    const lower = LOWER_BETTER.has(field);
    out[field] = {
      rank: rankInSorted(sorted, value, lower),
      of: sorted.length,
    };
  }
  return out;
}
