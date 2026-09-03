/**
 * Replace rank-bucket expectedPoints with Mike Clay pre-draft PPR (FF Pt)
 * from ESPN draft-kit projection guides.
 *
 * Markdown extracts of the PDFs live in %TEMP%/espn-clay-md/{year}.md
 * (fetched from g.espncdn.com/s/ffldraftkit/{YY}/NFLDK{YYYY}_CS_ClayProjections*.pdf).
 *
 * Clay publishes FF Pt for QB/RB/WR/TE. Kickers use Clay FGM/XPM converted
 * with ESPN scoring (3.5 per FG + 1 per XP). D/ST has no Clay FF Pt.
 *
 * Usage: npx tsx scripts/enrichment/apply-clay-projections.ts
 */
import fs from 'fs';
import path from 'path';

const MD_DIR = path.join(process.env.TEMP ?? '/tmp', 'espn-clay-md');
const RANK_DIR = path.resolve(__dirname, '../../data/enrichment/espn-ppr-overall');
const ADP_PATH = path.resolve(__dirname, '../../data/enrichment/adp.csv');
const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const NAME_ALIASES: Record<string, string> = {
  'bill croskey merritt': 'jacory croskey merritt',
  'hollywood brown': 'marquise brown',
  'ken walker': 'kenneth walker',
  'kenneth walker iii': 'kenneth walker',
  'd k metcalf': 'dk metcalf',
  'd j moore': 'dj moore',
  'gabe davis': 'gabriel davis',
  'josh palmer': 'joshua palmer',
  'chig okonkwo': 'chigoziem okonkwo',
  'scotty miller': 'scott miller',
  'rob woods': 'robert woods',
  'matt stafford': 'matthew stafford',
  'josh reynolds': 'joshua reynolds',
  'cam ward': 'cameron ward',
  'phil mafah': 'philip mafah',
};

const TEAMS = new Set([
  'ARI', 'ARZ', 'ATL', 'BAL', 'BLT', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'CLV',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'HST', 'IND', 'JAC', 'JAX', 'KC', 'LAC',
  'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'OAK', 'PHI', 'PIT',
  'SEA', 'SF', 'TB', 'TEN', 'WAS', 'WSH', 'FA', 'SD', 'STL', 'LA',
]);

const SKIP_NAMES = new Set([
  'total', 'grand total', 'player', 'quarterback', 'running back', 'wide receiver',
  'tight end', 'kicker', 'punter', 'offense', 'defense', 'unit',
]);

function normalizeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return NAME_ALIASES[cleaned] ?? cleaned;
}

function isPlayerName(raw: string): boolean {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < 4 || s.length > 40) return false;
  if (SKIP_NAMES.has(s.toLowerCase())) return false;
  if (/\d/.test(s) || /%/.test(s)) return false;
  if (TEAMS.has(s.toUpperCase())) return false;
  return /^[A-Z][A-Za-z'.\-]*(?:\s+(?:[A-Z][A-Za-z'.\-]*|Jr\.?|Sr\.?|II|III|IV|V))+$/.test(s);
}

function intsIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)]
    .map((m) => parseFloat(m[0]))
    .filter((n) => Number.isFinite(n));
}

function ffPtFromNumbers(nums: number[], headerHint: 'new' | 'old' | 'unknown'): number | null {
  if (nums.length < 3) return null;
  const gamesFirst = nums[0] <= 17 && nums[2] >= 100;
  const rankPtsGames = nums[2] <= 17 && nums[1] >= 8 && nums[1] <= 450;
  if (headerHint === 'old' || (headerHint === 'unknown' && gamesFirst)) {
    const pts = nums[nums.length - 2];
    if (pts >= 8 && pts <= 450) return pts;
  }
  if (headerHint === 'new' || (headerHint === 'unknown' && rankPtsGames)) {
    if (nums[1] >= 8 && nums[1] <= 450) return nums[1];
  }
  return null;
}

function parseLeaderboard(md: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = md.split(/\r?\n/);
  let inBoard = false;
  let headerHint: 'new' | 'old' | 'unknown' = 'unknown';

  for (const raw of lines) {
    const line = raw.trim();
    if (/^[#|\s]*(Quarterback|Running Back|Wide Receiver|Tight End) Projections\b/i.test(line)) {
      inBoard = true;
      headerHint = 'unknown';
      continue;
    }
    if (inBoard && /^[#|\s]*(Category Leader Projections|Projected standings|Projected Starters)\b/i.test(line)) {
      inBoard = false;
      continue;
    }
    if (!inBoard || !line.startsWith('|')) continue;

    const cells = line.split('|').map((c) => c.trim()).filter((c) => c && c !== '---' && !/^-+$/.test(c));
    const headerText = cells.join(' ');
    if (/FF Pt/i.test(headerText) && /Pos Rk/i.test(headerText)) {
      const ffIdx = headerText.search(/FF Pts?/i);
      const rkIdx = headerText.search(/Pos Rk/i);
      headerHint = rkIdx >= 0 && ffIdx > rkIdx ? 'new' : 'old';
      continue;
    }
    if (/Quarterback|Running Back|Wide Receiver|Tight End/i.test(headerText) && cells.length <= 6) continue;

    const name = cells.find((c) => isPlayerName(c));
    if (!name) continue;
    const team = cells.find((c) => TEAMS.has(c.toUpperCase()));
    const after = team ? cells.slice(cells.indexOf(team) + 1).join(' ') : cells.filter((c) => c !== name).join(' ');
    const nums = intsIn(after).filter((n) => n < 10000);
    const pts = ffPtFromNumbers(nums, headerHint);
    if (pts == null) continue;
    const key = normalizeName(name);
    if (!out.has(key) || pts > (out.get(key) ?? 0)) out.set(key, pts);
  }
  return out;
}

const TEAM_LINE =
  /(?:^|\n|\|\s*)(?:(QB|RB|WR|TE)\s+)?([A-Z][A-Za-z'.\-]+(?:\s+(?:[A-Z][A-Za-z'.\-]*|Jr\.?|Sr\.?|II|III|IV|V))+)\s+(\d{1,2}(?:\s+\d+){8,16})\s+(?:DI|ED|LB|CB|S|Int DL|Edge|Int)\b/g;

function parseTeamPages(md: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of md.matchAll(TEAM_LINE)) {
    const name = m[2];
    if (!isPlayerName(name)) continue;
    const nums = intsIn(m[3]);
    if (nums.length < 9) continue;
    // Last number is positional rank; second-to-last is PPR Pts.
    const pts = nums[nums.length - 2];
    const games = nums[0];
    if (games < 1 || games > 18) continue;
    if (pts < 8 || pts > 450) continue;
    const key = normalizeName(name);
    if (!out.has(key) || pts > (out.get(key) ?? 0)) out.set(key, pts);
  }
  return out;
}

function parseKickers(md: string): Map<string, number> {
  const out = new Map<string, number>();
  const chunks = md.split(/KICKER\b/i).slice(1);
  for (const chunk of chunks) {
    const until = chunk.split(/PUNTER\b/i)[0];
    const re =
      /([A-Z][A-Za-z'.\-]+(?:\s+[A-Z][A-Za-z'.\-]+)+)\s+(\d{1,2})\s+(\d{1,2})\s+\d{1,3}%\s+(\d{1,2})\s+(\d{1,2})\s+\d{1,3}%/g;
    for (const m of until.matchAll(re)) {
      const name = m[1];
      if (!isPlayerName(name)) continue;
      const fgm = parseInt(m[2], 10);
      const xpm = parseInt(m[4], 10);
      if (fgm > 45 || xpm > 70) continue;
      const pts = Math.round((fgm * 3.5 + xpm) * 10) / 10;
      out.set(normalizeName(name), pts);
    }
  }
  return out;
}

function mergeMaps(...maps: Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of maps) {
    for (const [k, v] of map) {
      if (!out.has(k)) out.set(k, v);
    }
  }
  return out;
}

function lookup(proj: Map<string, number>, playerName: string): number | undefined {
  const key = normalizeName(playerName);
  if (proj.has(key)) return proj.get(key);
  const alias = NAME_ALIASES[key];
  if (alias && proj.has(alias)) return proj.get(alias);

  const parts = key.split(' ');
  const ln = parts[parts.length - 1];
  const fn = parts[0] ?? '';
  const candidates = [...proj.keys()].filter((k) => {
    const kp = k.split(' ');
    if (kp[kp.length - 1] !== ln) return false;
    const kfn = kp[0] ?? '';
    return kfn === fn || kfn.startsWith(fn) || fn.startsWith(kfn);
  });
  if (candidates.length === 1) return proj.get(candidates[0]);
  return undefined;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else current += ch;
  }
  result.push(current);
  return result;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function loadProjections(year: number): Map<string, number> | null {
  const mdPath = path.join(MD_DIR, `${year}.md`);
  if (!fs.existsSync(mdPath)) return null;
  const md = fs.readFileSync(mdPath, 'utf-8');
  const board = parseLeaderboard(md);
  const team = parseTeamPages(md);
  const kickers = parseKickers(md);
  // Leaderboard FF Pt is the published positional projection; fill gaps from team pages.
  return mergeMaps(board, team, kickers);
}

function applyToRankFile(year: number, proj: Map<string, number> | null): {
  matched: number;
  missing: string[];
  total: number;
} {
  const rankPath = path.join(RANK_DIR, `${year}.csv`);
  const raw = fs.readFileSync(rankPath, 'utf-8');
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0];
  const missing: string[] = [];
  let matched = 0;
  const out = [header];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const name = cols[0];
    const pos = cols[2];
    const pts = proj ? lookup(proj, name) : undefined;
    if (pts != null) {
      cols[4] = String(pts);
      matched += 1;
    } else {
      cols[4] = '';
      if (pos !== 'D/ST') missing.push(`${name} (${pos})`);
    }
    out.push(cols.map(csvEscape).join(','));
  }
  fs.writeFileSync(rankPath, out.join('\n') + '\n');
  return { matched, missing, total: lines.length - 1 };
}

function rebuildAdp(): void {
  const files = fs
    .readdirSync(RANK_DIR)
    .filter((f) => /^\d{4}\.csv$/i.test(f))
    .sort();
  const rows: string[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(RANK_DIR, file), 'utf-8');
    const lines = raw.trim().split(/\r?\n/).slice(1).filter((l) => l.trim());
    rows.push(...lines);
  }
  rows.sort((a, b) => {
    const aa = parseCsvLine(a);
    const bb = parseCsvLine(b);
    const seasonA = parseInt(aa[1], 10);
    const seasonB = parseInt(bb[1], 10);
    if (seasonA !== seasonB) return seasonA - seasonB;
    return (parseFloat(aa[3]) || 0) - (parseFloat(bb[3]) || 0);
  });
  fs.writeFileSync(ADP_PATH, ['playerName,season,position,adp,expectedPoints', ...rows].join('\n') + '\n');
}

function main(): void {
  for (const year of YEARS) {
    const proj = loadProjections(year);
    const stats = applyToRankFile(year, proj);
    const sample = proj
      ? ['derrick henry', 'ceedee lamb', 'ladd mcconkey', 'jamarr chase']
          .map((n) => {
            const pts = [...proj.entries()].find(([k]) => k === n)?.[1];
            return pts != null ? `${n}=${pts}` : null;
          })
          .filter(Boolean)
          .join(', ')
      : 'no Clay PDF';
    console.log(
      `${year}: matched ${stats.matched}/${stats.total} skill+K (D/ST left blank) ${sample}`
    );
    if (stats.missing.length && stats.missing.length <= 25) {
      console.log(`  unmatched: ${stats.missing.join('; ')}`);
    } else if (stats.missing.length) {
      console.log(`  unmatched ${stats.missing.length}: ${stats.missing.slice(0, 12).join('; ')}…`);
    }
  }
  rebuildAdp();
  console.log(`\nWrote ${ADP_PATH}`);
}

main();
