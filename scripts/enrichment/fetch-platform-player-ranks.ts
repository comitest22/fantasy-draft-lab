/**
 * Fetch per-player Week + ROS positional ranks (PPR) for bio modal platform ratings:
 *   data/enrichment/platform-player-ranks-{season}.json
 *
 * Ranks are within position (QB1 / RB1 / DST1 / …), not overall.
 *
 * Sources (public; no site accounts):
 *   ESPN   — leaguedefaults week/season projections → rank by projected PPR within pos
 *   Sleeper — public projections API → rank by pts_ppr within pos
 *   CBS    — weekly PPR projections by pos + ROS projection FPTS within pos
 *   (CBS weekly expert flex page omits QBs, so week uses projection pages.)
 *
 *   npx tsx scripts/enrichment/fetch-platform-player-ranks.ts
 *   npx tsx scripts/enrichment/fetch-platform-player-ranks.ts --season 2026 --week 5
 */
import fs from 'fs/promises';
import path from 'path';
import {
  dstNickFromTeam,
  normalizeName,
} from '../../server/src/data/enrichment';
import type {
  PlatformId,
  PlatformPlayerRankPair,
  PlatformPlayerRanksFile,
} from '../../server/src/services/platformPlayerRanks';

const ROOT = path.resolve(__dirname, '../..');
const SEASON_DEFAULT = 2026;
const RANK_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']);

function dstDisplayName(raw: string): string {
  const cleaned = raw.replace(/\s+D\/ST$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const nick = parts[parts.length - 1] ?? cleaned;
  return `${nick} D/ST`;
}

type Acc = Map<string, Partial<Record<PlatformId, PlatformPlayerRankPair>>>;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function strip(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x20;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function setRank(
  acc: Acc,
  name: string,
  platform: PlatformId,
  field: 'week' | 'ros',
  rank: number
): void {
  const key = normalizeName(name);
  if (!key || !Number.isFinite(rank) || rank < 1) return;
  let row = acc.get(key);
  if (!row) {
    row = {};
    acc.set(key, row);
  }
  const pair = row[platform] ?? {};
  pair[field] = Math.round(rank);
  row[platform] = pair;
}

/** Rank within each position (QB1, RB1, …), not overall. */
function rankByPtsPositional(
  rows: Array<{ name: string; pos: string; pts: number }>,
  platform: PlatformId,
  field: 'week' | 'ros',
  acc: Acc
): number {
  const byPos = new Map<string, Array<{ name: string; pts: number }>>();
  for (const r of rows) {
    if (!r.name || !RANK_POS.has(r.pos) || !Number.isFinite(r.pts)) continue;
    let list = byPos.get(r.pos);
    if (!list) {
      list = [];
      byPos.set(r.pos, list);
    }
    list.push({ name: r.name, pts: r.pts });
  }
  let n = 0;
  for (const list of byPos.values()) {
    list.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    list.forEach((r, i) => {
      setRank(acc, r.name, platform, field, i + 1);
      n += 1;
    });
  }
  return n;
}

async function readCurrentWeek(season: number): Promise<number> {
  const fromArg = Number(argValue('--week'));
  if (Number.isFinite(fromArg) && fromArg > 0) return fromArg;
  try {
    const raw = await fs.readFile(
      path.join(ROOT, 'data/enrichment/season-state.json'),
      'utf-8'
    );
    const data = JSON.parse(raw) as { currentWeek?: number };
    if (Number.isFinite(data.currentWeek) && (data.currentWeek as number) > 0) {
      return data.currentWeek as number;
    }
  } catch {
    /* fall through */
  }
  return 1;
}

/* ── ESPN (leaguedefaults projections) ─────────────────────────── */

type EspnWrap = {
  player?: {
    fullName?: string;
    defaultPositionId?: number;
    stats?: Array<{
      id?: string;
      externalId?: string;
      seasonId?: number;
      scoringPeriodId?: number;
      statSourceId?: number;
      statSplitTypeId?: number;
      appliedTotal?: number;
    }>;
  };
  fullName?: string;
  defaultPositionId?: number;
  stats?: EspnWrap['player'] extends infer P
    ? P extends { stats?: infer S }
      ? S
      : never
    : never;
};

const ESPN_POS: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

async function fetchEspnPage(
  season: number,
  week: number,
  offset: number,
  limit: number
): Promise<EspnWrap[]> {
  const filter = {
    players: {
      limit,
      offset,
      sortPercOwned: { sortPriority: 2, sortAsc: false },
      filterSlotIds: { value: [0, 2, 4, 6, 16, 17] },
    },
  };
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3` +
    `?view=kona_player_info&scoringPeriodId=${week}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'fantasy-draft-lab',
      'x-fantasy-filter': JSON.stringify(filter),
    },
  });
  if (!res.ok) throw new Error(`ESPN leaguedefaults ${res.status}`);
  const body = (await res.json()) as { players?: EspnWrap[] } | EspnWrap[];
  return Array.isArray(body) ? body : body.players ?? [];
}

function espnWeekPts(
  stats: NonNullable<NonNullable<EspnWrap['player']>['stats']>,
  season: number,
  week: number
): number | undefined {
  const hit = stats.find(
    (s) =>
      s.statSourceId === 1 &&
      s.seasonId === season &&
      s.scoringPeriodId === week &&
      s.appliedTotal != null &&
      Number.isFinite(s.appliedTotal)
  );
  return hit?.appliedTotal;
}

function espnRosPts(
  stats: NonNullable<NonNullable<EspnWrap['player']>['stats']>,
  season: number,
  fromWeek: number
): number | undefined {
  let sum = 0;
  let n = 0;
  const byWeek = new Map<number, number>();
  for (const s of stats) {
    if (
      s.statSourceId !== 1 ||
      s.seasonId !== season ||
      s.scoringPeriodId == null ||
      s.scoringPeriodId < fromWeek ||
      s.scoringPeriodId > 18 ||
      s.appliedTotal == null ||
      !Number.isFinite(s.appliedTotal)
    ) {
      continue;
    }
    byWeek.set(s.scoringPeriodId, s.appliedTotal);
  }
  for (const pts of byWeek.values()) {
    sum += pts;
    n += 1;
  }
  return n > 0 ? sum : undefined;
}

async function loadEspn(acc: Acc, season: number, week: number): Promise<void> {
  const weekRows: Array<{ name: string; pos: string; pts: number }> = [];
  const rosRows: Array<{ name: string; pos: string; pts: number }> = [];
  const seen = new Set<string>();
  const page = 50;
  for (let offset = 0; offset < 500; offset += page) {
    const list = await fetchEspnPage(season, week, offset, page);
    if (list.length === 0) break;
    for (const wrap of list) {
      const p = wrap.player ?? wrap;
      const name = (p.fullName ?? '').trim();
      const pos = ESPN_POS[p.defaultPositionId ?? -1];
      if (!name || !pos || !RANK_POS.has(pos)) continue;
      const display = pos === 'D/ST' ? dstDisplayName(name) : name;
      const key = normalizeName(display);
      if (seen.has(key)) continue;
      seen.add(key);
      const stats = p.stats ?? [];
      const w = espnWeekPts(stats, season, week);
      const r = espnRosPts(stats, season, week);
      if (w != null) weekRows.push({ name: display, pos, pts: w });
      if (r != null) rosRows.push({ name: display, pos, pts: r });
    }
    if (list.length < page) break;
  }
  const nw = rankByPtsPositional(weekRows, 'espn', 'week', acc);
  const nr = rankByPtsPositional(rosRows, 'espn', 'ros', acc);
  console.log(`   ESPN: ${nw} week / ${nr} ROS (positional)`);
}

/* ── Sleeper ───────────────────────────────────────────────────── */

type SleeperProj = {
  stats?: { pts_ppr?: number };
  player?: { first_name?: string; last_name?: string; position?: string };
  team?: string;
};

async function fetchSleeper(
  url: string
): Promise<SleeperProj[]> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'fantasy-draft-lab' },
  });
  if (!res.ok) throw new Error(`Sleeper projections ${res.status}`);
  const data = (await res.json()) as SleeperProj[];
  return Array.isArray(data) ? data : [];
}

type SleeperProjRow = SleeperProj & { team?: string; player?: SleeperProj['player'] & { team?: string } };

async function loadSleeper(acc: Acc, season: number, week: number): Promise<void> {
  const posQ =
    'position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF';
  const weekUrl =
    `https://api.sleeper.com/projections/nfl/${season}/${week}` +
    `?season_type=regular&${posQ}&order_by=pts_ppr`;
  const rosUrl =
    `https://api.sleeper.com/projections/nfl/${season}` +
    `?season_type=regular&${posQ}&order_by=pts_ppr`;
  const [weekList, rosList] = await Promise.all([
    fetchSleeper(weekUrl),
    fetchSleeper(rosUrl),
  ]);

  const toRows = (list: SleeperProj[]) =>
    list
      .map((row) => {
        const raw = row as SleeperProjRow;
        const rawPos = raw.player?.position ?? '';
        const pos = rawPos === 'DEF' ? 'D/ST' : rawPos;
        if (!RANK_POS.has(pos)) return null;
        const pts = raw.stats?.pts_ppr;
        if (pts == null || !Number.isFinite(pts)) return null;
        let name: string;
        if (pos === 'D/ST') {
          const team = raw.team ?? raw.player?.team;
          const nick = dstNickFromTeam(team);
          if (nick) name = `${nick} D/ST`;
          else {
            const joined = `${raw.player?.first_name ?? ''} ${raw.player?.last_name ?? ''}`.trim();
            if (!joined) return null;
            name = dstDisplayName(joined);
          }
        } else {
          name = `${raw.player?.first_name ?? ''} ${raw.player?.last_name ?? ''}`.trim();
        }
        if (!name) return null;
        return { name, pos, pts };
      })
      .filter((r): r is { name: string; pos: string; pts: number } => r != null);

  const nw = rankByPtsPositional(toRows(weekList), 'sleeper', 'week', acc);
  const nr = rankByPtsPositional(toRows(rosList), 'sleeper', 'ros', acc);
  console.log(`   Sleeper: ${nw} week / ${nr} ROS (positional)`);
}

/* ── CBS ───────────────────────────────────────────────────────── */

/** CBS weekly expert flex page omits QBs — use weekly PPR projections by position instead. */
async function loadCbsWeekly(acc: Acc, season: number, week: number): Promise<number> {
  const rows: Array<{ name: string; pos: string; pts: number }> = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const) {
    // Kickers use the non-PPR projection page (same FG/XP scoring either way).
    const scoring = pos === 'K' ? 'nonppr' : 'ppr';
    const url =
      `https://www.cbssports.com/fantasy/football/stats/${pos}/${season}/${week}` +
      `/projections/${scoring}/`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'fantasy-draft-lab', Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`CBS week ${week} ${pos} ${res.status}`);
    const html = await res.text();
    const storePos = pos === 'DST' ? 'D/ST' : pos;
    for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const text = strip(match[1] ?? '');
      const tail = text.match(/(\d+\.\d+)\s+(\d+\.\d+)\s*$/);
      const fpts = tail ? Number(tail[1]) : NaN;
      if (!Number.isFinite(fpts)) continue;
      if (pos === 'DST') {
        // "Jaguars DST JAX Jacksonville Jaguars … 7.2 7.2"
        const m = text.match(
          /([A-Za-z0-9][A-Za-z0-9.'\-]+(?:\s+[A-Za-z0-9][A-Za-z0-9.'\-]+)*)\s+DST\s+[A-Z]{2,3}\s+/
        );
        const raw = (m?.[1] ?? '').trim();
        if (!raw) continue;
        rows.push({ name: dstDisplayName(raw), pos: storePos, pts: fpts });
        continue;
      }
      // "D. Maye QB NE Drake Maye QB NE 1 … 19.7 19.7"
      const m = text.match(
        new RegExp(
          `${pos}\\s+[A-Z]{2,3}\\s+([A-Za-z][A-Za-z.'\\-]+(?:\\s+[A-Za-z][A-Za-z.'\\-]+)+)\\s+${pos}\\s+[A-Z]{2,3}\\s+`
        )
      );
      if (!m) continue;
      const name = (m[1] ?? '').trim();
      if (!name) continue;
      rows.push({ name, pos: storePos, pts: fpts });
    }
  }
  const n = rankByPtsPositional(rows, 'cbs', 'week', acc);
  if (n < 50) throw new Error(`CBS weekly: expected ≥50 ranks, got ${n}`);
  return n;
}

async function loadCbsRos(acc: Acc, season: number): Promise<number> {
  const rows: Array<{ name: string; pos: string; pts: number }> = [];
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const) {
    const scoring = pos === 'K' ? 'nonppr' : 'ppr';
    const url =
      `https://www.cbssports.com/fantasy/football/stats/${pos}/${season}` +
      `/restofseason/projections/${scoring}/`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'fantasy-draft-lab', Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`CBS ROS ${pos} ${res.status}`);
    const html = await res.text();
    const storePos = pos === 'DST' ? 'D/ST' : pos;
    for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const text = strip(match[1] ?? '');
      const tail = text.match(/(\d+\.\d+)\s+(\d+\.\d+)\s*$/);
      const fpts = tail ? Number(tail[1]) : NaN;
      if (!Number.isFinite(fpts)) continue;
      if (pos === 'DST') {
        const m = text.match(
          /([A-Za-z0-9][A-Za-z0-9.'\-]+(?:\s+[A-Za-z0-9][A-Za-z0-9.'\-]+)*)\s+DST\s+[A-Z]{2,3}\s+/
        );
        const raw = (m?.[1] ?? '').trim();
        if (!raw) continue;
        rows.push({ name: dstDisplayName(raw), pos: storePos, pts: fpts });
        continue;
      }
      // "J. Gibbs RB DET Jahmyr Gibbs RB DET 13 … 322.7 24.8"
      const m = text.match(
        new RegExp(
          `${pos}\\s+[A-Z]{2,3}\\s+([A-Za-z][A-Za-z.'\\-]+(?:\\s+[A-Za-z][A-Za-z.'\\-]+)+)\\s+${pos}\\s+[A-Z]{2,3}\\s+(\\d+)\\s+`
        )
      );
      if (!m) continue;
      const name = (m[1] ?? '').trim();
      if (!name) continue;
      rows.push({ name, pos: storePos, pts: fpts });
    }
  }
  const n = rankByPtsPositional(rows, 'cbs', 'ros', acc);
  if (n < 50) throw new Error(`CBS ROS: expected ≥50, got ${n}`);
  return n;
}

async function loadCbs(acc: Acc, season: number, week: number): Promise<void> {
  const nw = await loadCbsWeekly(acc, season, week);
  const nr = await loadCbsRos(acc, season);
  console.log(`   CBS: ${nw} week / ${nr} ROS (positional)`);
}

/* ── main ──────────────────────────────────────────────────────── */

export async function run(season = SEASON_DEFAULT): Promise<void> {
  const fromArg = Number(argValue('--season'));
  if (Number.isFinite(fromArg) && fromArg > 0) season = fromArg;
  const week = await readCurrentWeek(season);
  console.log(`   Platform player ranks season=${season} week=${week}`);

  const acc: Acc = new Map();

  try {
    await loadEspn(acc, season, week);
  } catch (err) {
    console.warn(`   ESPN skipped: ${(err as Error).message}`);
  }
  try {
    await loadSleeper(acc, season, week);
  } catch (err) {
    console.warn(`   Sleeper skipped: ${(err as Error).message}`);
  }
  try {
    await loadCbs(acc, season, week);
  } catch (err) {
    console.warn(`   CBS skipped: ${(err as Error).message}`);
  }

  const byPlayer: PlatformPlayerRanksFile['byPlayer'] = {};
  for (const [key, platforms] of acc) {
    byPlayer[key] = platforms;
  }

  const payload: PlatformPlayerRanksFile = {
    season,
    currentWeek: week,
    scoring: 'PPR',
    rankScope: 'positional',
    fetchedAt: new Date().toISOString(),
    byPlayer,
  };
  const outPath = path.join(ROOT, 'data/enrichment', `platform-player-ranks-${season}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${outPath} (${Object.keys(byPlayer).length} players)`);
}

const invokedDirectly = /fetch-platform-player-ranks/.test(
  (process.argv[1] ?? '').replace(/\\/g, '/')
);
if (invokedDirectly) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
