/**
 * Import PPR fantasy points from nflverse seasonal player stats.
 *
 * Source:
 *   https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season_{year}.csv
 *
 * Usage:
 *   npm run enrichment:import-fantasy-points
 *   npm run enrichment:import-fantasy-points -- --from 2014 --to 2025
 */
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const OUT_PATH = path.resolve(__dirname, '../../data/enrichment/fantasy-points.csv');
const CACHE_DIR = path.resolve(__dirname, '../../.cache/nflverse');

const SKILL_POS = new Set(['QB', 'RB', 'WR', 'TE', 'FB', 'K']);

type PointsRow = {
  playerName: string;
  season: number;
  position: string;
  nflTeam: string;
  fantasyPoints: number;
  gamesPlayed: number;
};

function parseArgs(argv: string[]): { from: number; to: number } {
  let from = 2014;
  let to = new Date().getFullYear();
  const fromIdx = argv.indexOf('--from');
  const toIdx = argv.indexOf('--to');
  if (fromIdx >= 0) from = parseInt(argv[fromIdx + 1], 10);
  if (toIdx >= 0) to = parseInt(argv[toIdx + 1], 10);
  return { from, to };
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
      // ignore
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

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizePosition(pos: string): string {
  const p = (pos || '').toUpperCase().trim();
  if (p === 'FB') return 'RB';
  return p;
}

async function downloadCsv(url: string, cachePath: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error(`No body for ${url}`);
  const fileStream = createWriteStream(cachePath);
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), fileStream);
  return fs.readFile(cachePath, 'utf-8');
}

async function downloadSeason(year: number, inProgress: boolean): Promise<string> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `player_stats_${inProgress ? 'week_' : 'season_'}${year}.csv`);
  if (!inProgress) {
    try {
      const existing = await fs.readFile(cachePath, 'utf-8');
      if (existing.includes('fantasy_points_ppr')) return existing;
    } catch {
      // download
    }
  }

  const urls = inProgress
    ? [
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${year}.csv`,
        `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`,
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season_${year}.csv`,
      ]
    : [
        `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season_${year}.csv`,
        `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${year}.csv`,
      ];

  let lastError: Error | null = null;
  for (const url of urls) {
    console.log(`Downloading ${year} (${url.split('/').pop()})...`);
    try {
      return await downloadCsv(url, cachePath);
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error(`No nflverse stats found for ${year}`);
}

const POS_BY_ID: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
};

async function espnSeasonTotals(year: number): Promise<PointsRow[]> {
  console.log(`  ${year}: ESPN PPR season-total fallback...`);
  const filter = {
    players: {
      limit: 100,
      offset: 0,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      filterSlotIds: { value: [0, 2, 3, 4, 5, 6, 16, 17, 23] },
    },
  };
  const out: PointsRow[] = [];
  for (let offset = 0; offset < 800; offset += 100) {
    filter.players.offset = offset;
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/players?scoringPeriodId=0&view=kona_player_info`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-fantasy-filter': JSON.stringify(filter),
      },
    });
    if (!res.ok) throw new Error(`ESPN players ${res.status}`);
    const body = (await res.json()) as Array<{
      id?: number;
      fullName?: string;
      defaultPositionId?: number;
      proTeamId?: number;
      stats?: Array<{
        seasonId?: number;
        scoringPeriodId?: number;
        statSourceId?: number;
        appliedTotal?: number;
        appliedAverage?: number;
        stats?: Record<string, number>;
      }>;
      player?: { fullName?: string; defaultPositionId?: number; stats?: unknown };
    }>;
    const page = Array.isArray(body) ? body : [];
    if (page.length === 0) break;
    for (const raw of page) {
      const player = raw.player ? { ...raw.player, ...raw } : raw;
      const name = (player.fullName ?? '').trim();
      const pos = POS_BY_ID[player.defaultPositionId ?? -1];
      if (!name || !pos) continue;
      const seasonRow = (player.stats ?? []).find(
        (s) => s.seasonId === year && (s.scoringPeriodId === 0 || s.scoringPeriodId == null) && (s.statSourceId === 0 || s.statSourceId == null)
      ) ?? (player.stats ?? []).find((s) => (s.appliedTotal ?? 0) > 0);
      const pts = seasonRow?.appliedTotal;
      if (pts == null || !Number.isFinite(pts)) continue;
      const avg = seasonRow?.appliedAverage;
      const gamesFromAvg = avg && avg > 0 ? Math.max(1, Math.round(pts / avg)) : 0;
      const gamesStat = seasonRow?.stats?.['0'];
      out.push({
        playerName: name,
        season: year,
        position: pos,
        nflTeam: '',
        fantasyPoints: Math.round(pts * 10) / 10,
        gamesPlayed: Number.isFinite(gamesStat) && gamesStat > 0 ? gamesStat : gamesFromAvg,
      });
    }
    if (page.length < 100) break;
  }
  const byName = new Map<string, PointsRow>();
  for (const r of out) {
    const key = r.playerName.toLowerCase();
    const prev = byName.get(key);
    if (!prev || r.fantasyPoints > prev.fantasyPoints) byName.set(key, r);
  }
  return [...byName.values()];
}

function rowsFromSeasonCsv(text: string, year: number): PointsRow[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const nameIdx = idx('player_display_name');
  const posIdx = idx('position');
  const teamIdx = idx('recent_team');
  const gamesIdx = idx('games');
  const pprIdx = idx('fantasy_points_ppr');
  const seasonTypeIdx = idx('season_type');
  const seasonIdx = idx('season');

  if (nameIdx < 0 || pprIdx < 0) {
    throw new Error(`Missing required columns for ${year}`);
  }

  const out: PointsRow[] = [];
  for (const row of table.slice(1)) {
    if (!row.length || row.every((c) => !c)) continue;
    const seasonType = seasonTypeIdx >= 0 ? row[seasonTypeIdx] : 'REG';
    if (seasonType && seasonType !== 'REG') continue;

    const season = seasonIdx >= 0 ? parseInt(row[seasonIdx], 10) : year;
    if (season !== year) continue;

    const rawPos = row[posIdx] ?? '';
    const position = normalizePosition(rawPos);
    if (!SKILL_POS.has(rawPos.toUpperCase()) && !SKILL_POS.has(position)) continue;

    const playerName = (row[nameIdx] ?? '').trim();
    if (!playerName) continue;

    const fantasyPoints = parseFloat(row[pprIdx]);
    if (!Number.isFinite(fantasyPoints)) continue;

    out.push({
      playerName,
      season: year,
      position,
      nflTeam: (row[teamIdx] ?? '').trim(),
      fantasyPoints: Math.round(fantasyPoints * 10) / 10,
      gamesPlayed: parseInt(row[gamesIdx] ?? '0', 10) || 0,
    });
  }

  // Prefer highest PPR if duplicate names somehow appear
  const byName = new Map<string, PointsRow>();
  for (const r of out) {
    const key = r.playerName.toLowerCase();
    const prev = byName.get(key);
    if (!prev || r.fantasyPoints > prev.fantasyPoints) byName.set(key, r);
  }
  return [...byName.values()].sort((a, b) => b.fantasyPoints - a.fantasyPoints);
}

function rowsFromWeeklyCsv(text: string, year: number): PointsRow[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const nameIdx = idx('player_display_name') >= 0 ? idx('player_display_name') : idx('player_name');
  const posIdx = idx('position');
  const teamIdx = idx('recent_team') >= 0 ? idx('recent_team') : idx('team');
  const pprIdx = idx('fantasy_points_ppr');
  const seasonTypeIdx = idx('season_type');
  const seasonIdx = idx('season');
  const weekIdx = idx('week');
  if (nameIdx < 0 || pprIdx < 0) return [];

  const totals = new Map<string, PointsRow & { weeks: Set<number> }>();
  for (const row of table.slice(1)) {
    if (!row.length || row.every((c) => !c)) continue;
    const seasonType = seasonTypeIdx >= 0 ? row[seasonTypeIdx] : 'REG';
    if (seasonType && seasonType !== 'REG') continue;
    const season = seasonIdx >= 0 ? parseInt(row[seasonIdx], 10) : year;
    if (season !== year) continue;
    const rawPos = row[posIdx] ?? '';
    const position = normalizePosition(rawPos);
    if (!SKILL_POS.has(rawPos.toUpperCase()) && !SKILL_POS.has(position)) continue;
    const playerName = (row[nameIdx] ?? '').trim();
    if (!playerName) continue;
    const fantasyPoints = parseFloat(row[pprIdx]);
    if (!Number.isFinite(fantasyPoints)) continue;
    const week = weekIdx >= 0 ? parseInt(row[weekIdx], 10) : 0;
    const key = playerName.toLowerCase();
    const prev = totals.get(key);
    if (!prev) {
      const weeks = new Set<number>();
      if (week > 0) weeks.add(week);
      totals.set(key, {
        playerName,
        season: year,
        position,
        nflTeam: (row[teamIdx] ?? '').trim(),
        fantasyPoints,
        gamesPlayed: week > 0 ? 1 : 0,
        weeks,
      });
    } else {
      prev.fantasyPoints = Math.round((prev.fantasyPoints + fantasyPoints) * 10) / 10;
      prev.nflTeam = (row[teamIdx] ?? '').trim() || prev.nflTeam;
      if (week > 0) prev.weeks.add(week);
      prev.gamesPlayed = prev.weeks.size;
    }
  }
  return [...totals.values()]
    .map(({ weeks: _weeks, ...row }) => ({
      ...row,
      fantasyPoints: Math.round(row.fantasyPoints * 10) / 10,
    }))
    .sort((a, b) => b.fantasyPoints - a.fantasyPoints);
}

function looksWeekly(text: string): boolean {
  const header = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  return header.includes('week') && header.includes('fantasy_points_ppr');
}

export async function run(from?: number, to?: number): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const start = from ?? parsed.from;
  const end = to ?? parsed.to;
  const all: PointsRow[] = [];
  const nowYear = new Date().getFullYear();

  for (let year = start; year <= end; year++) {
    const inProgress = year >= nowYear;
    try {
      const text = await downloadSeason(year, inProgress);
      const rows = looksWeekly(text) ? rowsFromWeeklyCsv(text, year) : rowsFromSeasonCsv(text, year);
      if (rows.length === 0) throw new Error('parsed 0 player rows');
      console.log(`  ${year}: ${rows.length} players (PPR${inProgress ? ' YTD' : ''})`);
      if (rows[0]) {
        console.log(
          `    top: ${rows[0].playerName} ${rows[0].fantasyPoints} (${rows[0].position}, ${rows[0].nflTeam})`
        );
      }
      all.push(...rows);
    } catch (err) {
      if (inProgress) {
        try {
          const espnRows = await espnSeasonTotals(year);
          if (espnRows.length === 0) throw err;
          console.log(`  ${year}: ${espnRows.length} players (ESPN YTD fallback)`);
          all.push(...espnRows);
          continue;
        } catch (espnErr) {
          console.error(`  ${year}: FAILED — ${(espnErr as Error).message}`);
          continue;
        }
      }
      console.error(`  ${year}: FAILED — ${(err as Error).message}`);
    }
  }

  all.sort((a, b) => a.season - b.season || b.fantasyPoints - a.fantasyPoints);

  const lines = [
    'playerName,season,position,nflTeam,fantasyPoints,gamesPlayed',
    ...all.map((r) =>
      [r.playerName, r.season, r.position, r.nflTeam, r.fantasyPoints, r.gamesPlayed]
        .map(csvEscape)
        .join(',')
    ),
  ];

  await fs.writeFile(OUT_PATH, lines.join('\n') + '\n', 'utf-8');
  console.log(`\nWrote ${all.length} rows -> ${OUT_PATH}`);
  console.log(`Seasons: ${[...new Set(all.map((r) => r.season))].join(', ')}`);
  console.log('Scoring: fantasy_points_ppr (nflverse) / ESPN appliedTotal fallback for in-progress year');
}

const invokedDirectly = /import-fantasy-points/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
