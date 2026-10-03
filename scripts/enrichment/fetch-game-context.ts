/**
 * Build travel / rest / weather / road-record context for survivor and TD streak.
 *
 *   npx tsx scripts/enrichment/fetch-game-context.ts
 */
import fs from 'fs/promises';
import path from 'path';

const OUT_DIR = path.resolve(__dirname, '../../data/enrichment');
const SEASON = 2026;
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

type Venue = {
  team: string;
  lat: number;
  lon: number;
  tz: string;
  roof: 'dome' | 'retractable' | 'outdoor';
  division: string;
};

type Forecast = { tempF?: number; windMph?: number; precipIn?: number; outdoor: boolean };

export type GameContextFile = {
  pulledAt: string;
  season: number;
  currentWeek: number;
  teams: Record<
    string,
    {
      roadWinPct?: number;
      roadGames?: number;
      qbName?: string;
      qbRoadWinPct?: number;
      qbBadWeather?: boolean;
    }
  >;
  forecasts: Record<string, Forecast>;
};

function canon(team: string): string {
  const key = team.toUpperCase().replace(/[^A-Z]/g, '');
  return TEAM_ALIASES[key] ?? key;
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
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function downloadText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

type NflGame = {
  season: number;
  week: number;
  home: string;
  away: string;
  homeScore?: number;
  awayScore?: number;
  temp?: number;
  wind?: number;
  roof?: string;
};

function rowsToGames(text: string): NflGame[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const idx = (...names: string[]) => {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const seasonIdx = idx('season');
  const weekIdx = idx('week');
  const typeIdx = idx('game_type', 'gametype');
  const homeIdx = idx('home_team', 'home');
  const awayIdx = idx('away_team', 'away');
  const hsIdx = idx('home_score');
  const asIdx = idx('away_score');
  const tempIdx = idx('temp');
  const windIdx = idx('wind');
  const roofIdx = idx('roof');
  if (seasonIdx < 0 || weekIdx < 0 || homeIdx < 0 || awayIdx < 0) return [];
  const out: NflGame[] = [];
  for (const row of table.slice(1)) {
    const type = typeIdx >= 0 ? row[typeIdx] : 'REG';
    if (type && type !== 'REG') continue;
    const home = canon(row[homeIdx] ?? '');
    const away = canon(row[awayIdx] ?? '');
    const season = Number(row[seasonIdx]);
    const week = Number(row[weekIdx]);
    if (!home || !away || !Number.isFinite(season) || !Number.isFinite(week)) continue;
    out.push({
      season,
      week,
      home,
      away,
      homeScore: hsIdx >= 0 ? Number(row[hsIdx]) : undefined,
      awayScore: asIdx >= 0 ? Number(row[asIdx]) : undefined,
      temp: tempIdx >= 0 ? Number(row[tempIdx]) : undefined,
      wind: windIdx >= 0 ? Number(row[windIdx]) : undefined,
      roof: roofIdx >= 0 ? row[roofIdx] : undefined,
    });
  }
  return out;
}

function teamRoadRecords(games: NflGame[]): Map<string, { wins: number; games: number }> {
  const out = new Map<string, { wins: number; games: number }>();
  const add = (team: string, win: boolean) => {
    const cur = out.get(team) ?? { wins: 0, games: 0 };
    cur.games += 1;
    if (win) cur.wins += 1;
    out.set(team, cur);
  };
  for (const g of games) {
    if (g.homeScore == null || g.awayScore == null || Number.isNaN(g.homeScore) || Number.isNaN(g.awayScore)) {
      continue;
    }
    add(g.away, g.awayScore > g.homeScore);
  }
  return out;
}

type QbWeek = { season: number; week: number; team: string; player: string; attempts: number };

function qbWeeksFromStats(text: string): QbWeek[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const nameIdx = idx('player_display_name') >= 0 ? idx('player_display_name') : idx('player_name');
  const posIdx = idx('position');
  const teamIdx = idx('recent_team') >= 0 ? idx('recent_team') : idx('team');
  const seasonIdx = idx('season');
  const weekIdx = idx('week');
  const attIdx = idx('attempts') >= 0 ? idx('attempts') : idx('passing_attempts');
  const typeIdx = idx('season_type');
  if (nameIdx < 0 || weekIdx < 0) return [];
  const out: QbWeek[] = [];
  for (const row of table.slice(1)) {
    if (typeIdx >= 0 && row[typeIdx] && row[typeIdx] !== 'REG') continue;
    const pos = (row[posIdx] ?? '').toUpperCase();
    if (pos && pos !== 'QB') continue;
    const attempts = Number(row[attIdx] ?? 0);
    if (!Number.isFinite(attempts) || attempts < 5) continue;
    const player = (row[nameIdx] ?? '').trim();
    const team = canon(row[teamIdx] ?? '');
    const season = Number(row[seasonIdx]);
    const week = Number(row[weekIdx]);
    if (!player || !team) continue;
    out.push({ season, week, team, player, attempts });
  }
  return out;
}

function starters(weeks: QbWeek[]): Map<string, string> {
  const best = new Map<string, QbWeek>();
  for (const row of weeks) {
    const key = `${row.season}:${row.week}:${row.team}`;
    const prev = best.get(key);
    if (!prev || row.attempts > prev.attempts) best.set(key, row);
  }
  const out = new Map<string, string>();
  for (const [key, row] of best) out.set(key, row.player);
  return out;
}

async function forecastForVenue(venue: Venue, date: string): Promise<Forecast> {
  const outdoor = venue.roof === 'outdoor';
  if (!outdoor) return { outdoor: false };
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${venue.lat}&longitude=${venue.lon}` +
    `&daily=temperature_2m_max,precipitation_sum,wind_speed_10m_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&start_date=${date}&end_date=${date}&timezone=${encodeURIComponent(venue.tz)}`;
  const res = await fetch(url);
  if (!res.ok) return { outdoor: true };
  const data = (await res.json()) as {
    daily?: { temperature_2m_max?: number[]; precipitation_sum?: number[]; wind_speed_10m_max?: number[] };
  };
  return {
    outdoor: true,
    tempF: data.daily?.temperature_2m_max?.[0],
    precipIn: data.daily?.precipitation_sum?.[0],
    windMph: data.daily?.wind_speed_10m_max?.[0],
  };
}

function kickoffDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

export async function run(season = SEASON): Promise<void> {
  const venues = JSON.parse(await fs.readFile(path.join(OUT_DIR, 'nfl-venues.json'), 'utf-8')) as Record<
    string,
    Venue
  >;
  let currentWeek = 2;
  try {
    const state = JSON.parse(await fs.readFile(path.join(OUT_DIR, 'season-state.json'), 'utf-8')) as {
      currentWeek?: number;
    };
    currentWeek = state.currentWeek ?? currentWeek;
  } catch {
    // default
  }

  const priorYears = [season - 2, season - 1, season];
  let games: NflGame[] = [];
  try {
    const urls = [
      'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv',
      'https://github.com/nflverse/nflverse-data/releases/download/games/games.csv',
    ];
    let text = '';
    for (const url of urls) {
      try {
        text = await downloadText(url);
        if (text.includes('home_team') || text.includes('home_score')) break;
      } catch {
        // try next
      }
    }
    games = rowsToGames(text).filter((g) => priorYears.includes(g.season));
    console.log(`  nflverse games: ${games.length}`);
  } catch (err) {
    console.warn(`  nflverse games unavailable: ${(err as Error).message}`);
  }

  const road = teamRoadRecords(games);
  let qbByGame = new Map<string, string>();
  try {
    const weeklyUrls = [
      `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season - 1}.csv`,
      `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`,
    ];
    const weeks: QbWeek[] = [];
    for (const url of weeklyUrls) {
      try {
        weeks.push(...qbWeeksFromStats(await downloadText(url)));
      } catch {
        // optional
      }
    }
    qbByGame = starters(weeks);
    console.log(`  QB week rows: ${weeks.length}`);
  } catch (err) {
    console.warn(`  QB splits unavailable: ${(err as Error).message}`);
  }

  const qbRoad = new Map<string, { wins: number; games: number }>();
  const qbWeather = new Map<string, { bad: number; games: number }>();

  for (const g of games) {
    if (g.awayScore == null || g.homeScore == null) continue;
    const awayQb = qbByGame.get(`${g.season}:${g.week}:${g.away}`);
    if (awayQb) {
      const win = g.awayScore > g.homeScore;
      const prev = qbRoad.get(awayQb) ?? { wins: 0, games: 0 };
      prev.games += 1;
      if (win) prev.wins += 1;
      qbRoad.set(awayQb, prev);
      const outdoor = !g.roof || /outdoors|open/i.test(g.roof);
      const nasty = outdoor && ((g.wind != null && g.wind >= 15) || (g.temp != null && g.temp <= 32));
      if (nasty) {
        const w = qbWeather.get(awayQb) ?? { bad: 0, games: 0 };
        w.games += 1;
        if (!win) w.bad += 1;
        qbWeather.set(awayQb, w);
      }
    }
  }

  const teams: GameContextFile['teams'] = {};
  for (const team of Object.keys(venues)) {
    const rec = road.get(team);
    teams[team] = {
      roadWinPct: rec && rec.games >= 4 ? rec.wins / rec.games : undefined,
      roadGames: rec?.games,
    };
  }

  const latestQb = new Map<string, { name: string; season: number; week: number }>();
  for (const [key, name] of qbByGame) {
    const [seasonStr, weekStr, team] = key.split(':');
    const s = Number(seasonStr);
    const w = Number(weekStr);
    const prev = latestQb.get(team);
    if (!prev || s > prev.season || (s === prev.season && w > prev.week)) {
      latestQb.set(team, { name, season: s, week: w });
    }
  }
  for (const [team, qb] of latestQb) {
    const rec = qbRoad.get(qb.name);
    const weather = qbWeather.get(qb.name);
    const row = teams[team] ?? {};
    row.qbName = qb.name;
    row.qbRoadWinPct = rec && rec.games >= 4 ? rec.wins / rec.games : undefined;
    row.qbBadWeather = weather != null && weather.games >= 3 && weather.bad / weather.games >= 0.6;
    teams[team] = row;
  }

  const forecasts: Record<string, Forecast> = {};
  try {
    const sched = await fs.readFile(path.join(OUT_DIR, `nfl-schedule-${season}.csv`), 'utf-8');
    const table = parseCsv(sched);
    const headers = table[0].map((h) => h.trim().toLowerCase());
    const teamIdx = headers.indexOf('team');
    const weekIdx = headers.indexOf('week');
    const homeIdx = headers.indexOf('home');
    const kickIdx = headers.indexOf('kickoff');
    const oppIdx = headers.indexOf('opponent');
    for (const row of table.slice(1)) {
      const week = Number(row[weekIdx]);
      if (week !== currentWeek) continue;
      if (row[homeIdx] !== '1') continue;
      const team = canon(row[teamIdx] ?? '');
      const opp = canon(row[oppIdx] ?? '');
      const venue = venues[team];
      if (!venue || !team || opp === 'BYE') continue;
      const date = kickoffDate(row[kickIdx]);
      if (!date) continue;
      const forecast = await forecastForVenue(venue, date);
      forecasts[`${week}:${team}`] = forecast;
      forecasts[`${week}:${opp}`] = forecast;
    }
    console.log(`  forecasts: ${Object.keys(forecasts).length / 2} games`);
  } catch (err) {
    console.warn(`  forecast skip: ${(err as Error).message}`);
  }

  const payload: GameContextFile = {
    pulledAt: new Date().toISOString(),
    season,
    currentWeek,
    teams,
    forecasts,
  };
  await fs.writeFile(path.join(OUT_DIR, `game-context-${season}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`Wrote game-context-${season}.json`);
}

const invokedDirectly = /fetch-game-context/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  run(SEASON).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
