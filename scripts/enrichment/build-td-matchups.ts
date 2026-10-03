/**
 * Anytime-TD and vs-position defense tables from nflverse weekly player stats.
 *
 *   npm run enrichment:build-td-matchups
 *   npm run enrichment:build-td-matchups -- --season 2026
 *
 * Writes:
 *   data/enrichment/td-player.csv            (prior + current season aggregates)
 *   data/enrichment/td-defense-by-pos.csv    (prior + current season)
 *   data/enrichment/td-player-games.csv      (up to 5 seasons of player-week TDs + home)
 */
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const OUT_DIR = path.resolve(__dirname, '../../data/enrichment');
const CACHE_DIR = path.resolve(__dirname, '../../.cache/nflverse');
const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'FB']);
const TEAM_ALIASES: Record<string, string> = {
  LAR: 'LA',
  STL: 'LA',
  JAC: 'JAX',
  WSH: 'WAS',
  WAS: 'WAS',
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
  SD: 'LAC',
};

type SkillPos = 'QB' | 'RB' | 'WR' | 'TE';

function canon(team?: string): string | undefined {
  if (!team) return undefined;
  const key = team.toUpperCase().replace(/[^A-Z]/g, '');
  if (!key) return undefined;
  return TEAM_ALIASES[key] ?? key;
}

function asPos(raw: string): SkillPos | undefined {
  const p = (raw || '').toUpperCase().trim();
  if (p === 'FB') return 'RB';
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE') return p;
  return undefined;
}

function parseArgs(argv: string[]): { season: number } {
  const idx = argv.indexOf('--season');
  const season = idx >= 0 ? parseInt(argv[idx + 1], 10) : 2026;
  return { season: Number.isFinite(season) ? season : 2026 };
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
    } else if (ch === '\r') {
      // ignore
    } else {
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

async function downloadCsv(url: string, cachePath: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error(`No body for ${url}`);
  const fileStream = createWriteStream(cachePath);
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), fileStream);
  return fs.readFile(cachePath, 'utf-8');
}

async function downloadWeekly(year: number): Promise<string> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `player_stats_week_${year}.csv`);
  const refresh = year >= new Date().getFullYear();
  if (!refresh) {
    try {
      const existing = await fs.readFile(cachePath, 'utf-8');
      if (looksWeekly(existing)) {
        console.log(`  using cached ${path.basename(cachePath)}`);
        return existing;
      }
    } catch {
      // download
    }
  }
  const urls = [
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${year}.csv`,
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`,
  ];
  let lastError: Error | null = null;
  for (const url of urls) {
    console.log(`Downloading weekly ${year} (${url.split('/').pop()})...`);
    try {
      const text = await downloadCsv(url, cachePath);
      if (!looksWeekly(text)) throw new Error('not a weekly file');
      return text;
    } catch (err) {
      lastError = err as Error;
    }
  }
  try {
    const existing = await fs.readFile(cachePath, 'utf-8');
    if (looksWeekly(existing)) {
      console.log(`  using cached ${path.basename(cachePath)}`);
      return existing;
    }
  } catch {
    // none
  }
  throw lastError ?? new Error(`No nflverse weekly stats for ${year}`);
}

function looksSchedule(text: string): boolean {
  const header = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  return header.includes('home_team') && header.includes('away_team') && header.includes('week');
}

/** season::week::team → player was designated home. */
async function downloadHomeMap(): Promise<Map<string, boolean>> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, 'schedules.csv');
  let text: string | undefined;
  try {
    const existing = await fs.readFile(cachePath, 'utf-8');
    if (looksSchedule(existing)) {
      console.log(`  using cached ${path.basename(cachePath)}`);
      text = existing;
    }
  } catch {
    // download
  }
  if (!text) {
    const urls = [
      'https://github.com/nflverse/nflverse-data/releases/download/schedules/schedules.csv',
      'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',
    ];
    let lastError: Error | null = null;
    for (const url of urls) {
      console.log(`Downloading schedules (${url.split('/').pop()})...`);
      try {
        const downloaded = await downloadCsv(url, cachePath);
        if (!looksSchedule(downloaded)) throw new Error('not a schedule file');
        text = downloaded;
        break;
      } catch (err) {
        lastError = err as Error;
      }
    }
    if (!text) {
      console.warn(`  schedules skipped: ${lastError?.message ?? 'download failed'}`);
      return new Map();
    }
  }
  return homeMapFromCsv(text);
}

function homeMapFromCsv(text: string): Map<string, boolean> {
  const table = parseCsv(text);
  if (table.length < 2) return new Map();
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const seasonIdx = idx('season');
  const weekIdx = idx('week');
  const homeIdx = idx('home_team');
  const awayIdx = idx('away_team');
  const typeIdx = idx('game_type');
  if (seasonIdx < 0 || weekIdx < 0 || homeIdx < 0 || awayIdx < 0) return new Map();
  const out = new Map<string, boolean>();
  for (const row of table.slice(1)) {
    const gameType = typeIdx >= 0 ? (row[typeIdx] ?? 'REG').toUpperCase() : 'REG';
    if (gameType && gameType !== 'REG') continue;
    const season = parseInt(row[seasonIdx] ?? '', 10);
    const week = parseInt(row[weekIdx] ?? '', 10);
    const home = canon(row[homeIdx]);
    const away = canon(row[awayIdx]);
    if (!Number.isFinite(season) || !Number.isFinite(week) || !home || !away) continue;
    out.set(`${season}::${week}::${home}`, true);
    out.set(`${season}::${week}::${away}`, false);
  }
  return out;
}

function homeFromGameId(gameId: string | undefined, team: string): boolean | undefined {
  if (!gameId) return undefined;
  const parts = gameId.split('_');
  if (parts.length < 4) return undefined;
  const away = canon(parts[parts.length - 2]);
  const home = canon(parts[parts.length - 1]);
  if (team === home) return true;
  if (team === away) return false;
  return undefined;
}

function looksWeekly(text: string): boolean {
  const header = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  return header.includes('week') && (header.includes('opponent_team') || header.includes('opponent'));
}

type WeekRow = {
  playerName: string;
  season: number;
  week: number;
  position: SkillPos;
  team: string;
  opp: string;
  tds: number;
  yds: number;
  rushAtt: number;
  rushYds: number;
  rec: number;
  recYds: number;
  targets: number;
  home?: boolean;
};

function weeksFromCsv(text: string, year: number, homeMap: Map<string, boolean>): WeekRow[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const nameIdx = idx('player_display_name') >= 0 ? idx('player_display_name') : idx('player_name');
  const posIdx = idx('position');
  const teamIdx = idx('recent_team') >= 0 ? idx('recent_team') : idx('team');
  const oppIdx = idx('opponent_team') >= 0 ? idx('opponent_team') : idx('opponent');
  const seasonIdx = idx('season');
  const weekIdx = idx('week');
  const seasonTypeIdx = idx('season_type');
  const rushTdIdx = idx('rushing_tds');
  const recTdIdx = idx('receiving_tds');
  const rushYdIdx = idx('rushing_yards');
  const recYdIdx = idx('receiving_yards');
  const rushAttIdx = idx('rushing_attempts') >= 0 ? idx('rushing_attempts') : idx('carries');
  const recIdx = idx('receptions');
  const tgtIdx = idx('targets');
  const gameIdIdx = idx('game_id');
  if (nameIdx < 0 || weekIdx < 0 || oppIdx < 0) return [];

  const out: WeekRow[] = [];
  for (const row of table.slice(1)) {
    if (!row.length || row.every((c) => !c)) continue;
    const seasonType = seasonTypeIdx >= 0 ? row[seasonTypeIdx] : 'REG';
    if (seasonType && seasonType !== 'REG') continue;
    const season = seasonIdx >= 0 ? parseInt(row[seasonIdx], 10) : year;
    if (season !== year) continue;
    const week = parseInt(row[weekIdx] ?? '', 10);
    if (!Number.isFinite(week) || week < 1 || week > 18) continue;
    const rawPos = row[posIdx] ?? '';
    if (!SKILL.has(rawPos.toUpperCase()) && !SKILL.has(asPos(rawPos) ?? '')) continue;
    const position = asPos(rawPos);
    const playerName = (row[nameIdx] ?? '').trim();
    const team = canon(row[teamIdx]);
    const opp = canon(row[oppIdx]);
    if (!position || !playerName || !team || !opp) continue;
    const rushTd = parseFloat(row[rushTdIdx] ?? '0') || 0;
    const recTd = parseFloat(row[recTdIdx] ?? '0') || 0;
    const rushYd = parseFloat(row[rushYdIdx] ?? '0') || 0;
    const recYd = parseFloat(row[recYdIdx] ?? '0') || 0;
    const rushAtt = parseFloat(row[rushAttIdx] ?? '0') || 0;
    const rec = parseFloat(row[recIdx] ?? '0') || 0;
    const targets = parseFloat(row[tgtIdx] ?? '0') || 0;
    const tds = rushTd + recTd;
    const yds = position === 'QB' ? rushYd : rushYd + recYd;
    const home =
      homeFromGameId(gameIdIdx >= 0 ? row[gameIdIdx] : undefined, team) ??
      homeMap.get(`${season}::${week}::${team}`);
    out.push({
      playerName,
      season,
      week,
      position,
      team,
      opp,
      tds,
      yds,
      rushAtt,
      rushYds: rushYd,
      rec,
      recYds: recYd,
      targets,
      home,
    });
  }
  return out;
}

type PlayerAgg = {
  playerName: string;
  season: number;
  position: SkillPos;
  team: string;
  games: number;
  tds: number;
  yds: number;
  hitGames: number;
  teamTds: number;
  posTds: number;
  weeks: Map<number, number>;
};

type DefAgg = {
  team: string;
  season: number;
  position: SkillPos;
  games: Set<number>;
  yds: number;
  tds: number;
  lastWeek: number;
  lastYds: number;
  lastTds: number;
  lastOpp: string;
};

function aggregate(rows: WeekRow[], year: number): { players: PlayerAgg[]; defense: DefAgg[] } {
  const players = new Map<string, PlayerAgg>();
  const teamWeekTds = new Map<string, number>();
  const teamWeekPosTds = new Map<string, number>();
  const defWeek = new Map<string, { yds: number; tds: number; opp: string }>();

  for (const r of rows) {
    const pKey = `${year}::${r.playerName.toLowerCase()}`;
    const prev = players.get(pKey);
    if (!prev) {
      players.set(pKey, {
        playerName: r.playerName,
        season: year,
        position: r.position,
        team: r.team,
        games: 1,
        tds: r.tds,
        yds: r.yds,
        hitGames: r.tds > 0 ? 1 : 0,
        teamTds: 0,
        posTds: 0,
        weeks: new Map([[r.week, r.tds]]),
      });
    } else {
      prev.team = r.team;
      prev.position = r.position;
      if (!prev.weeks.has(r.week)) prev.games += 1;
      prev.weeks.set(r.week, (prev.weeks.get(r.week) ?? 0) + r.tds);
      prev.tds += r.tds;
      prev.yds += r.yds;
      prev.hitGames = [...prev.weeks.values()].filter((n) => n > 0).length;
    }
    const teamKey = `${r.team}::${r.week}`;
    teamWeekTds.set(teamKey, (teamWeekTds.get(teamKey) ?? 0) + r.tds);
    const posKey = `${r.team}::${r.position}::${r.week}`;
    teamWeekPosTds.set(posKey, (teamWeekPosTds.get(posKey) ?? 0) + r.tds);

    const dKey = `${r.opp}::${r.position}::${r.week}`;
    const dPrev = defWeek.get(dKey) ?? { yds: 0, tds: 0, opp: r.team };
    dPrev.yds += r.yds;
    dPrev.tds += r.tds;
    dPrev.opp = r.team;
    defWeek.set(dKey, dPrev);
  }

  for (const p of players.values()) {
    let teamTds = 0;
    let posTds = 0;
    for (const week of p.weeks.keys()) {
      teamTds += teamWeekTds.get(`${p.team}::${week}`) ?? 0;
      posTds += teamWeekPosTds.get(`${p.team}::${p.position}::${week}`) ?? 0;
    }
    p.teamTds = teamTds;
    p.posTds = posTds;
  }

  const defense = new Map<string, DefAgg>();
  for (const [key, stats] of defWeek) {
    const [team, position, weekStr] = key.split('::');
    const week = Number(weekStr);
    const pos = position as SkillPos;
    const dKey = `${team}::${pos}`;
    const prev = defense.get(dKey);
    if (!prev) {
      defense.set(dKey, {
        team,
        season: year,
        position: pos,
        games: new Set([week]),
        yds: stats.yds,
        tds: stats.tds,
        lastWeek: week,
        lastYds: stats.yds,
        lastTds: stats.tds,
        lastOpp: stats.opp,
      });
    } else {
      prev.games.add(week);
      prev.yds += stats.yds;
      prev.tds += stats.tds;
      if (week >= prev.lastWeek) {
        prev.lastWeek = week;
        prev.lastYds = stats.yds;
        prev.lastTds = stats.tds;
        prev.lastOpp = stats.opp;
      }
    }
  }

  return { players: [...players.values()], defense: [...defense.values()] };
}

function encodeWeeks(weeks: Map<number, number>): string {
  return [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, tds]) => `${week}:${tds}`)
    .join('|');
}

export async function run(seasonArg?: number): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const season = seasonArg ?? parsed.season;
  const historyYears: number[] = [];
  for (let year = season - 4; year <= season; year++) historyYears.push(year);
  const blendYears = new Set([season - 1, season]);
  const playerRows: PlayerAgg[] = [];
  const defRows: DefAgg[] = [];
  const gameRows: WeekRow[] = [];
  const homeMap = await downloadHomeMap();
  console.log(`  home map: ${homeMap.size} team-weeks`);

  for (const year of historyYears) {
    try {
      const text = await downloadWeekly(year);
      const weeks = weeksFromCsv(text, year, homeMap);
      if (weeks.length === 0) throw new Error('parsed 0 weekly rows');
      gameRows.push(...weeks);
      console.log(`  ${year}: ${weeks.length} player-week lines`);
      if (!blendYears.has(year)) continue;
      const { players, defense } = aggregate(weeks, year);
      console.log(`    aggregates: ${players.length} players, ${defense.length} team-pos defense rows`);
      playerRows.push(...players);
      defRows.push(...defense);
    } catch (err) {
      console.warn(`  ${year} skipped: ${(err as Error).message}`);
    }
  }

  const playerCsv = [
    'playerName,season,position,nflTeam,games,tds,yds,hitGames,teamTds,posTds,weeks',
    ...playerRows
      .sort((a, b) => a.season - b.season || b.tds - a.tds || a.playerName.localeCompare(b.playerName))
      .map((p) =>
        [
          csvEscape(p.playerName),
          p.season,
          p.position,
          p.team,
          p.games,
          Math.round(p.tds * 10) / 10,
          Math.round(p.yds * 10) / 10,
          p.hitGames,
          Math.round(p.teamTds * 10) / 10,
          Math.round(p.posTds * 10) / 10,
          encodeWeeks(p.weeks),
        ].join(','),
      ),
  ].join('\n');

  const defCsv = [
    'season,team,position,games,yds,tds,lastWeek,lastYds,lastTds,lastOpp',
    ...defRows
      .sort((a, b) => a.season - b.season || a.position.localeCompare(b.position) || a.team.localeCompare(b.team))
      .map((d) =>
        [
          d.season,
          d.team,
          d.position,
          d.games.size,
          Math.round(d.yds * 10) / 10,
          Math.round(d.tds * 10) / 10,
          d.lastWeek,
          Math.round(d.lastYds * 10) / 10,
          Math.round(d.lastTds * 10) / 10,
          d.lastOpp,
        ].join(','),
      ),
  ].join('\n');

  const gameCsv = [
    'playerName,season,week,position,nflTeam,opp,tds,rushAtt,rushYds,rec,recYds,targets,home',
    ...gameRows
      .sort(
        (a, b) =>
          a.season - b.season ||
          a.week - b.week ||
          a.playerName.localeCompare(b.playerName),
      )
      .map((g) =>
        [
          csvEscape(g.playerName),
          g.season,
          g.week,
          g.position,
          g.team,
          g.opp,
          Math.round(g.tds * 10) / 10,
          Math.round(g.rushAtt * 10) / 10,
          Math.round(g.rushYds * 10) / 10,
          Math.round(g.rec * 10) / 10,
          Math.round(g.recYds * 10) / 10,
          Math.round(g.targets * 10) / 10,
          g.home == null ? '' : g.home ? 1 : 0,
        ].join(','),
      ),
  ].join('\n');

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'td-player.csv'), `${playerCsv}\n`, 'utf-8');
  await fs.writeFile(path.join(OUT_DIR, 'td-defense-by-pos.csv'), `${defCsv}\n`, 'utf-8');
  await fs.writeFile(path.join(OUT_DIR, 'td-player-games.csv'), `${gameCsv}\n`, 'utf-8');
  console.log(
    `Wrote ${playerRows.length} player rows, ${defRows.length} defense rows, ${gameRows.length} player-week games (${historyYears[0]}–${season})`,
  );
}

const invoked = process.argv[1]?.replace(/\\/g, '/');
if (invoked && /build-td-matchups\.ts$/.test(invoked)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
