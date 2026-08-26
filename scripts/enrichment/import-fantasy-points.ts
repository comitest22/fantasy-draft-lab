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
  let to = 2025;
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

async function downloadSeason(year: number): Promise<string> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `player_stats_season_${year}.csv`);
  try {
    const existing = await fs.readFile(cachePath, 'utf-8');
    if (existing.includes('fantasy_points_ppr')) return existing;
  } catch {
    // download
  }

  const urls = [
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_season_${year}.csv`,
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${year}.csv`,
  ];

  let lastError: Error | null = null;
  for (const url of urls) {
    const label = url.includes('stats_player_reg') ? 'stats_player_reg' : 'player_stats_season';
    console.log(`Downloading ${year} (${label})...`);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
        continue;
      }
      if (!res.body) throw new Error(`No body for ${url}`);

      const fileStream = createWriteStream(cachePath);
      await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), fileStream);
      return fs.readFile(cachePath, 'utf-8');
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error(`No nflverse stats found for ${year}`);
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

async function main(): Promise<void> {
  const { from, to } = parseArgs(process.argv.slice(2));
  const all: PointsRow[] = [];

  for (let year = from; year <= to; year++) {
    try {
      const text = await downloadSeason(year);
      const rows = rowsFromSeasonCsv(text, year);
      console.log(`  ${year}: ${rows.length} players (PPR)`);
      if (rows[0]) {
        console.log(
          `    top: ${rows[0].playerName} ${rows[0].fantasyPoints} (${rows[0].position}, ${rows[0].nflTeam})`
        );
      }
      all.push(...rows);
    } catch (err) {
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
  console.log('Scoring: fantasy_points_ppr (nflverse)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
