/**
 * Through-week O-line ranks from nflverse play-by-play sack rate allowed.
 *
 * REG dropbacks (`qb_dropback=1`) vs sacks (`sack=1`) by posteam.
 * Rank 1 = lowest sack rate (best pass protection proxy).
 *
 * Output: data/enrichment/oline-ranks-{season}.csv
 *
 *   npm run enrichment:fetch-oline-ranks
 *   npm run enrichment:fetch-oline-ranks -- --season 2026
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
const SEASON_DEFAULT = 2026;

const TEAM_MAP: Record<string, string> = {
  LAR: 'LA',
  STL: 'LA',
  SD: 'LAC',
  OAK: 'LV',
  WSH: 'WAS',
};

function canonicalTeam(raw?: string): string | undefined {
  const t = (raw ?? '').trim().toUpperCase();
  if (!t) return undefined;
  return TEAM_MAP[t] ?? t;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function downloadBinary(url: string, dest: string, useCache: boolean): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (useCache) {
    try {
      const st = await fs.stat(dest);
      if (st.size > 0) return;
    } catch {
      /* miss */
    }
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'fantasy-draft-lab' } });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}: ${url}`);
  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  await pipeline(nodeStream, createWriteStream(dest));
}

type TeamTally = { dropbacks: number; sacks: number };

async function loadSackRates(season: number): Promise<Map<string, TeamTally>> {
  const cachePath = path.join(CACHE_DIR, `play_by_play_${season}.csv.gz`);
  const url = `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
  console.log(`   Loading play_by_play_${season} for sack rates...`);
  await downloadBinary(url, cachePath, true);

  const rl = readline.createInterface({
    input: createReadStream(cachePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  let iPosteam = -1;
  let iSeasonType = -1;
  let iDrop = -1;
  let iSack = -1;
  const tallies = new Map<string, TeamTally>();

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      const lower = header.map((h) => h.toLowerCase());
      iPosteam = lower.indexOf('posteam');
      iSeasonType = lower.indexOf('season_type');
      iDrop = lower.indexOf('qb_dropback');
      iSack = lower.indexOf('sack');
      if (iPosteam < 0 || iDrop < 0 || iSack < 0) {
        throw new Error('play_by_play missing posteam / qb_dropback / sack');
      }
      continue;
    }
    const cols = parseCsvLine(line);
    if (iSeasonType >= 0 && cols[iSeasonType] && cols[iSeasonType] !== 'REG') continue;
    if (cols[iDrop] !== '1') continue;
    const team = canonicalTeam(cols[iPosteam]);
    if (!team) continue;
    const row = tallies.get(team) ?? { dropbacks: 0, sacks: 0 };
    row.dropbacks += 1;
    const sackRaw = cols[iSack]?.trim();
    if (sackRaw === '1' || Number(sackRaw) === 1) row.sacks += 1;
    tallies.set(team, row);
  }
  console.log(`   Sack rates loaded (${tallies.size} teams)`);
  return tallies;
}

function rankTeams(tallies: Map<string, TeamTally>): Array<{
  team: string;
  sackRate: number;
  overall: number;
  dropbacks: number;
  sacks: number;
}> {
  const rows = [...tallies.entries()]
    .filter(([, t]) => t.dropbacks >= 20)
    .map(([team, t]) => ({
      team,
      sackRate: t.sacks / t.dropbacks,
      dropbacks: t.dropbacks,
      sacks: t.sacks,
    }))
    .sort((a, b) => a.sackRate - b.sackRate || a.team.localeCompare(b.team));

  return rows.map((r, i) => ({
    team: r.team,
    sackRate: Math.round(r.sackRate * 10000) / 10000,
    overall: i + 1,
    dropbacks: r.dropbacks,
    sacks: r.sacks,
  }));
}

export async function run(season = SEASON_DEFAULT): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const tallies = await loadSackRates(season);
  const ranked = rankTeams(tallies);
  if (ranked.length === 0) {
    console.warn(`   No O-line ranks for ${season} (insufficient PBP dropbacks yet)`);
    return;
  }
  const lines = [
    'team,overall,sackRate,dropbacks,sacks',
    ...ranked.map((r) => `${r.team},${r.overall},${r.sackRate},${r.dropbacks},${r.sacks}`),
  ];
  const outPath = path.join(OUT_DIR, `oline-ranks-${season}.csv`);
  await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf-8');
  console.log(`   Wrote ${path.basename(outPath)} (${ranked.length} teams, 1 = lowest sack rate)`);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

const invokedDirectly = /fetch-oline-ranks/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  const season = Number(argValue('--season') ?? SEASON_DEFAULT);
  if (!Number.isFinite(season)) {
    console.error('Invalid --season');
    process.exit(1);
  }
  run(season).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
