/**
 * Pull the NFL regular-season schedule (kickoff + status) and opponent
 * strength stats for the prior year and the current through-week season.
 *
 *   npx tsx scripts/enrichment/fetch-sos-schedule.ts
 *   npm run enrichment:fetch-sos-schedule
 */
import fs from 'fs/promises';
import path from 'path';

const OUT_DIR = path.resolve(__dirname, '../../data/enrichment');
const SEASON = 2026;
const PRIOR_SEASON = 2025;
const WEEKS = 18;

const TEAM_ALIASES: Record<string, string> = {
  LAR: 'LA',
  STL: 'LA',
  JAC: 'JAX',
  WSH: 'WAS',
  GBP: 'GB',
  GNB: 'GB',
  SFO: 'SF',
  TAM: 'TB',
  NWE: 'NE',
  NOR: 'NO',
  KAN: 'KC',
  LVR: 'LV',
  OAK: 'LV',
  ARZ: 'ARI',
};

export type GameStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';

export type ScheduleRow = {
  team: string;
  week: number;
  opponent: string;
  home: 0 | 1;
  kickoff?: string;
  status?: GameStatus;
  teamScore?: number;
  oppScore?: number;
};

type DefStats = { team: string; pa: number; oppPass: number; oppRush: number };
type OffStats = { team: string; pointsFor: number };

function canon(team: string): string {
  const key = team.toUpperCase().replace(/[^A-Z]/g, '');
  return TEAM_ALIASES[key] ?? key;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function rankDesc(rows: Array<{ team: string; value: number }>): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.team.localeCompare(b.team));
  const out = new Map<string, number>();
  sorted.forEach((row, i) => out.set(row.team, i + 1));
  return out;
}

function rankAsc(rows: Array<{ team: string; value: number }>): Map<string, number> {
  const sorted = [...rows].sort((a, b) => a.value - b.value || a.team.localeCompare(b.team));
  const out = new Map<string, number>();
  sorted.forEach((row, i) => out.set(row.team, i + 1));
  return out;
}

function gameStatus(name?: string, completed?: boolean): GameStatus {
  if (completed || /final/i.test(name ?? '')) return 'FINAL';
  if (/progress|halftime|end_period|delayed|end of/i.test(name ?? '')) return 'IN_PROGRESS';
  return 'SCHEDULED';
}

export function seasonStateFromGames(games: ScheduleRow[]): {
  completedWeeks: number;
  currentWeek: number;
} {
  let completedWeeks = 0;
  let currentWeek = 1;
  for (let week = 1; week <= WEEKS; week++) {
    const homeGames = games.filter((g) => g.week === week && g.opponent !== 'BYE' && g.home === 1);
    if (homeGames.length === 0) continue;
    const allFinal = homeGames.every((g) => g.status === 'FINAL');
    const anyStarted = homeGames.some((g) => g.status === 'FINAL' || g.status === 'IN_PROGRESS');
    if (allFinal) {
      completedWeeks = week;
      currentWeek = Math.min(WEEKS, week + 1);
    } else if (anyStarted) {
      currentWeek = week;
      break;
    } else {
      currentWeek = week;
      break;
    }
  }
  return { completedWeeks, currentWeek };
}

async function fetchSchedule(season: number): Promise<ScheduleRow[]> {
  const games: ScheduleRow[] = [];
  for (let week = 1; week <= WEEKS; week++) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
    const data = (await getJson(url)) as {
      events?: Array<{
        date?: string;
        status?: { type?: { name?: string; completed?: boolean } };
        competitions?: Array<{
          date?: string;
          status?: { type?: { name?: string; completed?: boolean } };
          competitors?: Array<{
            homeAway?: string;
            score?: string;
            team?: { abbreviation?: string };
          }>;
        }>;
      }>;
    };
    for (const event of data.events ?? []) {
      const comp = event.competitions?.[0];
      const comps = comp?.competitors ?? [];
      const home = comps.find((c) => c.homeAway === 'home');
      const away = comps.find((c) => c.homeAway === 'away');
      const homeAbbr = home?.team?.abbreviation;
      const awayAbbr = away?.team?.abbreviation;
      if (!homeAbbr || !awayAbbr) continue;
      const h = canon(homeAbbr);
      const a = canon(awayAbbr);
      const status = gameStatus(
        comp?.status?.type?.name ?? event.status?.type?.name,
        comp?.status?.type?.completed ?? event.status?.type?.completed
      );
      const kickoff = comp?.date ?? event.date;
      const homeScore = home?.score != null && home.score !== '' ? Number(home.score) : undefined;
      const awayScore = away?.score != null && away.score !== '' ? Number(away.score) : undefined;
      games.push({
        team: h,
        week,
        opponent: a,
        home: 1,
        kickoff,
        status,
        teamScore: Number.isFinite(homeScore) ? homeScore : undefined,
        oppScore: Number.isFinite(awayScore) ? awayScore : undefined,
      });
      games.push({
        team: a,
        week,
        opponent: h,
        home: 0,
        kickoff,
        status,
        teamScore: Number.isFinite(awayScore) ? awayScore : undefined,
        oppScore: Number.isFinite(homeScore) ? homeScore : undefined,
      });
    }
  }
  return games;
}

async function fetchSeasonStats(season: number): Promise<{ defense: DefStats[]; offense: OffStats[] }> {
  const standings = (await getJson(
    `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}`
  )) as {
    children?: Array<{
      standings?: {
        entries?: Array<{
          team?: { abbreviation?: string };
          stats?: Array<{ name?: string; value?: number }>;
        }>;
      };
    }>;
  };
  const pa = new Map<string, number>();
  const pf = new Map<string, number>();
  for (const conf of standings.children ?? []) {
    for (const entry of conf.standings?.entries ?? []) {
      const team = entry.team?.abbreviation;
      if (!team) continue;
      const key = canon(team);
      const against = entry.stats?.find((s) => s.name === 'pointsAgainst')?.value;
      const scored = entry.stats?.find((s) => s.name === 'pointsFor')?.value;
      if (against != null) pa.set(key, against);
      if (scored != null) pf.set(key, scored);
    }
  }

  const pass = new Map<string, number>();
  const rush = new Map<string, number>();
  try {
    const byteam = (await getJson(
      `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byteam?region=us&lang=en&contentorigin=espn&limit=32&season=${season}&seasontype=2`
    )) as {
      teams?: Array<{
        team?: { abbreviation?: string };
        categories?: Array<{ name?: string; splitId?: string; values?: number[] }>;
      }>;
    };
    for (const row of byteam.teams ?? []) {
      const team = row.team?.abbreviation;
      if (!team) continue;
      const key = canon(team);
      const oppPass = row.categories?.find((c) => c.name === 'passing' && c.splitId === '900');
      const oppRush = row.categories?.find((c) => c.name === 'rushing' && c.splitId === '900');
      if (oppPass?.values?.[0] != null) pass.set(key, oppPass.values[0]);
      if (oppRush?.values?.[0] != null) rush.set(key, oppRush.values[0]);
    }
  } catch (err) {
    console.warn(`  byteam stats ${season} unavailable: ${(err as Error).message}`);
  }

  const teams = [...new Set([...pa.keys(), ...pf.keys(), ...pass.keys(), ...rush.keys()])].sort();
  return {
    defense: teams
      .filter((team) => pa.has(team) || pass.has(team) || rush.has(team))
      .map((team) => ({
        team,
        pa: pa.get(team) ?? pass.get(team) ?? 0,
        oppPass: pass.get(team) ?? pa.get(team) ?? 0,
        oppRush: rush.get(team) ?? pa.get(team) ?? 0,
      })),
    offense: teams
      .filter((team) => pf.has(team))
      .map((team) => ({
        team,
        pointsFor: pf.get(team) ?? 0,
      })),
  };
}

function defenseRanksCsv(defense: DefStats[]): string {
  const overall = rankDesc(defense.map((d) => ({ team: d.team, value: d.pa })));
  const qb = rankDesc(defense.map((d) => ({ team: d.team, value: d.oppPass })));
  const rb = rankDesc(defense.map((d) => ({ team: d.team, value: d.oppRush })));
  const teams = [...new Set(defense.map((d) => d.team))].sort();
  return [
    'team,overall,qb,rb,wr,te',
    ...teams.map((team) => {
      const o = overall.get(team) ?? 16;
      const q = qb.get(team) ?? o;
      const r = rb.get(team) ?? o;
      return `${team},${o},${q},${r},${q},${q}`;
    }),
  ].join('\n');
}

function offenseRanksCsv(offense: OffStats[]): string {
  const scored = rankAsc(offense.map((o) => ({ team: o.team, value: o.pointsFor })));
  return [
    'team,overall',
    ...offense
      .map((o) => o.team)
      .sort()
      .map((team) => `${team},${scored.get(team) ?? 16}`),
  ].join('\n');
}

async function writeSeasonStats(season: number, stats: { defense: DefStats[]; offense: OffStats[] }): Promise<void> {
  const defStats = [
    'team,pa,oppPass,oppRush',
    ...stats.defense.map((d) => `${d.team},${d.pa},${d.oppPass},${d.oppRush}`),
  ].join('\n');
  const offStats = ['team,pointsFor', ...stats.offense.map((o) => `${o.team},${o.pointsFor}`)].join('\n');
  await fs.writeFile(path.join(OUT_DIR, `defense-stats-${season}.csv`), `${defStats}\n`, 'utf-8');
  await fs.writeFile(path.join(OUT_DIR, `offense-stats-${season}.csv`), `${offStats}\n`, 'utf-8');
  await fs.writeFile(path.join(OUT_DIR, `defense-ranks-${season}.csv`), `${defenseRanksCsv(stats.defense)}\n`, 'utf-8');
  await fs.writeFile(path.join(OUT_DIR, `offense-ranks-${season}.csv`), `${offenseRanksCsv(stats.offense)}\n`, 'utf-8');
}

export async function run(season = SEASON): Promise<{ completedWeeks: number; currentWeek: number }> {
  const priorSeason = season - 1;
  const [games, priorStats, currentStats] = await Promise.all([
    fetchSchedule(season),
    fetchSeasonStats(priorSeason),
    fetchSeasonStats(season).catch((err) => {
      console.warn(`  ${season} through-week stats unavailable: ${(err as Error).message}`);
      return { defense: [] as DefStats[], offense: [] as OffStats[] };
    }),
  ]);

  const teams = [...new Set(games.map((g) => g.team))].sort();
  const played = new Set(games.map((g) => `${g.team}:${g.week}`));
  const rows = [...games];
  for (const team of teams) {
    for (let week = 1; week <= WEEKS; week++) {
      if (!played.has(`${team}:${week}`)) {
        rows.push({ team, week, opponent: 'BYE', home: 0, status: 'FINAL' });
      }
    }
  }
  rows.sort((a, b) => a.team.localeCompare(b.team) || a.week - b.week);

  const schedCsv = [
    'team,week,opponent,home,kickoff,status,teamScore,oppScore',
    ...rows.map((r) =>
      [
        r.team,
        r.week,
        r.opponent,
        r.opponent === 'BYE' ? '' : r.home,
        r.kickoff ?? '',
        r.opponent === 'BYE' ? '' : (r.status ?? ''),
        r.teamScore ?? '',
        r.oppScore ?? '',
      ].join(',')
    ),
  ].join('\n');
  await fs.writeFile(path.join(OUT_DIR, `nfl-schedule-${season}.csv`), `${schedCsv}\n`, 'utf-8');

  await writeSeasonStats(priorSeason, priorStats);
  if (currentStats.defense.length >= 16) {
    await writeSeasonStats(season, currentStats);
  }

  const { completedWeeks, currentWeek } = seasonStateFromGames(rows);
  const state = {
    season,
    completedWeeks,
    currentWeek,
    asOf: new Date().toISOString(),
  };
  await fs.writeFile(path.join(OUT_DIR, 'season-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  console.log(
    `Wrote ${rows.length} schedule rows, prior ${priorSeason} D/O stats (${priorStats.defense.length}), ` +
      `${season} through-week D/O stats (${currentStats.defense.length}). ` +
      `completedWeeks=${completedWeeks} currentWeek=${currentWeek}`
  );
  return { completedWeeks, currentWeek };
}

const invokedDirectly = /fetch-sos-schedule/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  run(SEASON).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
