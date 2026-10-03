/**
 * Pull live ESPN PPR draft ranks and depth-chart extras, write:
 *   data/enrichment/espn-ppr-overall/{season}.csv
 *   data/enrichment/espn-depth-{season}.csv   (team roster players past the ranked board)
 *   data/enrichment/espn-ids-{season}.csv     (athlete ids for game logs past the top board)
 * then merge ranks into adp.csv (keeps existing expectedPoints).
 *
 * Usage:
 *   npx tsx scripts/enrichment/fetch-espn-ranks.ts
 *   npx tsx scripts/enrichment/fetch-espn-ranks.ts --season 2026
 */
import fs from 'fs/promises';
import path from 'path';

const RANK_DIR = path.resolve(__dirname, '../../data/enrichment/espn-ppr-overall');
const ADP_PATH = path.resolve(__dirname, '../../data/enrichment/adp.csv');
const SEASON_DEFAULT = 2026;
const PAGE = 100;
/** Published PPR draft ranks kept on the draft/ADP board (was 300; mid-season names sit past that). */
const MAX_RANK = 500;
/** Extra percent-owned sweep for depth-chart / search coverage. */
const DEPTH_PAGES = 12;

const POS_BY_ID: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

/** ESPN fantasy proTeamId → canonical abbreviation. */
const ESPN_TEAM: Record<number, string> = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LA',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
};

type EspnPlayer = {
  id?: number;
  fullName?: string;
  defaultPositionId?: number;
  injuryStatus?: string;
  proTeamId?: number;
  player?: EspnPlayer;
  draftRanksByRankType?: {
    PPR?: { rank?: number; published?: boolean };
  };
  ownership?: { percentOwned?: number };
};

type RankRow = {
  playerName: string;
  season: number;
  position: string;
  adp: number;
  expectedPoints?: number;
};

type DepthRow = {
  playerName: string;
  position: string;
  nflTeam: string;
  espnRank?: number;
  espnId?: number;
  status?: string;
  percentOwned?: number;
};

type IdRow = {
  playerName: string;
  espnId: number;
  position: string;
};

function playerEspnId(player: EspnPlayer): number | undefined {
  const id = player.id;
  return typeof id === 'number' && id > 0 ? id : undefined;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else current += ch;
  }
  result.push(current.trim());
  return result;
}

function csvEscape(value: string | number | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dstName(name: string): string {
  const cleaned = name.replace(/\s+D\/ST$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const nick = parts[parts.length - 1] ?? cleaned;
  return `${nick} D/ST`;
}

async function fetchPage(
  season: number,
  offset: number,
  sort: 'draft' | 'owned',
): Promise<EspnPlayer[]> {
  const filter = {
    players: {
      limit: PAGE,
      offset,
      ...(sort === 'draft'
        ? { sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'PPR' } }
        : { sortPercOwned: { sortPriority: 2, sortAsc: false } }),
      filterSlotIds: { value: [0, 2, 3, 4, 5, 6, 16, 17, 23] },
    },
  };
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=0&view=kona_player_info`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-fantasy-filter': JSON.stringify(filter),
    },
  });
  if (!res.ok) {
    throw new Error(`ESPN players ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as EspnPlayer[] | { players?: EspnPlayer[] };
  if (Array.isArray(body)) return body;
  return body.players ?? [];
}

async function loadExpectedPoints(season: number): Promise<Map<string, number>> {
  const byName = new Map<string, number>();
  try {
    const raw = await fs.readFile(path.join(RANK_DIR, `${season}.csv`), 'utf-8');
    for (const line of raw.trim().split(/\r?\n/).slice(1)) {
      const cols = parseCsvLine(line);
      const pts = parseFloat(cols[4] ?? '');
      if (cols[0] && Number.isFinite(pts)) byName.set(normalizeName(cols[0]), pts);
    }
  } catch {
    /* first run */
  }
  try {
    const raw = await fs.readFile(ADP_PATH, 'utf-8');
    const lines = raw.trim().split(/\r?\n/);
    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const nameIdx = header.indexOf('playername');
    const seasonIdx = header.indexOf('season');
    const ptsIdx = header.indexOf('expectedpoints');
    for (const line of lines.slice(1)) {
      const cols = parseCsvLine(line);
      if (parseInt(cols[seasonIdx], 10) !== season) continue;
      const pts = parseFloat(cols[ptsIdx] ?? '');
      if (cols[nameIdx] && Number.isFinite(pts) && !byName.has(normalizeName(cols[nameIdx]))) {
        byName.set(normalizeName(cols[nameIdx]), pts);
      }
    }
  } catch {
    /* optional */
  }
  return byName;
}

function unwrapPlayer(player: EspnPlayer): EspnPlayer {
  if (!player.player) return player;
  return { ...player.player, ...player, player: undefined };
}

function toRow(player: EspnPlayer, season: number, points: Map<string, number>): RankRow | null {
  const rank = player.draftRanksByRankType?.PPR?.rank;
  const posId = player.defaultPositionId ?? -1;
  const pos = POS_BY_ID[posId];
  const rawName = (player.fullName ?? '').trim();
  if (!rawName || !pos || rank == null || rank < 1 || rank > MAX_RANK) return null;
  const playerName = pos === 'D/ST' ? dstName(rawName) : rawName;
  if (/tqb$/i.test(playerName)) return null;
  return {
    playerName,
    season,
    position: pos,
    adp: rank,
    expectedPoints: points.get(normalizeName(playerName)) ?? points.get(normalizeName(rawName)),
  };
}

function toDepthRow(player: EspnPlayer): DepthRow | null {
  const posId = player.defaultPositionId ?? -1;
  const pos = POS_BY_ID[posId];
  const rawName = (player.fullName ?? '').trim();
  const teamId = player.proTeamId ?? 0;
  const nflTeam = ESPN_TEAM[teamId];
  if (!rawName || !pos || !nflTeam) return null;
  const playerName = pos === 'D/ST' ? dstName(rawName) : rawName;
  if (/tqb$/i.test(playerName)) return null;
  const espnRank = player.draftRanksByRankType?.PPR?.rank;
  return {
    playerName,
    position: pos,
    nflTeam,
    espnRank: espnRank != null && espnRank > 0 ? espnRank : undefined,
    espnId: playerEspnId(player),
    status: (player.injuryStatus ?? '').trim() || undefined,
    percentOwned: player.ownership?.percentOwned,
  };
}

function rememberId(
  ids: Map<string, IdRow>,
  player: EspnPlayer,
  playerName: string,
  position: string
): void {
  const espnId = playerEspnId(player);
  if (!espnId || !playerName || !position) return;
  const key = normalizeName(playerName);
  const prev = ids.get(key);
  if (!prev) ids.set(key, { playerName, espnId, position });
}

/** Drop historical / inactive stubs: need a published rank or measurable ownership. */
function isLiveDepth(d: DepthRow): boolean {
  return (d.espnRank != null && d.espnRank > 0) || (d.percentOwned != null && d.percentOwned > 0);
}

async function mergeAdp(season: number, rows: RankRow[]): Promise<void> {
  const raw = await fs.readFile(ADP_PATH, 'utf-8');
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0];
  const seasonIdx = parseCsvLine(header)
    .map((h) => h.toLowerCase())
    .indexOf('season');
  const kept = lines.slice(1).filter((line) => parseInt(parseCsvLine(line)[seasonIdx], 10) !== season);
  const fresh = rows.map((r) =>
    [csvEscape(r.playerName), r.season, r.position, r.adp, r.expectedPoints ?? ''].join(',')
  );
  const merged = [...kept, ...fresh].sort((a, b) => {
    const aa = parseCsvLine(a);
    const bb = parseCsvLine(b);
    const seasonA = parseInt(aa[seasonIdx], 10);
    const seasonB = parseInt(bb[seasonIdx], 10);
    if (seasonA !== seasonB) return seasonA - seasonB;
    return parseFloat(aa[3]) - parseFloat(bb[3]);
  });
  await fs.writeFile(ADP_PATH, `${header}\n${merged.join('\n')}\n`, 'utf-8');
}

export async function run(seasonArg?: number): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--season'));
  const parsed = arg?.includes('=')
    ? parseInt(arg.split('=')[1], 10)
    : process.argv.includes('--season')
      ? parseInt(process.argv[process.argv.indexOf('--season') + 1], 10)
      : undefined;
  const season = seasonArg ?? (Number.isFinite(parsed) ? (parsed as number) : SEASON_DEFAULT);

  const points = await loadExpectedPoints(season);
  const byRank = new Map<number, RankRow>();
  const statuses = new Map<string, string>();
  const onBoard = new Set<string>();
  const espnIds = new Map<string, IdRow>();

  for (let offset = 0; offset < 1200; offset += PAGE) {
    const page = await fetchPage(season, offset, 'draft');
    if (page.length === 0) break;
    let lastRank = 0;
    for (const raw of page) {
      const player = unwrapPlayer(raw);
      const row = toRow(player, season, points);
      const posId = player.defaultPositionId ?? -1;
      const pos = POS_BY_ID[posId];
      const rawName = (player.fullName ?? '').trim();
      const playerName = row?.playerName ?? (pos === 'D/ST' && rawName ? dstName(rawName) : rawName);
      const status = (player.injuryStatus ?? '').trim();
      if (playerName && status) statuses.set(playerName, status);
      if (playerName && pos) rememberId(espnIds, player, playerName, pos);
      if (!row) continue;
      if (!byRank.has(row.adp)) byRank.set(row.adp, row);
      onBoard.add(normalizeName(row.playerName));
      lastRank = player.draftRanksByRankType?.PPR?.rank ?? lastRank;
    }
    if (page.length < PAGE || lastRank > MAX_RANK) break;
  }

  const ranked = [...byRank.values()].sort(
    (a, b) => a.adp - b.adp || a.playerName.localeCompare(b.playerName)
  );
  const rows = ranked.map((row, i) => ({ ...row, adp: i + 1 }));
  if (rows.length < 100) {
    throw new Error(`Only got ${rows.length} ESPN PPR ranks — aborting so we don’t wipe the board`);
  }

  const depthByName = new Map<string, DepthRow>();
  for (let offset = 0; offset < DEPTH_PAGES * PAGE; offset += PAGE) {
    const page = await fetchPage(season, offset, 'owned');
    if (page.length === 0) break;
    for (const raw of page) {
      const player = unwrapPlayer(raw);
      const depth = toDepthRow(player);
      if (!depth || !isLiveDepth(depth)) continue;
      rememberId(espnIds, player, depth.playerName, depth.position);
      const key = normalizeName(depth.playerName);
      if (onBoard.has(key)) continue;
      const prev = depthByName.get(key);
      if (!prev || (depth.percentOwned ?? 0) > (prev.percentOwned ?? 0)) depthByName.set(key, depth);
      if (depth.status) statuses.set(depth.playerName, depth.status);
    }
    if (page.length < PAGE) break;
  }
  const depthRows = [...depthByName.values()].sort(
    (a, b) =>
      (b.percentOwned ?? 0) - (a.percentOwned ?? 0) || a.playerName.localeCompare(b.playerName)
  );

  await fs.mkdir(RANK_DIR, { recursive: true });
  const csv = [
    'playerName,season,position,adp,expectedPoints',
    ...rows.map((r) =>
      [csvEscape(r.playerName), r.season, r.position, r.adp, r.expectedPoints ?? ''].join(',')
    ),
  ].join('\n');
  const outPath = path.join(RANK_DIR, `${season}.csv`);
  await fs.writeFile(outPath, `${csv}\n`, 'utf-8');
  await fs.writeFile(
    path.join(RANK_DIR, '..', 'espn-ranks-meta.json'),
    JSON.stringify(
      {
        source: 'ESPN live PPR draft ranks',
        season,
        fetchedAt: new Date().toISOString(),
        playerCount: rows.length,
        maxRank: MAX_RANK,
        depthCount: depthRows.length,
        idCount: espnIds.size,
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );
  await mergeAdp(season, rows);

  const depthPath = path.join(RANK_DIR, '..', `espn-depth-${season}.csv`);
  await fs.writeFile(
    depthPath,
    [
      'playerName,position,nflTeam,espnRank,espnId,status,percentOwned',
      ...depthRows.map((r) =>
        [
          csvEscape(r.playerName),
          r.position,
          r.nflTeam,
          r.espnRank ?? '',
          r.espnId ?? '',
          csvEscape(r.status),
          r.percentOwned ?? '',
        ].join(',')
      ),
    ].join('\n') + '\n',
    'utf-8'
  );

  const idRows = [...espnIds.values()].sort((a, b) => a.playerName.localeCompare(b.playerName));
  const idsPath = path.join(RANK_DIR, '..', `espn-ids-${season}.csv`);
  await fs.writeFile(
    idsPath,
    [
      'playerName,espnId,position',
      ...idRows.map((r) => [csvEscape(r.playerName), r.espnId, r.position].join(',')),
    ].join('\n') + '\n',
    'utf-8'
  );

  const statusRows = [...statuses.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const statusPath = path.join(RANK_DIR, '..', `player-status-${season}.csv`);
  await fs.writeFile(
    statusPath,
    `playerName,status\n${statusRows.map(([name, status]) => `${csvEscape(name)},${csvEscape(status)}`).join('\n')}\n`,
    'utf-8'
  );

  const flagged = statusRows.filter(([, status]) => !/^active$/i.test(status));

  const jacobs = rows.find((r) => /josh jacobs/i.test(r.playerName));
  const schultz = rows.find((r) => /dalton schultz/i.test(r.playerName));
  console.log(
    `ESPN PPR ${season}: ${rows.length} ranked (cap ${MAX_RANK}) + ${depthRows.length} depth + ${idRows.length} ids`
  );
  console.log(`  1. ${rows[0].playerName} (${rows[0].position})`);
  if (jacobs) console.log(`  Josh Jacobs: ESPN #${jacobs.adp}`);
  else console.log('  Josh Jacobs: not in top board');
  if (schultz) console.log(`  Dalton Schultz: ESPN #${schultz.adp}`);
  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${depthPath}`);
  console.log(`Wrote ${idsPath}`);
  console.log(`Updated ${ADP_PATH}`);
  console.log(`Player status: ${flagged.length} non-active of ${statusRows.length} → ${statusPath}`);
}

const invokedDirectly = /fetch-espn-ranks/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  const arg = process.argv.find((a) => a.startsWith('--season'));
  const season = arg?.includes('=')
    ? parseInt(arg.split('=')[1], 10)
    : parseInt(process.argv[process.argv.indexOf('--season') + 1], 10) || SEASON_DEFAULT;
  run(Number.isFinite(season) ? season : SEASON_DEFAULT).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
