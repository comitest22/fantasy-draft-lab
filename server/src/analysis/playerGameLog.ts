import { listRankedBoard } from './draftRoutes';
import { canonicalTeam, enrichmentStore, normalizeName } from '../data/enrichment';
import type {
  PlayerGameLog,
  PlayerGameLogColumn,
  PlayerGameLogRow,
  PlayerSosSlate,
  Position,
} from '../types';

const PAGE = 100;
const ID_SCAN_LIMIT = 2000;
const ID_TTL_MS = 30 * 60 * 1000;
const LOG_TTL_MS = 30 * 60 * 1000;
const PREVIEW_ROWS = 8;
const LOG_POS = new Set<Position>(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']);

const POS_BY_ID: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

type EspnListPlayer = {
  id?: number;
  fullName?: string;
  defaultPositionId?: number;
  player?: EspnListPlayer;
};

type EspnEvent = {
  week?: number;
  atVs?: string;
  opponent?: { abbreviation?: string };
};

type EspnGameLogPayload = {
  names?: string[];
  events?: Record<string, EspnEvent>;
  seasonTypes?: Array<{
    displayName?: string;
    categories?: Array<{
      displayName?: string;
      events?: Array<{ eventId?: string; stats?: string[] }>;
    }>;
  }>;
};

type IdHit = { id: number; pos: string };

let idCache: { at: number; byName: Map<string, IdHit> } | null = null;
const logCache = new Map<string, { at: number; log: PlayerGameLog; nflTeam?: string; position: Position }>();

function dstName(name: string): string {
  const cleaned = name.replace(/\s+D\/ST$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const nick = parts[parts.length - 1] ?? cleaned;
  return `${nick} D/ST`;
}

function unwrapPlayer(player: EspnListPlayer): EspnListPlayer {
  if (!player.player) return player;
  return { ...player.player, ...player, player: undefined };
}

function parseNum(raw: string | undefined): number | null {
  if (raw == null || raw === '' || raw === '-') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function statMap(names: string[], stats: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    if (!key) continue;
    out[key] = parseNum(stats[i]);
  }
  return out;
}

export function pprPoints(stats: Record<string, number | null>, position: Position): number | null {
  const n = (...keys: string[]) => {
    for (const key of keys) {
      const v = stats[key];
      if (v != null) return v;
    }
    return 0;
  };
  if (position === 'K') {
    const fg = n('fieldGoalsMade', 'madeFieldGoals');
    const xp = n('extraPointsMade', 'madeExtraPoints');
    if (!stats.fieldGoalsMade && !stats.madeFieldGoals && !stats.extraPointsMade && !stats.madeExtraPoints) {
      return null;
    }
    return round1(fg * 3 + xp);
  }
  if (position === 'D/ST') return null;
  const pts =
    n('passingYards') / 25 +
    n('passingTouchdowns') * 4 -
    n('interceptions') * 2 +
    n('rushingYards') / 10 +
    n('rushingTouchdowns') * 6 +
    n('receptions') +
    n('receivingYards') / 10 +
    n('receivingTouchdowns') * 6 -
    n('fumblesLost') * 2;
  return round1(pts);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function insertByeWeeks(rows: PlayerGameLogRow[]): PlayerGameLogRow[] {
  const numbered = rows.filter((r) => typeof r.week === 'number') as Array<
    PlayerGameLogRow & { week: number }
  >;
  if (numbered.length === 0) return rows;
  const byWeek = new Map(numbered.map((r) => [r.week, r]));
  const max = Math.max(...numbered.map((r) => r.week));
  const min = Math.min(...numbered.map((r) => r.week));
  const out: PlayerGameLogRow[] = [];
  for (let week = min; week <= max; week++) {
    out.push(
      byWeek.get(week) ?? {
        week,
        opp: 'BYE',
        bye: true,
        cells: {},
      }
    );
  }
  return out;
}

function columnsFor(position: Position): PlayerGameLogColumn[] {
  if (position === 'QB') {
    return [
      { key: 'cmp', label: 'CMP', group: 'passing' },
      { key: 'att', label: 'ATT', group: 'passing' },
      { key: 'passYds', label: 'YDS', group: 'passing' },
      { key: 'passTd', label: 'TD', group: 'passing' },
      { key: 'int', label: 'INT', group: 'passing' },
      { key: 'car', label: 'CAR', group: 'rushing' },
      { key: 'rushYds', label: 'YDS', group: 'rushing' },
      { key: 'rushTd', label: 'TD', group: 'rushing' },
      { key: 'fpts', label: 'FPTS', group: 'common' },
    ];
  }
  if (position === 'K') {
    return [
      { key: 'fg', label: 'FG' },
      { key: 'fga', label: 'FGA' },
      { key: 'xp', label: 'XP' },
      { key: 'fpts', label: 'FPTS' },
    ];
  }
  return [
    { key: 'tgt', label: 'TGT', group: 'receiving' },
    { key: 'rec', label: 'REC', group: 'receiving' },
    { key: 'recYds', label: 'YDS', group: 'receiving' },
    { key: 'recAvg', label: 'AVG', group: 'receiving' },
    { key: 'recTd', label: 'TD', group: 'receiving' },
    { key: 'car', label: 'CAR', group: 'rushing' },
    { key: 'rushYds', label: 'YDS', group: 'rushing' },
    { key: 'rushAvg', label: 'AVG', group: 'rushing' },
    { key: 'rushTd', label: 'TD', group: 'rushing' },
    { key: 'fpts', label: 'FPTS', group: 'common' },
  ];
}

function cellsFromStats(
  stats: Record<string, number | null>,
  position: Position,
  fpts: number | null
): Record<string, number | null> {
  const g = (...keys: string[]) => {
    for (const key of keys) {
      if (stats[key] != null) return stats[key];
    }
    return null;
  };
  if (position === 'QB') {
    return {
      cmp: g('completions'),
      att: g('passingAttempts'),
      passYds: g('passingYards'),
      passTd: g('passingTouchdowns'),
      int: g('interceptions'),
      car: g('rushingAttempts'),
      rushYds: g('rushingYards'),
      rushTd: g('rushingTouchdowns'),
      fpts,
    };
  }
  if (position === 'K') {
    return {
      fg: g('fieldGoalsMade', 'madeFieldGoals'),
      fga: g('fieldGoalAttempts', 'attemptedFieldGoals'),
      xp: g('extraPointsMade', 'madeExtraPoints'),
      fpts,
    };
  }
  return {
    tgt: g('receivingTargets', 'targets'),
    rec: g('receptions'),
    recYds: g('receivingYards'),
    recAvg: g('yardsPerReception'),
    recTd: g('receivingTouchdowns'),
    car: g('rushingAttempts'),
    rushYds: g('rushingYards'),
    rushAvg: g('yardsPerRushAttempt'),
    rushTd: g('rushingTouchdowns'),
    fpts,
  };
}

function regularEvents(payload: EspnGameLogPayload): Array<{ eventId: string; stats: string[] }> {
  const types = payload.seasonTypes ?? [];
  const regular =
    types.find((t) => /regular/i.test(t.displayName ?? '')) ??
    types.find((t) => !/post/i.test(t.displayName ?? '')) ??
    types[0];
  const cats = regular?.categories ?? [];
  const cat =
    cats.find((c) => /regular/i.test(c.displayName ?? '')) ??
    cats.find((c) => (c.events?.length ?? 0) > 0) ??
    cats[0];
  return (cat?.events ?? []).flatMap((ev) =>
    ev.eventId && ev.stats ? [{ eventId: ev.eventId, stats: ev.stats }] : []
  );
}

async function fetchEspnPage(season: number, offset: number): Promise<EspnListPlayer[]> {
  const filter = {
    players: {
      limit: PAGE,
      offset,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'PPR' },
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
  if (!res.ok) throw new Error(`ESPN players ${res.status}`);
  const body = (await res.json()) as EspnListPlayer[] | { players?: EspnListPlayer[] };
  if (Array.isArray(body)) return body;
  return body.players ?? [];
}

async function espnIdIndex(season: number): Promise<Map<string, IdHit>> {
  if (idCache && Date.now() - idCache.at < ID_TTL_MS) return idCache.byName;
  const byName = new Map<string, IdHit>();
  for (let offset = 0; offset < ID_SCAN_LIMIT; offset += PAGE) {
    const page = await fetchEspnPage(season, offset);
    if (page.length === 0) break;
    for (const raw of page) {
      const player = unwrapPlayer(raw);
      const id = player.id;
      const pos = POS_BY_ID[player.defaultPositionId ?? -1];
      const rawName = (player.fullName ?? '').trim();
      if (id == null || !rawName || !pos) continue;
      const playerName = pos === 'D/ST' ? dstName(rawName) : rawName;
      const key = normalizeName(playerName);
      if (!byName.has(key)) byName.set(key, { id, pos });
    }
    if (page.length < PAGE) break;
  }
  if (byName.size >= 50) idCache = { at: Date.now(), byName };
  return byName;
}

type LogPlayer = {
  playerName: string;
  position: Position;
  nflTeam?: string;
  espnId?: number;
};

async function resolveLogPlayer(playerName: string): Promise<LogPlayer | null> {
  const draftSeason = enrichmentStore.latestRankingSeason() ?? new Date().getFullYear();
  const board = await listRankedBoard();
  const key = normalizeName(playerName);
  const onBoard =
    board.find((p) => normalizeName(p.playerName) === key) ??
    board.find(
      (p) =>
        key.length >= 3 &&
        (normalizeName(p.playerName).includes(key) || key.includes(normalizeName(p.playerName)))
    );
  if (onBoard) {
    return {
      playerName: onBoard.playerName,
      position: onBoard.position,
      nflTeam: onBoard.nflTeam,
      espnId: enrichmentStore.getEspnAthleteId(onBoard.playerName, draftSeason),
    };
  }

  const depth = enrichmentStore.getDepthPlayer(playerName, draftSeason);
  const points = enrichmentStore.getSeasonPoints(playerName, draftSeason);
  const name = depth?.playerName ?? points?.playerName;
  const position = (depth?.position ?? points?.position) as Position | undefined;
  if (!name || !position || !LOG_POS.has(position)) return null;
  return {
    playerName: name,
    position,
    nflTeam: depth?.nflTeam ?? points?.nflTeam,
    espnId: depth?.espnId ?? enrichmentStore.getEspnAthleteId(name, draftSeason),
  };
}

async function fetchEspnGameLog(id: number, season: number): Promise<EspnGameLogPayload | null> {
  const urls = [
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}/gamelog?season=${season}`,
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}/gamelog`,
  ];
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) continue;
    const payload = (await res.json()) as EspnGameLogPayload;
    if ((payload.seasonTypes?.length ?? 0) > 0) return payload;
  }
  return null;
}

export function gameLogSeasons(draftSeason: number): number[] {
  return Array.from({ length: 5 }, (_, i) => draftSeason - i);
}

export function resolveGameLogSeason(draftSeason: number, requested?: number): number {
  const min = draftSeason - 4;
  if (requested == null || !Number.isFinite(requested)) return draftSeason;
  return Math.min(draftSeason, Math.max(min, Math.round(requested)));
}

export type SosPosKey = 'overall' | 'qb' | 'rb' | 'wr' | 'te' | 'dst';

export function sosPosKey(position: Position): SosPosKey {
  if (position === 'QB') return 'qb';
  if (position === 'RB') return 'rb';
  if (position === 'WR') return 'wr';
  if (position === 'TE') return 'te';
  if (position === 'D/ST') return 'dst';
  return 'overall';
}

export function buildPlayerSosSlate(nflTeam: string | undefined, position: Position): PlayerSosSlate | undefined {
  const team = canonicalTeam(nflTeam);
  if (!team) return undefined;
  const board = enrichmentStore.listSosBoard();
  const row = board.teams.find((t) => t.team === team);
  if (!row?.games?.length) return undefined;
  const key = sosPosKey(position);
  const group = key === 'overall' ? row.overall : row[key];
  return {
    team: row.team,
    position,
    rank: group?.rank,
    currentWeek: enrichmentStore.currentWeek(),
    weeks: row.games.map((game) => ({
      week: game.week,
      opponent: game.opponent,
      home: game.home,
      bye: game.bye,
      rank: game[key],
    })),
  };
}

function teamForLog(
  playerName: string,
  nflTeam: string | undefined,
  season: number
): string | undefined {
  const listed = canonicalTeam(nflTeam);
  if (listed && listed !== 'FA') return listed;
  return enrichmentStore.rosterTeam(playerName, season);
}

function withSos(log: PlayerGameLog, nflTeam: string | undefined, position: Position): PlayerGameLog {
  const { sosSlate: _ignored, ...rest } = log;
  return { ...rest, sosSlate: buildPlayerSosSlate(nflTeam, position) };
}

function cacheLog(
  cacheKey: string,
  log: PlayerGameLog,
  nflTeam: string | undefined,
  position: Position,
): PlayerGameLog {
  logCache.set(cacheKey, { at: Date.now(), log, nflTeam, position });
  return withSos(log, nflTeam, position);
}

export async function buildPlayerGameLog(
  playerName: string,
  requestedSeason?: number
): Promise<PlayerGameLog | null> {
  await enrichmentStore.load();
  const draftSeason = enrichmentStore.latestRankingSeason() ?? new Date().getFullYear();
  const season = resolveGameLogSeason(draftSeason, requestedSeason);
  const seasons = gameLogSeasons(draftSeason);
  const cacheKey = `${normalizeName(playerName)}::${season}`;
  const cached = logCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LOG_TTL_MS) {
    return withSos(cached.log, teamForLog(cached.log.playerName, cached.nflTeam, draftSeason), cached.position);
  }

  const player = await resolveLogPlayer(playerName);
  if (!player) return null;

  const columns = columnsFor(player.position);
  const empty = (note: string): PlayerGameLog => ({
    playerName: player.playerName,
    season,
    seasons,
    position: player.position,
    columns,
    rows: [],
    previewRows: PREVIEW_ROWS,
    note,
  });

  if (player.position === 'D/ST') {
    const log = empty('Game log isn’t available for D/ST.');
    return cacheLog(cacheKey, log, teamForLog(player.playerName, player.nflTeam, draftSeason), player.position);
  }

  let athleteId = player.espnId;
  if (athleteId == null || athleteId <= 0) {
    const ids = await espnIdIndex(draftSeason);
    const key = normalizeName(player.playerName);
    const hit =
      ids.get(key) ??
      [...ids.entries()].find(([name]) => name.includes(key) || key.includes(name))?.[1];
    athleteId = hit?.id;
  }
  if (athleteId == null || athleteId <= 0) {
    const log = empty(`No ${season} NFL games on ESPN.`);
    return cacheLog(cacheKey, log, teamForLog(player.playerName, player.nflTeam, draftSeason), player.position);
  }

  const payload = await fetchEspnGameLog(athleteId, season);
  if (!payload) {
    const log = empty(`No ${season} NFL games on ESPN.`);
    return cacheLog(cacheKey, log, teamForLog(player.playerName, player.nflTeam, draftSeason), player.position);
  }

  const names = payload.names ?? [];
  const events = payload.events ?? {};
  const rows = insertByeWeeks(
    regularEvents(payload).map((ev) => {
      const meta = events[ev.eventId] ?? {};
      const stats = statMap(names, ev.stats);
      const fpts = pprPoints(stats, player.position);
      const abbr = meta.opponent?.abbreviation ?? '';
      const away = meta.atVs === '@';
      return {
        week: meta.week ?? 0,
        opp: away && abbr ? `@${abbr}` : abbr,
        bye: false,
        cells: cellsFromStats(stats, player.position, fpts),
        fpts: fpts ?? undefined,
      };
    })
  );

  const log: PlayerGameLog = {
    playerName: player.playerName,
    season,
    seasons,
    position: player.position,
    columns,
    rows,
    previewRows: PREVIEW_ROWS,
    note: rows.length === 0 ? `No ${season} NFL games on ESPN.` : undefined,
  };
  return cacheLog(cacheKey, log, teamForLog(player.playerName, player.nflTeam, draftSeason), player.position);
}
