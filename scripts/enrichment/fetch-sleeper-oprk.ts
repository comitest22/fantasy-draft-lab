/**
 * Derive Sleeper-style positional opponent ranks from public weekly stats
 * (fantasy points allowed by defense vs QB/RB/WR/TE) and write
 *   data/enrichment/sleeper-oprk-{season}.json
 *
 * Matches how Sleeper colors matchups (pts allowed by position; 1 = toughest /
 * fewest points allowed). No Sleeper account required.
 *
 *   npx tsx scripts/enrichment/fetch-sleeper-oprk.ts
 *   npx tsx scripts/enrichment/fetch-sleeper-oprk.ts --season 2026 --through 4
 */
import fs from 'fs/promises';
import path from 'path';
import { canonicalTeam } from '../../server/src/data/enrichment';
import {
  platformOprkFilePayload,
  type PlatformOprkMatrix,
} from '../../server/src/services/platformOprk';
import type { Position } from '../../server/src/types';

const ROOT = path.resolve(__dirname, '../..');
const SEASON_DEFAULT = 2026;
const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function readThroughWeek(season: number): Promise<number> {
  const fromArg = Number(argValue('--through'));
  if (Number.isFinite(fromArg) && fromArg > 0) return fromArg;
  try {
    const raw = await fs.readFile(
      path.join(ROOT, 'data/enrichment/season-state.json'),
      'utf-8'
    );
    const data = JSON.parse(raw) as {
      season?: number;
      completedWeeks?: number;
      currentWeek?: number;
    };
    if (Number.isFinite(data.completedWeeks) && (data.completedWeeks as number) > 0) {
      return data.completedWeeks as number;
    }
    if (Number.isFinite(data.currentWeek) && (data.currentWeek as number) > 1) {
      return (data.currentWeek as number) - 1;
    }
  } catch {
    /* fall through */
  }
  return Math.max(1, season === SEASON_DEFAULT ? 4 : 1);
}

type SleeperStatRow = {
  opponent?: string;
  team?: string;
  stats?: { pts_ppr?: number; pts_half_ppr?: number; gp?: number };
  player?: { position?: string };
};

async function fetchWeekStats(
  season: number,
  week: number,
  pos: Position
): Promise<SleeperStatRow[]> {
  const url =
    `https://api.sleeper.com/stats/nfl/${season}/${week}` +
    `?season_type=regular&position[]=${encodeURIComponent(pos)}&order_by=pts_ppr`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'fantasy-draft-lab' },
  });
  if (!res.ok) {
    throw new Error(`Sleeper stats ${pos} week ${week} failed (${res.status})`);
  }
  const data = (await res.json()) as SleeperStatRow[];
  return Array.isArray(data) ? data : [];
}

function rankByPtsAllowed(
  totals: Map<string, { pts: number; weeks: number }>
): Map<string, number> {
  const rows = [...totals.entries()]
    .filter(([, t]) => t.weeks > 0)
    .map(([team, t]) => ({ team, avg: t.pts / t.weeks }))
    .sort((a, b) => a.avg - b.avg || a.team.localeCompare(b.team));
  const out = new Map<string, number>();
  rows.forEach((r, i) => out.set(r.team, i + 1)); // 1 = fewest pts allowed = toughest
  return out;
}

export async function run(season = SEASON_DEFAULT): Promise<void> {
  const fromArg = Number(argValue('--season'));
  if (Number.isFinite(fromArg) && fromArg > 0) season = fromArg;
  const through = await readThroughWeek(season);
  console.log(`   Sleeper OPRK season=${season} through week ${through}`);

  const matrix: PlatformOprkMatrix = new Map();
  for (const pos of POSITIONS) {
    /** defense abbrev → week → pts allowed that week */
    const byDefWeek = new Map<string, Map<number, number>>();
    for (let week = 1; week <= through; week++) {
      const rows = await fetchWeekStats(season, week, pos);
      for (const row of rows) {
        const def = canonicalTeam(row.opponent);
        if (!def) continue;
        const pts = row.stats?.pts_ppr ?? row.stats?.pts_half_ppr;
        if (pts == null || !Number.isFinite(pts)) continue;
        let weekMap = byDefWeek.get(def);
        if (!weekMap) {
          weekMap = new Map();
          byDefWeek.set(def, weekMap);
        }
        weekMap.set(week, (weekMap.get(week) ?? 0) + pts);
      }
    }

    const totals = new Map<string, { pts: number; weeks: number }>();
    for (const [def, weekMap] of byDefWeek) {
      let pts = 0;
      for (const v of weekMap.values()) pts += v;
      totals.set(def, { pts, weeks: weekMap.size });
    }
    const ranked = rankByPtsAllowed(totals);
    if (ranked.size < 28) {
      throw new Error(`Sleeper ${pos}: expected ~32 teams, got ${ranked.size}`);
    }
    matrix.set(pos, ranked);
    console.log(`   ${pos}: ${ranked.size} teams`);
  }

  const outPath = path.join(ROOT, 'data/enrichment', `sleeper-oprk-${season}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const payload = platformOprkFilePayload(season, 'sleeper', matrix, through);
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${outPath}`);
}

const invokedDirectly = /fetch-sleeper-oprk/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
