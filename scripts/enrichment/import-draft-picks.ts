/**
 * Import NFL draft picks from nflverse (used for rookie-season detection).
 *
 * Source:
 *   https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv
 *
 * Usage:
 *   npm run enrichment:import-draft-picks
 *   npm run enrichment:import-draft-picks -- --from 2010
 */
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const OUT_PATH = path.resolve(__dirname, '../../data/enrichment/draft-picks.csv');
const CACHE_DIR = path.resolve(__dirname, '../../.cache/nflverse');
const SOURCE_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv';

const KEEP_POS = new Set(['QB', 'RB', 'WR', 'TE', 'FB', 'K']);

type DraftRow = {
  playerName: string;
  draftYear: number;
  position: string;
  team: string;
  round: number;
  pick: number;
};

function parseArgs(argv: string[]): { from: number } {
  let from = 2010;
  const fromIdx = argv.indexOf('--from');
  if (fromIdx >= 0) from = parseInt(argv[fromIdx + 1], 10);
  return { from };
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
    } else if (ch !== '\r') {
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

function normalizePos(pos: string): string {
  const p = (pos || '').toUpperCase().trim();
  if (p === 'FB') return 'RB';
  return p;
}

async function downloadDraftPicks(): Promise<string> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, 'draft_picks.csv');
  try {
    const existing = await fs.readFile(cachePath, 'utf-8');
    if (existing.includes('pfr_player_name')) return existing;
  } catch {
    // download
  }

  console.log('Downloading nflverse draft_picks.csv...');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error('No response body');

  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(cachePath));
  return fs.readFile(cachePath, 'utf-8');
}

async function main(): Promise<void> {
  const { from } = parseArgs(process.argv.slice(2));
  const text = await downloadDraftPicks();
  const table = parseCsv(text);
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const seasonIdx = idx('season');
  const roundIdx = idx('round');
  const pickIdx = idx('pick');
  const teamIdx = idx('team');
  const nameIdx = idx('pfr_player_name');
  const posIdx = idx('position');

  if (seasonIdx < 0 || nameIdx < 0) {
    throw new Error('Unexpected draft_picks schema');
  }

  const rows: DraftRow[] = [];
  const seen = new Set<string>();

  for (const row of table.slice(1)) {
    if (!row.length) continue;
    const draftYear = parseInt(row[seasonIdx], 10);
    if (!Number.isFinite(draftYear) || draftYear < from) continue;

    const playerName = (row[nameIdx] ?? '').trim();
    if (!playerName) continue;

    const position = normalizePos(row[posIdx] ?? '');
    if (position && !KEEP_POS.has(position) && !KEEP_POS.has(row[posIdx]?.toUpperCase() ?? '')) {
      continue;
    }

    const key = `${draftYear}::${playerName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      playerName,
      draftYear,
      position: position || (row[posIdx] ?? ''),
      team: (row[teamIdx] ?? '').trim(),
      round: parseInt(row[roundIdx] ?? '0', 10) || 0,
      pick: parseInt(row[pickIdx] ?? '0', 10) || 0,
    });
  }

  rows.sort((a, b) => a.draftYear - b.draftYear || a.pick - b.pick);

  const lines = [
    'playerName,draftYear,position,team,round,pick',
    ...rows.map((r) =>
      [r.playerName, r.draftYear, r.position, r.team, r.round, r.pick].map(csvEscape).join(',')
    ),
  ];

  await fs.writeFile(OUT_PATH, lines.join('\n') + '\n', 'utf-8');
  console.log(`Wrote ${rows.length} draft picks (from ${from}+) -> ${OUT_PATH}`);

  const sample = rows.filter((r) => r.draftYear === 2025).slice(0, 8);
  if (sample.length) {
    console.log('2025 sample:');
    for (const r of sample) {
      console.log(`  R${r.round}-${r.pick} ${r.playerName} (${r.position}, ${r.team})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
