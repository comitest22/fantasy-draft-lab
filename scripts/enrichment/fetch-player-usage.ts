/**
 * Build My Team usage metrics from nflverse (already used for fantasy points).
 *
 * Inputs:
 *   player_stats_{season}.csv  — air yards, YAC, targets, carries, target_share
 *   snap_counts_{season}.csv   — offense snap %
 *   play_by_play_{season}.csv  — team qb_dropbacks (RTE% denominator)
 *   players.csv                — gsis → espn_id
 *   ESPN athlete statistics    — yardsPerRouteRun + receivingYards (RTE% numerator)
 *
 * Output:
 *   data/enrichment/player-usage-{season}.csv
 *
 *   npm run enrichment:fetch-player-usage
 *   npm run enrichment:fetch-player-usage -- --season 2026
 *
 * RTE% (2026 interim): routes ≈ ESPN receivingYards / yardsPerRouteRun,
 * then routes / team REG qb_dropbacks. Revisit when nflverse pbp_participation
 * publishes mid-season (FTN participation is postseason-only today).
 */
import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import readline from 'readline';

const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'data/enrichment');
const CACHE_DIR = path.join(ROOT, '.cache/nflverse');
const ESPN_CACHE_DIR = path.join(ROOT, '.cache/espn');
const SEASON_DEFAULT = 2026;
const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);
const ROUTE_POS = new Set(['RB', 'WR', 'TE']);
const ESPN_CONCURRENCY = 6;

type Agg = {
  playerName: string;
  position: string;
  nflTeam: string;
  playerId?: string;
  targets: number;
  airYards: number;
  yac: number;
  carries: number;
  teamCarries: number;
  teamTargets: number;
  targetShareSum: number;
  targetShareN: number;
  offenseSnaps: number;
  snapPctWeighted: number;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
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

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function num(v: string | undefined): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePos(pos: string): string {
  const p = (pos || '').toUpperCase().trim();
  if (p === 'FB') return 'RB';
  return p;
}

function keyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function downloadCsv(url: string, cachePath: string, force = false): Promise<string> {
  if (!force) {
    try {
      const existing = await fs.readFile(cachePath, 'utf-8');
      if (existing.includes(',')) return existing;
    } catch {
      /* download */
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
  if (!res.body) throw new Error(`No body for ${url}`);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(cachePath));
  return fs.readFile(cachePath, 'utf-8');
}

async function downloadBinary(url: string, cachePath: string, force = false): Promise<string> {
  if (!force) {
    try {
      await fs.access(cachePath);
      return cachePath;
    } catch {
      /* download */
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
  if (!res.body) throw new Error(`No body for ${url}`);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(cachePath));
  return cachePath;
}

async function loadPlayerStats(season: number): Promise<string> {
  const cachePath = path.join(CACHE_DIR, `player_stats_week_${season}.csv`);
  const urls = [
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`,
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
  ];
  let last: Error | null = null;
  for (const url of urls) {
    try {
      console.log(`   Downloading ${url.split('/').pop()}...`);
      return await downloadCsv(url, cachePath, true);
    } catch (err) {
      last = err as Error;
    }
  }
  throw last ?? new Error(`No player_stats for ${season}`);
}

async function loadSnapCounts(season: number): Promise<string> {
  const cachePath = path.join(CACHE_DIR, `snap_counts_${season}.csv`);
  const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
  console.log(`   Downloading snap_counts_${season}.csv...`);
  return downloadCsv(url, cachePath, true);
}

async function loadPlayersMap(): Promise<{
  byGsis: Map<string, string>;
  byName: Map<string, string>;
}> {
  const cachePath = path.join(CACHE_DIR, 'players.csv');
  const url = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv';
  console.log('   Loading nflverse players (espn_id)...');
  const text = await downloadCsv(url, cachePath, false);
  const rows = parseCsv(text);
  if (rows.length < 2) return { byGsis: new Map(), byName: new Map() };
  const h = rows[0].map((x) => x.toLowerCase());
  const iGsis = h.indexOf('gsis_id');
  const iEspn = h.indexOf('espn_id');
  const iName = h.indexOf('display_name');
  const byGsis = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of rows.slice(1)) {
    const espn = (iEspn >= 0 ? row[iEspn] ?? '' : '').trim();
    if (!espn) continue;
    const gsis = (iGsis >= 0 ? row[iGsis] ?? '' : '').trim();
    const name = (iName >= 0 ? row[iName] ?? '' : '').trim();
    if (gsis) byGsis.set(gsis, espn);
    if (name) byName.set(keyName(name), espn);
  }
  return { byGsis, byName };
}

async function loadTeamDropbacks(season: number): Promise<Map<string, number>> {
  const cachePath = path.join(CACHE_DIR, `play_by_play_${season}.csv.gz`);
  const url = `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
  console.log(`   Loading play_by_play_${season} for qb_dropbacks...`);
  await downloadBinary(url, cachePath, true);

  const rl = readline.createInterface({
    input: createReadStream(cachePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  let iPosteam = -1;
  let iSeasonType = -1;
  let iDrop = -1;
  const drops = new Map<string, number>();

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      const lower = header.map((h) => h.toLowerCase());
      iPosteam = lower.indexOf('posteam');
      iSeasonType = lower.indexOf('season_type');
      iDrop = lower.indexOf('qb_dropback');
      if (iPosteam < 0 || iDrop < 0) {
        throw new Error('play_by_play missing posteam / qb_dropback');
      }
      continue;
    }
    const cols = parseCsvLine(line);
    if (iSeasonType >= 0 && cols[iSeasonType] && cols[iSeasonType] !== 'REG') continue;
    if (cols[iDrop] !== '1') continue;
    const team = (cols[iPosteam] ?? '').trim().toUpperCase();
    if (!team) continue;
    drops.set(team, (drops.get(team) ?? 0) + 1);
  }
  console.log(`   Team dropbacks loaded (${drops.size} teams)`);
  return drops;
}

type EspnRouteBits = { recYards: number; yprr: number };

async function fetchEspnRouteBits(espnId: string, season: number): Promise<EspnRouteBits | null> {
  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/athletes/${espnId}/statistics/0`;
  const res = await fetch(url, { headers: { 'User-Agent': 'fantasy-draft-lab' } });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    splits?: { categories?: Array<{ name?: string; stats?: Array<{ name?: string; value?: number }> }> };
  };
  let recYards = 0;
  let yprr = 0;
  for (const cat of json.splits?.categories ?? []) {
    for (const s of cat.stats ?? []) {
      if (s.name === 'receivingYards' && typeof s.value === 'number') recYards = s.value;
      if (s.name === 'yardsPerRouteRun' && typeof s.value === 'number') yprr = s.value;
    }
  }
  if (!(recYards > 0) || !(yprr > 0)) return null;
  return { recYards, yprr };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function loadRoutePctByPlayer(
  season: number,
  players: Agg[],
  ids: { byGsis: Map<string, string>; byName: Map<string, string> },
  dropbacks: Map<string, number>
): Promise<Map<string, number>> {
  const cachePath = path.join(ESPN_CACHE_DIR, `yprr-route-${season}.json`);
  await fs.mkdir(ESPN_CACHE_DIR, { recursive: true });
  let cached: Record<string, EspnRouteBits> = {};
  try {
    cached = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as Record<string, EspnRouteBits>;
  } catch {
    cached = {};
  }

  const candidates = players.filter((p) => ROUTE_POS.has(p.position) && p.targets > 0);
  const needFetch: Array<{ key: string; espnId: string }> = [];
  for (const p of candidates) {
    const espnId =
      (p.playerId ? ids.byGsis.get(p.playerId) : undefined) ?? ids.byName.get(keyName(p.playerName));
    if (!espnId) continue;
    if (!cached[espnId]) needFetch.push({ key: keyName(p.playerName), espnId });
  }

  // de-dupe espn ids
  const seen = new Set<string>();
  const unique = needFetch.filter((x) => {
    if (seen.has(x.espnId)) return false;
    seen.add(x.espnId);
    return true;
  });

  if (unique.length > 0) {
    console.log(`   Fetching ESPN YPRR for ${unique.length} players...`);
    await mapPool(unique, ESPN_CONCURRENCY, async ({ espnId }) => {
      const bits = await fetchEspnRouteBits(espnId, season);
      if (bits) cached[espnId] = bits;
      return null;
    });
    await fs.writeFile(cachePath, JSON.stringify(cached), 'utf-8');
  }

  const routePct = new Map<string, number>();
  for (const p of candidates) {
    const espnId =
      (p.playerId ? ids.byGsis.get(p.playerId) : undefined) ?? ids.byName.get(keyName(p.playerName));
    if (!espnId) continue;
    const bits = cached[espnId];
    if (!bits) continue;
    const teamDrops = dropbacks.get(p.nflTeam) ?? 0;
    if (teamDrops <= 0 || bits.yprr <= 0) continue;
    const routes = bits.recYards / bits.yprr;
    const pct = Math.min(100, Math.round((routes / teamDrops) * 1000) / 10);
    if (Number.isFinite(pct) && pct > 0) routePct.set(keyName(p.playerName), pct);
  }
  console.log(`   RTE% filled for ${routePct.size} players (ESPN YPRR ÷ team dropbacks)`);
  return routePct;
}

function ensureAgg(map: Map<string, Agg>, name: string, position: string, team: string, playerId?: string): Agg {
  const key = keyName(name);
  let row = map.get(key);
  if (!row) {
    row = {
      playerName: name,
      position,
      nflTeam: team,
      playerId,
      targets: 0,
      airYards: 0,
      yac: 0,
      carries: 0,
      teamCarries: 0,
      teamTargets: 0,
      targetShareSum: 0,
      targetShareN: 0,
      offenseSnaps: 0,
      snapPctWeighted: 0,
    };
    map.set(key, row);
  } else {
    if (team) row.nflTeam = team;
    if (playerId && !row.playerId) row.playerId = playerId;
  }
  return row;
}

export async function run(season = SEASON_DEFAULT): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const statsText = await loadPlayerStats(season);
  const statsRows = parseCsv(statsText);
  if (statsRows.length < 2) throw new Error('player_stats empty');
  const sh = statsRows[0].map((h) => h.toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = sh.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const iName = col('player_display_name', 'player_name', 'player');
  const iPos = col('position');
  const iTeam = col('team', 'recent_team', 'team_abbr');
  const iWeek = col('week');
  const iSeasonType = col('season_type');
  const iTargets = col('targets');
  const iAir = col('receiving_air_yards');
  const iYac = col('receiving_yards_after_catch');
  const iCarries = col('carries', 'rushing_attempts');
  const iTgtShare = col('target_share');
  const iPlayerId = col('player_id');
  if (iName < 0 || iPos < 0) throw new Error('player_stats missing name/position');

  /** week::team → totals for share denominators */
  const teamWeekCarries = new Map<string, number>();
  const teamWeekTargets = new Map<string, number>();
  const skillRows: Array<{
    name: string;
    pos: string;
    team: string;
    week: number;
    playerId?: string;
    targets: number;
    air: number;
    yac: number;
    carries: number;
    tgtShare: number;
  }> = [];

  for (const row of statsRows.slice(1)) {
    const seasonType = iSeasonType >= 0 ? (row[iSeasonType] ?? '').toUpperCase() : 'REG';
    if (seasonType && seasonType !== 'REG') continue;
    const name = (row[iName] ?? '').trim();
    const pos = normalizePos(row[iPos] ?? '');
    const team = (iTeam >= 0 ? row[iTeam] ?? '' : '').trim().toUpperCase();
    const week = iWeek >= 0 ? num(row[iWeek]) : 0;
    if (!name || !SKILL.has(pos) || !team) continue;
    const targets = iTargets >= 0 ? num(row[iTargets]) : 0;
    const carries = iCarries >= 0 ? num(row[iCarries]) : 0;
    const tw = `${week}::${team}`;
    teamWeekCarries.set(tw, (teamWeekCarries.get(tw) ?? 0) + carries);
    teamWeekTargets.set(tw, (teamWeekTargets.get(tw) ?? 0) + targets);
    skillRows.push({
      name,
      pos,
      team,
      week,
      playerId: iPlayerId >= 0 ? (row[iPlayerId] ?? '').trim() || undefined : undefined,
      targets,
      air: iAir >= 0 ? num(row[iAir]) : 0,
      yac: iYac >= 0 ? num(row[iYac]) : 0,
      carries,
      tgtShare: iTgtShare >= 0 ? num(row[iTgtShare]) : 0,
    });
  }

  const byPlayer = new Map<string, Agg>();
  for (const r of skillRows) {
    const agg = ensureAgg(byPlayer, r.name, r.pos, r.team, r.playerId);
    agg.targets += r.targets;
    agg.airYards += r.air;
    agg.yac += r.yac;
    agg.carries += r.carries;
    const tw = `${r.week}::${r.team}`;
    agg.teamCarries += teamWeekCarries.get(tw) ?? 0;
    agg.teamTargets += teamWeekTargets.get(tw) ?? 0;
    if (r.tgtShare > 0) {
      agg.targetShareSum += r.tgtShare;
      agg.targetShareN += 1;
    }
  }

  const snapsText = await loadSnapCounts(season);
  const snapRows = parseCsv(snapsText);
  if (snapRows.length >= 2) {
    const nh = snapRows[0].map((h) => h.toLowerCase());
    const n = (...names: string[]) => {
      for (const name of names) {
        const i = nh.indexOf(name.toLowerCase());
        if (i >= 0) return i;
      }
      return -1;
    };
    const iPlayer = n('player', 'player_name');
    const iPos = n('position');
    const iTeam = n('team');
    const iOffSnaps = n('offense_snaps');
    const iOffPct = n('offense_pct');
    const iGameType = n('game_type');
    for (const row of snapRows.slice(1)) {
      const gameType = iGameType >= 0 ? (row[iGameType] ?? '').toUpperCase() : 'REG';
      if (gameType && gameType !== 'REG') continue;
      const name = (iPlayer >= 0 ? row[iPlayer] ?? '' : '').trim();
      const pos = normalizePos(iPos >= 0 ? row[iPos] ?? '' : '');
      const team = (iTeam >= 0 ? row[iTeam] ?? '' : '').trim().toUpperCase();
      if (!name || !SKILL.has(pos)) continue;
      const snaps = iOffSnaps >= 0 ? num(row[iOffSnaps]) : 0;
      const pct = iOffPct >= 0 ? num(row[iOffPct]) : 0; // 0–1
      if (snaps <= 0 && pct <= 0) continue;
      const agg = ensureAgg(byPlayer, name, pos, team);
      const weight = snaps > 0 ? snaps : 1;
      agg.offenseSnaps += weight;
      agg.snapPctWeighted += pct * weight;
    }
  }

  const [ids, dropbacks] = await Promise.all([loadPlayersMap(), loadTeamDropbacks(season)]);
  const routePctByPlayer = await loadRoutePctByPlayer(season, [...byPlayer.values()], ids, dropbacks);

  const lines = [
    'playerName,position,nflTeam,season,snapPct,airYards,yac,adot,targetShare,carryShare,routePct,targets,carries',
  ];
  const sorted = [...byPlayer.values()].sort((a, b) => a.playerName.localeCompare(b.playerName));
  for (const p of sorted) {
    const snapPct =
      p.offenseSnaps > 0 ? Math.round((p.snapPctWeighted / p.offenseSnaps) * 1000) / 10 : '';
    const adot = p.targets > 0 ? Math.round((p.airYards / p.targets) * 10) / 10 : '';
    const targetShare =
      p.teamTargets > 0
        ? Math.round((p.targets / p.teamTargets) * 1000) / 10
        : p.targetShareN > 0
          ? Math.round((p.targetShareSum / p.targetShareN) * 1000) / 10
          : '';
    const carryShare = p.teamCarries > 0 ? Math.round((p.carries / p.teamCarries) * 1000) / 10 : '';
    const routePct = routePctByPlayer.get(keyName(p.playerName));
    lines.push(
      [
        csvEscape(p.playerName),
        p.position,
        p.nflTeam,
        season,
        snapPct,
        Math.round(p.airYards),
        Math.round(p.yac),
        adot,
        targetShare,
        carryShare,
        routePct ?? '',
        p.targets,
        p.carries,
      ].join(',')
    );
  }

  const outPath = path.join(OUT_DIR, `player-usage-${season}.csv`);
  await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf-8');
  console.log(`   Wrote ${outPath} (${sorted.length} players)`);
}

const invokedDirectly = /fetch-player-usage/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  const season = Number(argValue('--season') ?? SEASON_DEFAULT);
  if (!Number.isFinite(season)) {
    console.error('Invalid --season');
    process.exit(1);
  }
  run(season).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
