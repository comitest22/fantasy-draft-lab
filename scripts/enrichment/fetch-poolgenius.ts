/**
 * Log out, start the logged-out free trial, then log in and write the NFL
 * survivor Data Grid to data/enrichment/poolgenius-survivor-2026.json.
 *
 * The trial form only shows while logged out, so logout always runs first.
 * Each new signup uses the next address: the number in POOLGENIUS_USERNAME (or
 * the last address in poolgenius-account.json) goes up by 1. Password stays the
 * same. A retry within 18 hours logs into that account instead of signing up
 * again. Credentials: POOLGENIUS_USERNAME / POOLGENIUS_PASSWORD in the repo .env
 *
 *   npx tsx scripts/enrichment/fetch-poolgenius.ts
 */
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import {
  alignFutureToSchedule,
  formatGameScore,
  lockCompletedFuture,
  normalizePgFutureCell,
  resultFromScores,
  type PgFinalGame,
  type PgFutureCell,
  type PgScheduleWeek,
} from '../../server/src/analysis/pgFuture';
import { week1SeedWinPct } from '../../server/src/analysis/pgWeek1Seed';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const OUT = path.resolve(__dirname, '../../data/enrichment/poolgenius-survivor-2026.json');
const ACCOUNT = path.resolve(__dirname, '../../data/enrichment/poolgenius-account.json');
const LOGIN = 'https://www.teamrankings.com/login/';
const LOGOUT = 'https://www.teamrankings.com/logout/';
const TRIAL = 'https://www.teamrankings.com/free-3-day-trial/?signup_source=select_package';
const GRID_BASE = 'https://poolgenius.teamrankings.com/nfl-survivor-pool-picks/data-grid/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TEAM_FROM_NAME: Record<string, string> = {
  Arizona: 'ARI',
  Atlanta: 'ATL',
  Baltimore: 'BAL',
  Buffalo: 'BUF',
  Carolina: 'CAR',
  Chicago: 'CHI',
  Cincinnati: 'CIN',
  Cleveland: 'CLE',
  Dallas: 'DAL',
  Denver: 'DEN',
  Detroit: 'DET',
  'Green Bay': 'GB',
  Houston: 'HOU',
  Indianapolis: 'IND',
  Jacksonville: 'JAX',
  'Kansas City': 'KC',
  'LA Chargers': 'LAC',
  'LA Rams': 'LA',
  'Las Vegas': 'LV',
  Miami: 'MIA',
  Minnesota: 'MIN',
  'New England': 'NE',
  'New Orleans': 'NO',
  'NY Giants': 'NYG',
  'NY Jets': 'NYJ',
  Philadelphia: 'PHI',
  Pittsburgh: 'PIT',
  'San Francisco': 'SF',
  Seattle: 'SEA',
  'Tampa Bay': 'TB',
  Tennessee: 'TEN',
  Washington: 'WAS',
};

type CookieJar = Map<string, string>;

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbCookies(jar: CookieJar, res: Response): void {
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const list = getSetCookie?.call(res.headers) ?? [];
  const single = res.headers.get('set-cookie');
  const all = list.length > 0 ? list : single ? [single] : [];
  for (const raw of all) {
    const part = raw.split(';')[0] ?? '';
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
}

function hiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    const name = tag.match(/name=["']([^"']+)/i)?.[1];
    const value = tag.match(/value=["']([^"']*)/i)?.[1] ?? '';
    if (name) out[name] = value;
  }
  return out;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pct(s: string): number | null {
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function num(s: string): number | null {
  const t = s.replace(/,/g, '').trim();
  if (!t || t === '--' || /bye/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function splitRowCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const re = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) cells.push(m[1] ?? '');
  return cells;
}

export type WeekBoardSnap = {
  opponent: string;
  home: boolean;
  matchupLabel: string;
  pgWinPct: number | null;
  marketWinPct: number | null;
  moneyline: string;
  spread: number | null;
  popularityPct: number | null;
  ev: number | null;
  gameNotes: string[];
};

export type PgTeamRow = {
  team: string;
  teamName: string;
  opponent: string;
  home: boolean;
  matchupLabel: string;
  pgWinPct: number | null;
  marketWinPct: number | null;
  moneyline: string;
  spread: number | null;
  popularityPct: number | null;
  ev: number | null;
  futureValue: number | null;
  gameNotes: string[];
  future: PgFutureCell[];
  weekBoards?: Record<string, WeekBoardSnap>;
};

function parseGrid(html: string): { lastUpdated: string | null; teams: PgTeamRow[] } {
  const lastUpdated = html.match(/Last updated:\s*([^<]+)/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? html;
  const rows = tbody.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const teams: PgTeamRow[] = [];
  for (const row of rows) {
    const cells = splitRowCells(row);
    if (cells.length < 9) continue;
    const teamHtml = cells[0] ?? '';
    const title = teamHtml.match(/title="([^"]+)"/)?.[1] ?? stripTags(teamHtml).replace(/\s+(vs\.|at)\s+.*/i, '');
    const small = stripTags(teamHtml.match(/<small[^>]*>([\s\S]*?)<\/small>/i)?.[1] ?? '');
    const matchupLabel = small || stripTags(teamHtml).replace(title, '').trim();
    const away = /\bat\b|^@/i.test(matchupLabel);
    const opponent = matchupLabel.replace(/^(vs\.|at|@)\s*/i, '').trim();
    const notes = [...(cells[8] ?? '').matchAll(/class="note note-([^"]+)"/gi)].map((m) => m[1] ?? '');
    const future: PgFutureCell[] = [];
    for (let w = 1; w <= 18; w++) {
      const raw = stripTags(cells[8 + w] ?? '');
      const bye = /bye/i.test(raw);
      const m = raw.match(/(\d+)%\s*(.*)/);
      future.push(
        normalizePgFutureCell({
          week: w,
          winPct: bye ? null : m ? Number(m[1]) : pct(raw),
          opp: bye ? 'BYE' : m ? (m[2] ?? '').trim() : raw,
          bye,
        }),
      );
    }
    teams.push({
      team: TEAM_FROM_NAME[title] ?? title,
      teamName: title,
      opponent,
      home: !away,
      matchupLabel,
      pgWinPct: pct(stripTags(cells[1] ?? '')),
      marketWinPct: pct(stripTags(cells[2] ?? '')),
      moneyline: stripTags(cells[3] ?? ''),
      spread: num(stripTags(cells[4] ?? '')),
      popularityPct: pct(stripTags(cells[5] ?? '')),
      ev: num(stripTags(cells[6] ?? '')),
      futureValue: num(stripTags(cells[7] ?? '')),
      gameNotes: notes,
      future,
    });
  }
  return { lastUpdated, teams };
}

function siteHeaders(jar: CookieJar, referer?: string): Record<string, string> {
  return {
    'user-agent': UA,
    cookie: cookieHeader(jar),
    ...(referer ? { referer } : {}),
  };
}

/** Follow a short redirect chain so logout/login Set-Cookie headers are kept. Redirects are GET. */
async function fetchFollow(jar: CookieJar, url: string, init: RequestInit = {}, hops = 4): Promise<Response> {
  let current = url;
  let method = init.method ?? 'GET';
  let body = init.body;
  let res = await fetch(current, { ...init, method, body, redirect: 'manual' });
  absorbCookies(jar, res);
  for (let i = 0; i < hops && res.status >= 300 && res.status < 400; i++) {
    const loc = res.headers.get('location');
    await res.text();
    if (!loc) break;
    current = new URL(loc, current).toString();
    method = 'GET';
    body = undefined;
    const headers = new Headers(init.headers);
    headers.delete('content-type');
    headers.set('cookie', cookieHeader(jar));
    res = await fetch(current, { method, headers, redirect: 'manual' });
    absorbCookies(jar, res);
  }
  return res;
}

/** Clear any TeamRankings session before the logged-out trial signup. */
async function logout(jar: CookieJar): Promise<void> {
  const res = await fetchFollow(jar, LOGOUT, { headers: siteHeaders(jar) });
  await res.text();
  jar.delete('tru');
  jar.delete('tr_session');
}

/** `name26@gmail.com` → `name27@gmail.com`. */
export function nextSignupEmail(email: string): string {
  const match = email.trim().match(/^(.*?)(\d+)(@[^@]+)$/);
  if (!match) {
    throw new Error('POOLGENIUS_USERNAME must end with a number before @, like name26@gmail.com');
  }
  return `${match[1]}${Number(match[2]) + 1}${match[3]}`;
}

type SignupRecord = { email: string; signedUpAt?: string };

/** Same-day retries reuse the trial instead of burning the next address. */
const REUSE_MS = 18 * 60 * 60 * 1000;

async function lastSignupRecord(fallback: string): Promise<SignupRecord> {
  try {
    const raw = JSON.parse(await fs.readFile(ACCOUNT, 'utf8')) as SignupRecord;
    if (raw.email?.includes('@')) return { email: raw.email.trim(), signedUpAt: raw.signedUpAt };
  } catch {
    // First run uses the .env address, which has already been signed up.
  }
  return { email: fallback.trim() };
}

function signupIsFresh(signedUpAt?: string): boolean {
  if (!signedUpAt) return false;
  const t = Date.parse(signedUpAt);
  return Number.isFinite(t) && Date.now() - t < REUSE_MS;
}

async function rememberSignupEmail(email: string): Promise<void> {
  const payload = { email, signedUpAt: new Date().toISOString() };
  await fs.writeFile(ACCOUNT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Post the free-trial form while logged out.
 * Returns existing when TeamRankings says this email already has an account.
 */
async function signupTrial(jar: CookieJar, user: string, pass: string): Promise<'started' | 'existing'> {
  const page = await fetchFollow(jar, TRIAL, { headers: siteHeaders(jar) });
  const html = await page.text();
  if (/new TeamRankings users only/i.test(html)) {
    throw new Error('PoolGenius trial page still has a logged-in session');
  }
  const hidden = hiddenInputs(html);
  const body = new URLSearchParams({
    ...hidden,
    email: user,
    password: pass,
    submitted: hidden.submitted || 'Get Free Picks',
  });
  body.delete('email2');
  const post = await fetchFollow(jar, TRIAL, {
    method: 'POST',
    headers: {
      ...siteHeaders(jar, TRIAL),
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://www.teamrankings.com',
    },
    body,
  });
  const text = await post.text();
  if (/already registered/i.test(text)) return 'existing';
  if (/new TeamRankings users only/i.test(text)) {
    throw new Error('PoolGenius trial page still has a logged-in session');
  }
  if (post.status >= 400) {
    throw new Error(`PoolGenius trial signup failed (${post.status})`);
  }
  return 'started';
}

async function login(jar: CookieJar, user: string, pass: string): Promise<void> {
  const get = await fetchFollow(jar, LOGIN, { headers: siteHeaders(jar) });
  const html = await get.text();
  const hidden = hiddenInputs(html);
  const body = new URLSearchParams({
    ...hidden,
    email: user,
    username: user,
    password: pass,
  });
  const post = await fetchFollow(jar, LOGIN, {
    method: 'POST',
    headers: {
      ...siteHeaders(jar, LOGIN),
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://www.teamrankings.com',
    },
    body,
  });
  await post.text();
  if (post.status >= 400) {
    throw new Error(`PoolGenius login failed (${post.status})`);
  }
}

async function readCurrentWeek(): Promise<number> {
  try {
    const raw = await fs.readFile(path.resolve(__dirname, '../../data/enrichment/season-state.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { currentWeek?: number };
    if (Number.isFinite(parsed.currentWeek)) return parsed.currentWeek as number;
  } catch {
    // fall through
  }
  return 1;
}

function parseWeek(argv: string[]): number | undefined {
  const idx = argv.indexOf('--week');
  if (idx >= 0) return parseInt(argv[idx + 1], 10);
  const flag = argv.find((a) => a.startsWith('--week='));
  if (flag) return parseInt(flag.split('=')[1], 10);
  return undefined;
}

export async function run(weekArg?: number): Promise<number> {
  const user = process.env.POOLGENIUS_USERNAME?.trim();
  const pass = process.env.POOLGENIUS_PASSWORD;
  if (!user || !pass) {
    throw new Error('Set POOLGENIUS_USERNAME and POOLGENIUS_PASSWORD in .env');
  }
  const week = weekArg ?? parseWeek(process.argv.slice(2)) ?? (await readCurrentWeek());
  const jar: CookieJar = new Map();
  const last = await lastSignupRecord(user);
  let email = nextSignupEmail(last.email);
  if (signupIsFresh(last.signedUpAt)) {
    email = last.email;
    console.log(`Using the PoolGenius trial started earlier today as ${email}`);
  } else {
    let trial: 'started' | 'existing' = 'existing';
    for (let attempt = 0; attempt < 3 && trial !== 'started'; attempt++) {
      await logout(jar);
      trial = await signupTrial(jar, email, pass);
      await rememberSignupEmail(email);
      if (trial === 'started') break;
      console.log(`${email} is already registered`);
      email = nextSignupEmail(email);
    }
    if (trial !== 'started') {
      throw new Error('PoolGenius free-trial signup did not start');
    }
    console.log(`Started the logged-out PoolGenius free trial as ${email}`);
  }
  await login(jar, email, pass);
  const res = await fetch(`${GRID_BASE}?week=${week}`, {
    headers: siteHeaders(jar, 'https://poolgenius.teamrankings.com/nfl-survivor-pool-picks/'),
  });
  absorbCookies(jar, res);
  const html = await res.text();
  if (/Survivor info ready|Check back in after/i.test(html)) {
    throw new Error(
      `PoolGenius Week ${week} grid is not published yet (check back after 5PM Eastern). Trial ${email} is already active.`,
    );
  }
  if (/subscription required/i.test(html) && !/<tbody/i.test(html)) {
    throw new Error('PoolGenius Data Grid still gated after login');
  }
  const parsed = parseGrid(html);
  if (parsed.teams.length < 30) {
    throw new Error(`Expected 32 teams, parsed ${parsed.teams.length}`);
  }
  const previous = await loadPrevious();
  const finals = await loadFinalScores();
  const schedule = await loadScheduleWeeks();
  const teams = parsed.teams.map((team) => {
    const prior = previous?.teams.find((row) => row.team === team.team);
    const aligned = alignFutureToSchedule(team.future, schedule.get(team.team) ?? []);
    const future = lockCompletedFuture(
      aligned,
      (prior?.future ?? []).map((cell) => normalizePgFutureCell(cell)),
      finals.get(team.team) ?? new Map(),
    ).map((cell) => {
      if (cell.week !== 1 || cell.bye || cell.winPct != null) return cell;
      const seeded = week1SeedWinPct(team.team);
      if (seeded == null) return cell;
      return { ...cell, winPct: seeded, locked: cell.result != null };
    });
    const weekBoards = { ...(prior?.weekBoards ?? {}) };
    weekBoards[String(week)] = {
      opponent: team.opponent,
      home: team.home,
      matchupLabel: team.matchupLabel,
      pgWinPct: team.pgWinPct,
      marketWinPct: team.marketWinPct,
      moneyline: team.moneyline,
      spread: team.spread,
      popularityPct: team.popularityPct,
      ev: team.ev,
      gameNotes: team.gameNotes ?? [],
    };
    return { ...team, future, weekBoards };
  });
  const lockedWeeks = new Set(
    teams.flatMap((team) => team.future.filter((cell) => cell.locked || cell.result).map((cell) => cell.week)),
  );
  const payload = {
    pulledAt: new Date().toISOString(),
    lastUpdated: parsed.lastUpdated,
    week,
    source: GRID_BASE,
    teams,
  };
  await fs.writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${teams.length} teams (week ${week}) to ${path.relative(process.cwd(), OUT)}` +
      (lockedWeeks.size ? `; locked weeks ${[...lockedWeeks].sort((a, b) => a - b).join(',')}` : ''),
  );
  return week;
}

type PrevPayload = {
  teams: Array<{ team: string; future: PgFutureCell[]; weekBoards?: Record<string, WeekBoardSnap> }>;
};

async function loadPrevious(): Promise<PrevPayload | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(OUT, 'utf8')) as PrevPayload;
    if (!Array.isArray(raw.teams)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

async function loadScheduleCsv(): Promise<string[][]> {
  const file = path.resolve(__dirname, '../../data/enrichment/nfl-schedule-2026.csv');
  try {
    const text = await fs.readFile(file, 'utf8');
    return text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(','));
  } catch {
    return [];
  }
}

async function loadFinalScores(): Promise<Map<string, Map<number, PgFinalGame>>> {
  const out = new Map<string, Map<number, PgFinalGame>>();
  const lines = await loadScheduleCsv();
  if (lines.length < 2) return out;
  const headers = (lines[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const teamIdx = idx('team');
  const weekIdx = idx('week');
  const oppIdx = idx('opponent');
  const homeIdx = idx('home');
  const statusIdx = idx('status');
  const teamScoreIdx = idx('teamscore');
  const oppScoreIdx = idx('oppscore');
  if (teamIdx < 0 || weekIdx < 0) return out;
  for (const cols of lines.slice(1)) {
    const team = (cols[teamIdx] ?? '').trim().toUpperCase();
    const week = Number(cols[weekIdx]);
    const status = (cols[statusIdx] ?? '').trim().toUpperCase();
    const opp = (cols[oppIdx] ?? '').trim().toUpperCase();
    if (!team || !Number.isFinite(week) || status !== 'FINAL' || !opp || opp === 'BYE') continue;
    const teamScore = Number(cols[teamScoreIdx]);
    const oppScore = Number(cols[oppScoreIdx]);
    const result = resultFromScores(teamScore, oppScore);
    const score = formatGameScore(teamScore, oppScore);
    if (!result || !score) continue;
    const away = homeIdx >= 0 && Number(cols[homeIdx]) === 0;
    const byWeek = out.get(team) ?? new Map<number, PgFinalGame>();
    byWeek.set(week, { result, score, opp: away ? `@${opp}` : opp });
    out.set(team, byWeek);
  }
  return out;
}

async function loadScheduleWeeks(): Promise<Map<string, PgScheduleWeek[]>> {
  const out = new Map<string, PgScheduleWeek[]>();
  const lines = await loadScheduleCsv();
  if (lines.length < 2) return out;
  const headers = (lines[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const teamIdx = idx('team');
  const weekIdx = idx('week');
  const oppIdx = idx('opponent');
  const homeIdx = idx('home');
  const statusIdx = idx('status');
  const teamScoreIdx = idx('teamscore');
  const oppScoreIdx = idx('oppscore');
  if (teamIdx < 0 || weekIdx < 0) return out;
  for (const cols of lines.slice(1)) {
    const team = (cols[teamIdx] ?? '').trim().toUpperCase();
    const week = Number(cols[weekIdx]);
    if (!team || !Number.isFinite(week)) continue;
    const oppRaw = (cols[oppIdx] ?? '').trim().toUpperCase();
    const bye = !oppRaw || oppRaw === 'BYE';
    const status = (cols[statusIdx] ?? '').trim().toUpperCase();
    const away = homeIdx >= 0 && Number(cols[homeIdx]) === 0;
    let result: PgFinalGame['result'] | null = null;
    let score: string | null = null;
    if (!bye && status === 'FINAL') {
      result = resultFromScores(Number(cols[teamScoreIdx]), Number(cols[oppScoreIdx]));
      score = formatGameScore(Number(cols[teamScoreIdx]), Number(cols[oppScoreIdx]));
    }
    const row: PgScheduleWeek = {
      week,
      opp: bye ? 'BYE' : away ? `@${oppRaw}` : oppRaw,
      bye,
      result,
      score,
    };
    const list = out.get(team) ?? [];
    list.push(row);
    out.set(team, list);
  }
  return out;
}

const invokedDirectly = /fetch-poolgenius/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
