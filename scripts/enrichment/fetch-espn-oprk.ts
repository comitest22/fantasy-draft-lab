/**
 * Pull live ESPN weekly OPRK (`positionAgainstOpponent`) and write
 *   data/enrichment/espn-oprk-{season}.json
 * (opponent ranks 1 = toughest + fantasy points allowed / game averages)
 *
 * Needs ESPN_S2 + ESPN_SWID (env or data/secrets/espn-auth.json) and a league id
 * from data/my-team/{season}.json or ESPN_LEAGUE_ID.
 *
 *   npx tsx scripts/enrichment/fetch-espn-oprk.ts
 *   npx tsx scripts/enrichment/fetch-espn-oprk.ts --season 2026 --week 4
 */
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import {
  fetchEspnOprkBundle,
  matrixToRatings,
  type EspnOprkFile,
} from '../../server/src/services/espnOprk';
import { EspnLeagueError, type EspnAuth } from '../../server/src/services/espnLeague';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ROOT = path.resolve(__dirname, '../..');
const SEASON_DEFAULT = 2026;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function readSeasonState(season: number): Promise<{ currentWeek: number }> {
  const raw = await fs.readFile(
    path.join(ROOT, 'data/enrichment/season-state.json'),
    'utf-8'
  );
  const data = JSON.parse(raw) as { season?: number; currentWeek?: number };
  const week = data.currentWeek;
  if (!Number.isFinite(week) || week == null) {
    throw new Error('season-state.json missing currentWeek');
  }
  if (data.season != null && data.season !== season) {
    console.warn(`   season-state season ${data.season} ≠ requested ${season}; using its currentWeek`);
  }
  return { currentWeek: week };
}

async function resolveLeagueId(season: number): Promise<number> {
  const fromEnv = Number(process.env.ESPN_LEAGUE_ID);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const raw = await fs.readFile(
      path.join(ROOT, `data/my-team/${season}.json`),
      'utf-8'
    );
    const team = JSON.parse(raw) as { leagueId?: number };
    if (Number.isFinite(team.leagueId) && team.leagueId != null && team.leagueId > 0) {
      return team.leagueId;
    }
  } catch {
    /* no my-team snapshot */
  }
  throw new Error(
    'No league id: set ESPN_LEAGUE_ID or import My Team (data/my-team/{season}.json).'
  );
}

async function resolveAuth(): Promise<EspnAuth> {
  const fromEnv: EspnAuth = {
    espnS2: process.env.ESPN_S2?.trim() ?? '',
    swid: process.env.ESPN_SWID?.trim() ?? '',
  };
  if (fromEnv.espnS2 && fromEnv.swid) return fromEnv;

  try {
    const raw = await fs.readFile(
      path.join(ROOT, 'data/secrets/espn-auth.json'),
      'utf-8'
    );
    const data = JSON.parse(raw) as Partial<EspnAuth>;
    if (data.espnS2?.trim() && data.swid?.trim()) {
      return { espnS2: data.espnS2.trim(), swid: data.swid.trim() };
    }
  } catch {
    /* no secrets file */
  }

  throw new EspnLeagueError(
    'ESPN cookies required: set ESPN_S2 / ESPN_SWID in .env (or GitHub secrets), or save Import cookies to data/secrets/espn-auth.json.',
    401
  );
}

export async function run(season = SEASON_DEFAULT, week?: number): Promise<void> {
  const scoringPeriodId = week ?? (await readSeasonState(season)).currentWeek;
  const leagueId = await resolveLeagueId(season);
  const auth = await resolveAuth();

  console.log(
    `   Fetching ESPN OPRK matrix league=${leagueId} season=${season} week=${scoringPeriodId}`
  );
  const bundle = await fetchEspnOprkBundle(leagueId, season, auth, scoringPeriodId);
  const ratings = matrixToRatings(bundle.ranks);
  const averages = matrixToRatings(bundle.averages);
  const posCount = Object.keys(ratings).length;
  const cellCount = Object.values(ratings).reduce((n, row) => n + Object.keys(row).length, 0);
  const avgCount = Object.values(averages).reduce((n, row) => n + Object.keys(row).length, 0);

  const payload: EspnOprkFile = {
    season,
    scoringPeriodId,
    leagueId,
    fetchedAt: new Date().toISOString(),
    ratings,
    averages,
  };
  // Repo-relative path (ignore DATA_DIR=../data meant for the server cwd).
  const outPath = path.join(ROOT, 'data/enrichment', `espn-oprk-${season}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(
    `   Wrote ${outPath} (${posCount} positions, ${cellCount} opponent ranks, ${avgCount} FP/g averages)`
  );
}

const invokedDirectly = /fetch-espn-oprk/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  const season = Number(argValue('--season') ?? SEASON_DEFAULT);
  const weekRaw = argValue('--week');
  const week = weekRaw != null ? Number(weekRaw) : undefined;
  if (!Number.isFinite(season)) {
    console.error('Invalid --season');
    process.exit(1);
  }
  if (week != null && !Number.isFinite(week)) {
    console.error('Invalid --week');
    process.exit(1);
  }
  run(season, week).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
