/**
 * Pull ESPN weekly proj / score / last / %Rost for the My Team roster and write
 *   data/enrichment/espn-week-scoring-{season}.json
 *
 * Needs ESPN_S2 + ESPN_SWID and league/team from data/my-team/{season}.json
 * (or ESPN_LEAGUE_ID / ESPN_TEAM_ID).
 *
 *   npx tsx scripts/enrichment/fetch-espn-week-scoring.ts
 *   npx tsx scripts/enrichment/fetch-espn-week-scoring.ts --season 2026 --week 4
 */
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { EspnLeagueError, type EspnAuth } from '../../server/src/services/espnLeague';
import {
  fetchEspnWeekScoring,
  type EspnWeekScoringFile,
} from '../../server/src/services/espnWeekScoring';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ROOT = path.resolve(__dirname, '../..');
const SEASON_DEFAULT = 2026;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function readSeasonState(): Promise<{ currentWeek: number }> {
  const raw = await fs.readFile(
    path.join(ROOT, 'data/enrichment/season-state.json'),
    'utf-8'
  );
  const data = JSON.parse(raw) as { currentWeek?: number };
  if (!Number.isFinite(data.currentWeek) || data.currentWeek == null) {
    throw new Error('season-state.json missing currentWeek');
  }
  return { currentWeek: data.currentWeek };
}

async function resolveTeamIds(season: number): Promise<{ leagueId: number; teamId?: number }> {
  const leagueEnv = Number(process.env.ESPN_LEAGUE_ID);
  const teamEnv = Number(process.env.ESPN_TEAM_ID);
  let leagueId = Number.isFinite(leagueEnv) && leagueEnv > 0 ? leagueEnv : 0;
  let teamId =
    Number.isFinite(teamEnv) && teamEnv > 0 ? teamEnv : undefined;
  try {
    const raw = await fs.readFile(path.join(ROOT, `data/my-team/${season}.json`), 'utf-8');
    const team = JSON.parse(raw) as { leagueId?: number; teamId?: number };
    if (!leagueId && Number.isFinite(team.leagueId) && team.leagueId! > 0) {
      leagueId = team.leagueId!;
    }
    if (teamId == null && Number.isFinite(team.teamId) && team.teamId! > 0) {
      teamId = team.teamId;
    }
  } catch {
    /* no my-team snapshot */
  }
  if (!leagueId) {
    throw new Error(
      'No league id: set ESPN_LEAGUE_ID or import My Team (data/my-team/{season}.json).'
    );
  }
  return { leagueId, teamId };
}

async function resolveAuth(): Promise<EspnAuth> {
  const fromEnv: EspnAuth = {
    espnS2: process.env.ESPN_S2?.trim() ?? '',
    swid: process.env.ESPN_SWID?.trim() ?? '',
  };
  if (fromEnv.espnS2 && fromEnv.swid) return fromEnv;
  try {
    const raw = await fs.readFile(path.join(ROOT, 'data/secrets/espn-auth.json'), 'utf-8');
    const data = JSON.parse(raw) as Partial<EspnAuth>;
    if (data.espnS2?.trim() && data.swid?.trim()) {
      return { espnS2: data.espnS2.trim(), swid: data.swid.trim() };
    }
  } catch {
    /* no secrets file */
  }
  throw new EspnLeagueError(
    'ESPN cookies required: set ESPN_S2 / ESPN_SWID in .env (or GitHub secrets).',
    401
  );
}

export async function run(season = SEASON_DEFAULT, week?: number): Promise<void> {
  const scoringPeriodId = week ?? (await readSeasonState()).currentWeek;
  const { leagueId, teamId } = await resolveTeamIds(season);
  const auth = await resolveAuth();

  console.log(
    `   Fetching ESPN week scoring league=${leagueId} team=${teamId ?? 'all'} season=${season} week=${scoringPeriodId}`
  );
  const byId = await fetchEspnWeekScoring(leagueId, season, auth, scoringPeriodId, teamId);
  const players = [...byId.values()].sort((a, b) => a.espnId - b.espnId);
  const payload: EspnWeekScoringFile = {
    season,
    scoringPeriodId,
    leagueId,
    teamId,
    fetchedAt: new Date().toISOString(),
    players,
  };
  const outPath = path.join(ROOT, 'data/enrichment', `espn-week-scoring-${season}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  const withProj = players.filter((p) => p.projectedPoints != null).length;
  const withScore = players.filter((p) => p.weekScore != null).length;
  const withRost = players.filter((p) => p.percentOwned != null).length;
  console.log(
    `   Wrote ${outPath} (${players.length} players, ${withProj} proj, ${withScore} scores, ${withRost} %Rost)`
  );
}

const invokedDirectly = /fetch-espn-week-scoring/.test(
  (process.argv[1] ?? '').replace(/\\/g, '/')
);
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
