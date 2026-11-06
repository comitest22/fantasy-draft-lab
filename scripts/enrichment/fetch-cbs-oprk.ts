/**
 * Scrape CBS Sports Fantasy position-vs-defense points allowed (public, no auth) and write
 *   data/enrichment/cbs-oprk-{season}.json
 *
 * CBS publishes 1 = fewest fantasy points allowed (toughest) — already OPRK-style.
 *
 *   npx tsx scripts/enrichment/fetch-cbs-oprk.ts
 *   npx tsx scripts/enrichment/fetch-cbs-oprk.ts --season 2026
 */
import fs from 'fs/promises';
import path from 'path';
import {
  platformOprkFilePayload,
  type PlatformOprkMatrix,
} from '../../server/src/services/platformOprk';
import type { Position } from '../../server/src/types';

const ROOT = path.resolve(__dirname, '../..');
const SEASON_DEFAULT = 2026;
const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

/** CBS table labels use nicknames (“QB vs Lions”). */
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

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

async function fetchPositionPage(pos: Position): Promise<string> {
  const url =
    `https://www.cbssports.com/fantasy/football/stats/posvsdef/` +
    `${encodeURIComponent(pos)}/all/avg/standard`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'fantasy-draft-lab/1.0 (+local enrichment)',
      Accept: 'text/html',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  if (!res.ok) {
    throw new Error(`CBS posvsdef ${pos} failed (${res.status})`);
  }
  return res.text();
}

function parseCbsRanks(html: string, pos: Position): Map<string, number> {
  const out = new Map<string, number>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  // “32 QB vs Lions 41.25 …” — nick is one token (or “49ers”).
  const re = new RegExp(`^(\\d+)\\s+${pos}\\s+vs\\s+(\\S+)\\b`, 'i');
  for (const match of html.matchAll(rowRe)) {
    const text = stripTags(match[1] ?? '');
    const m = text.match(re);
    if (!m) continue;
    const rank = Number(m[1]);
    const nick = (m[2] ?? '').trim();
    if (!Number.isFinite(rank) || rank < 1 || rank > 32) continue;
    const abbr = NICK_TO_ABBR[nick];
    if (!abbr) {
      console.warn(`   unrecognized CBS nick: ${nick} (${pos})`);
      continue;
    }
    out.set(abbr, Math.round(rank));
  }
  return out;
}

export async function run(season = SEASON_DEFAULT): Promise<void> {
  const fromArg = Number(argValue('--season'));
  if (Number.isFinite(fromArg) && fromArg > 0) season = fromArg;

  const matrix: PlatformOprkMatrix = new Map();
  for (const pos of POSITIONS) {
    console.log(`   CBS posvsdef ${pos}…`);
    const html = await fetchPositionPage(pos);
    const byOpp = parseCbsRanks(html, pos);
    if (byOpp.size < 28) {
      throw new Error(`CBS ${pos}: expected ~32 teams, got ${byOpp.size}`);
    }
    matrix.set(pos, byOpp);
    console.log(`   ${pos}: ${byOpp.size} teams`);
  }

  const outPath = path.join(ROOT, 'data/enrichment', `cbs-oprk-${season}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const payload = platformOprkFilePayload(season, 'cbs', matrix);
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${outPath}`);
}

const invokedDirectly = /fetch-cbs-oprk/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
