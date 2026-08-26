/**
 * Import pre-draft ranking .docx files into data/enrichment/adp.csv
 *
 * Usage:
 *   npx tsx scripts/enrichment/import-rankings.ts "C:/Users/jrose/Downloads"
 */
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(__filename);
// mammoth lives in server deps
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('../../server/node_modules/mammoth') as typeof import('mammoth');

const OUT_PATH = path.resolve(__dirname, '../../data/enrichment/adp.csv');
const VALID_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DEF', 'D/ST']);

type AdpRow = {
  playerName: string;
  season: number;
  position: string;
  adp: number;
  expectedPoints: number;
};

function estimateExpectedPoints(adp: number): number {
  if (adp <= 12) return 220;
  if (adp <= 24) return 190;
  if (adp <= 48) return 160;
  if (adp <= 72) return 130;
  if (adp <= 96) return 100;
  if (adp <= 120) return 75;
  return 50;
}

function normalizePos(raw: string): string | null {
  const p = raw.toUpperCase().replace(/\s+/g, '');
  if (p === 'DEF' || p === 'D/ST' || p === 'DST' || p === 'D') return 'D/ST';
  if (p === 'K' || p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE') return p;
  if (VALID_POS.has(raw.toUpperCase())) return raw.toUpperCase();
  return null;
}

function cleanName(name: string): string {
  return name
    .replace(/\[[^\]]*\]/g, '')
    .replace(/—.*$/g, '')
    .replace(/–.*$/g, '')
    .replace(/\s*\{[^}]*\}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHeaderOrJunk(line: string): boolean {
  const l = line.toLowerCase();
  if (!l) return true;
  if (/^ranks?\s*\d/i.test(line)) return true;
  if (/^part\s*\d/i.test(l)) return true;
  if (/big board|pre-draft|elite|tier|value|starter|flex|defense|quarterback/i.test(l) && !/\([A-Z]{1,3}/.test(line)) {
    // emoji section headers often lack player paren
    if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line) || /^[🟥🟦🌟🏈📈🛠⏱🎯]/.test(line)) {
      return true;
    }
  }
  if (/^rank\b/i.test(line) && /player/i.test(line)) return true;
  if (/^(team|bye|posrank|value|pos|position)$/i.test(line)) return true;
  if (/^espn\b/i.test(l) && /ranking|board/i.test(l)) return true;
  return false;
}

/** Format: `1. Le'Veon Bell, RB` */
function parseNumberedComma(line: string): { rank: number; name: string; pos: string } | null {
  const m = line.match(/^(\d+)\.\s+(.+?),\s*([A-Za-z/]+)\s*$/);
  if (!m) return null;
  const pos = normalizePos(m[3]);
  if (!pos) return null;
  return { rank: parseInt(m[1], 10), name: cleanName(m[2]), pos };
}

/** Format: `1. Antonio Brown` (pos on following line) */
function parseNumberedNameOnly(line: string): { rank: number; name: string } | null {
  const m = line.match(/^(\d+)\.\s+(.+)$/);
  if (!m) return null;
  // Reject if it already has comma-pos (handled elsewhere) or paren
  if (/,\s*[A-Za-z/]+\s*$/.test(m[2])) return null;
  if (/\([A-Z]/.test(m[2])) return null;
  return { rank: parseInt(m[1], 10), name: cleanName(m[2]) };
}

/** Format: `Christian McCaffrey (RB, SF)` or `Nick Chubb (RB, Cleveland Browns)` */
function parseParenStyle(line: string): { name: string; pos: string; team?: string } | null {
  // Strip leading rank like "12. " if present with paren style
  const stripped = line.replace(/^\d+\.\s+/, '');
  const m = stripped.match(/^(.+?)\s*\(([A-Za-z/]+)\s*,\s*([^)]+)\)\s*(.*)$/);
  if (!m) return null;
  const pos = normalizePos(m[2]);
  if (!pos) return null;
  const name = cleanName(m[1]);
  if (!name || name.length < 2) return null;
  // Skip defense team-only weirdness still OK
  return { name, pos, team: m[3].trim() };
}

function parseDoc(text: string, season: number): AdpRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: AdpRow[] = [];
  const seen = new Set<string>();
  let sequential = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeaderOrJunk(line)) continue;

    // Skip pure auction dollar lines / bye numbers alone
    if (/^\$\d+/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;

    let rank: number | null = null;
    let name: string | null = null;
    let pos: string | null = null;

    const numberedComma = parseNumberedComma(line);
    if (numberedComma) {
      rank = numberedComma.rank;
      name = numberedComma.name;
      pos = numberedComma.pos;
    } else {
      const paren = parseParenStyle(line);
      if (paren) {
        name = paren.name;
        pos = paren.pos;
        const lead = line.match(/^(\d+)\./);
        // Tentative rank; finalized after dedupe using sequential board order
        rank = lead ? parseInt(lead[1], 10) : -1;
      } else {
        const numberedName = parseNumberedNameOnly(line);
        if (numberedName) {
          // Look ahead for position on next non-empty lines
          let posLine: string | null = null;
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const cand = lines[j];
            if (isHeaderOrJunk(cand)) continue;
            const p = normalizePos(cand);
            if (p) {
              posLine = p;
              break;
            }
            // stop if we hit another numbered player
            if (/^\d+\.\s+/.test(cand)) break;
          }
          if (posLine) {
            rank = numberedName.rank;
            name = numberedName.name;
            pos = posLine;
          }
        }
      }
    }

    if (rank == null || !name || !pos) continue;
    // Skip team defenses for ADP board noise if desired — keep them with DST
    const key = `${season}::${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // For paren-style boards without explicit ranks, use unique insertion order
    if (rank < 0) {
      sequential += 1;
      rank = sequential;
    } else {
      sequential = Math.max(sequential, rank);
    }

    rows.push({
      playerName: name,
      season,
      position: pos,
      adp: rank,
      expectedPoints: estimateExpectedPoints(rank),
    });
  }

  return rows.sort((a, b) => a.adp - b.adp);
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main(): Promise<void> {
  const downloads = process.argv[2] ?? path.resolve(process.env.USERPROFILE ?? '', 'Downloads');
  const files = await fs.readdir(downloads);
  const rankingFiles = files
    .filter((f) => /^\d{4}\s+Rankings\.docx$/i.test(f))
    .sort();

  if (rankingFiles.length === 0) {
    throw new Error(`No "* Rankings.docx" files found in ${downloads}`);
  }

  const allRows: AdpRow[] = [];

  for (const file of rankingFiles) {
    const season = parseInt(file.slice(0, 4), 10);
    const full = path.join(downloads, file);
    const result = await mammoth.extractRawText({ path: full });
    const rows = parseDoc(result.value, season);
    console.log(`${file}: ${rows.length} players`);
    if (rows.length > 0) {
      console.log(`  top5: ${rows.slice(0, 5).map((r) => `${r.adp}. ${r.playerName} (${r.position})`).join('; ')}`);
    }
    allRows.push(...rows);
  }

  allRows.sort((a, b) => a.season - b.season || a.adp - b.adp);

  const lines = [
    'playerName,season,position,adp,expectedPoints',
    ...allRows.map(
      (r) =>
        [r.playerName, r.season, r.position, r.adp, r.expectedPoints].map(csvEscape).join(',')
    ),
  ];

  await fs.writeFile(OUT_PATH, lines.join('\n') + '\n', 'utf-8');
  console.log(`\nWrote ${allRows.length} rows -> ${OUT_PATH}`);
  const seasons = [...new Set(allRows.map((r) => r.season))].sort((a, b) => a - b);
  console.log(`Seasons: ${seasons.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
