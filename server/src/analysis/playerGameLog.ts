import { listRankedBoard } from './draftRoutes';
import {
  canonicalTeam,
  dstTeamFromName,
  enrichmentStore,
  normalizeName,
} from '../data/enrichment';
import {
  buildEspnOprkSlateFromMatrix,
  readCommittedEspnOprkMatrix,
  type EspnOprkMatrix,
} from '../services/espnOprk';
import { invertDefenseRank } from './tdMatchup';
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

/** ESPN fantasy proTeamId → abbr (same map as espnLeague / espnOprk). */
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

const ABBR_TO_ESPN_PRO: Record<string, number> = Object.fromEntries(
  Object.entries(ESPN_TEAM).map(([id, abbr]) => [abbr, Number(id)])
);

/** ESPN fantasy D/ST stat ids (cwendt94/espn-api PLAYER_STATS_MAP). */
const DST_STAT = {
  td: 105,
  int: 95,
  fr: 96,
  sck: 99,
  sfty: 98,
  blk: 97,
  pa: 187,
  paAlt: 120,
  ya: 127,
} as const;

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

/**
 * ESPN kicker (and similar) logs use keys like `fieldGoalsMade-fieldGoalAttempts`
 * with values `4-5`. Split those into separate made / attempt numbers.
 */
export function expandMadeAttemptPairs(
  names: string[],
  stats: string[],
  mapped: Record<string, number | null>
): Record<string, number | null> {
  const out = { ...mapped };
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    const raw = stats[i];
    if (!key || raw == null) continue;
    const dash = key.indexOf('-');
    if (dash <= 0 || dash >= key.length - 1) continue;
    const m = String(raw).match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const madeKey = key.slice(0, dash);
    const attKey = key.slice(dash + 1);
    const made = Number(m[1]);
    const att = Number(m[2]);
    if (Number.isFinite(made)) out[madeKey] = made;
    if (Number.isFinite(att)) out[attKey] = att;
  }
  return out;
}

export function statMap(names: string[], stats: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    if (!key) continue;
    out[key] = parseNum(stats[i]);
  }
  return expandMadeAttemptPairs(names, stats, out);
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
    // ESPN site gamelog often exposes NFL kicking points as totalKickingPoints.
    const kickingPts = stats.totalKickingPoints;
    if (kickingPts != null) return round1(kickingPts);
    const fg = n('fieldGoalsMade', 'madeFieldGoals');
    const xp = n('extraPointsMade', 'madeExtraPoints');
    if (
      stats.fieldGoalsMade == null &&
      stats.madeFieldGoals == null &&
      stats.extraPointsMade == null &&
      stats.madeExtraPoints == null
    ) {
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

type SchedulePadGame = {
  week: number;
  opponent?: string;
  home?: boolean;
  bye?: boolean;
};

/**
 * Merge played log rows with the team schedule so upcoming weeks show the
 * opponent with empty cells (UI renders —). Bye weeks stay marked bye.
 */
export function mergeLogWithSchedule(
  rows: PlayerGameLogRow[],
  schedule: SchedulePadGame[]
): PlayerGameLogRow[] {
  const numbered = rows.filter((r) => typeof r.week === 'number' && r.week > 0) as Array<
    PlayerGameLogRow & { week: number }
  >;
  const byWeek = new Map(numbered.map((r) => [r.week, r]));
  if (schedule.length === 0) return insertByeWeeks(rows);

  const maxWeek = Math.max(
    18,
    ...schedule.map((g) => g.week),
    ...numbered.map((r) => r.week)
  );
  const out: PlayerGameLogRow[] = [];
  for (let week = 1; week <= maxWeek; week++) {
    const existing = byWeek.get(week);
    if (existing) {
      out.push(existing);
      continue;
    }
    const game = schedule.find((g) => g.week === week);
    if (!game || game.bye || !game.opponent) {
      out.push({ week, opp: 'BYE', bye: true, cells: {} });
      continue;
    }
    const opp = game.home === false ? `@${game.opponent}` : game.opponent;
    out.push({ week, opp, bye: false, cells: {} });
  }
  return out;
}

function finalizeLogRows(
  rows: PlayerGameLogRow[],
  nflTeam: string | undefined,
  season: number,
  draftSeason: number
): PlayerGameLogRow[] {
  // Only the in-progress draft season has a matching schedule file.
  if (season === draftSeason) {
    return mergeLogWithSchedule(rows, enrichmentStore.getTeamSchedule(nflTeam));
  }
  return insertByeWeeks(rows);
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
  if (position === 'D/ST') {
    return [
      { key: 'td', label: 'TD' },
      { key: 'int', label: 'INT' },
      { key: 'fr', label: 'FR' },
      { key: 'sck', label: 'SCK' },
      { key: 'sfty', label: 'SFTY' },
      { key: 'blk', label: 'BLK' },
      { key: 'pa', label: 'PA' },
      { key: 'ya', label: 'YA' },
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

/** Map ESPN fantasy D/ST week `stats` object → game-log cells. */
export function cellsFromDstFantasyStats(
  stats: Record<string, number | undefined> | undefined,
  fpts: number | null
): Record<string, number | null> {
  const n = (id: number) => {
    const v = stats?.[String(id)];
    return v != null && Number.isFinite(v) ? v : null;
  };
  const pa = n(DST_STAT.pa) ?? n(DST_STAT.paAlt);
  return {
    td: n(DST_STAT.td),
    int: n(DST_STAT.int),
    fr: n(DST_STAT.fr),
    sck: n(DST_STAT.sck),
    sfty: n(DST_STAT.sfty),
    blk: n(DST_STAT.blk),
    pa,
    ya: n(DST_STAT.ya),
    fpts,
  };
}

/** Fantasy D/ST player id: `-(16000 + proTeamId)` (e.g. JAX 30 → -16030). */
export function dstFantasyEspnId(nflTeam: string | undefined): number | undefined {
  const abbr = canonicalTeam(nflTeam);
  if (!abbr) return undefined;
  const proId = ABBR_TO_ESPN_PRO[abbr];
  if (proId == null) return undefined;
  return -(16000 + proId);
}

export function cellsFromStats(
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
      fuml: g('fumblesLost'),
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
      xpa: g('extraPointAttempts', 'attemptedExtraPoints'),
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
    fuml: g('fumblesLost'),
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

function resolveDstTeam(playerName: string, nflTeam?: string): string | undefined {
  const listed = canonicalTeam(nflTeam);
  if (listed && listed !== 'FA') return listed;
  return dstTeamFromName(playerName);
}

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
    const nflTeam =
      onBoard.position === 'D/ST'
        ? resolveDstTeam(onBoard.playerName, onBoard.nflTeam)
        : onBoard.nflTeam;
    return {
      playerName: onBoard.playerName,
      position: onBoard.position,
      nflTeam,
      espnId:
        onBoard.position === 'D/ST'
          ? dstFantasyEspnId(nflTeam)
          : enrichmentStore.getEspnAthleteId(onBoard.playerName, draftSeason),
    };
  }

  const depth = enrichmentStore.getDepthPlayer(playerName, draftSeason);
  const points = enrichmentStore.getSeasonPoints(playerName, draftSeason);
  const name = depth?.playerName ?? points?.playerName ?? (/D\/ST$/i.test(playerName) ? dstName(playerName) : undefined);
  const position = (depth?.position ?? points?.position ?? (/D\/ST$/i.test(playerName) ? 'D/ST' : undefined)) as
    | Position
    | undefined;
  if (!name || !position || !LOG_POS.has(position)) return null;
  const nflTeam =
    position === 'D/ST'
      ? resolveDstTeam(name, depth?.nflTeam ?? points?.nflTeam)
      : depth?.nflTeam ?? points?.nflTeam;
  return {
    playerName: name,
    position,
    nflTeam,
    espnId:
      position === 'D/ST'
        ? dstFantasyEspnId(nflTeam)
        : depth?.espnId ?? enrichmentStore.getEspnAthleteId(name, draftSeason),
  };
}

async function fetchEspnGameLog(id: number, season: number): Promise<EspnGameLogPayload | null> {
  // Season-scoped only. The bare /gamelog URL returns ESPN’s latest season with
  // games (often prior year), which wrongly fills Stats for players with no YTD.
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}/gamelog?season=${season}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as EspnGameLogPayload;
  if ((payload.seasonTypes?.length ?? 0) === 0) return null;
  return payload;
}

type EspnFantasyWeekStat = {
  seasonId?: number;
  scoringPeriodId?: number;
  statSourceId?: number;
  statSplitTypeId?: number;
  appliedTotal?: number;
  stats?: Record<string, number>;
};

type EspnFantasyPlayerPayload = {
  players?: Array<{
    id?: number;
    player?: {
      id?: number;
      proTeamId?: number;
      stats?: EspnFantasyWeekStat[];
    };
  }>;
};

async function fetchEspnDstFantasyWeeks(
  fantasyId: number,
  season: number
): Promise<EspnFantasyWeekStat[]> {
  const filter = {
    players: {
      filterIds: { value: [fantasyId] },
      limit: 1,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
    `/segments/0/leaguedefaults/3?view=kona_player_info&scoringPeriodId=0`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'fantasy-draft-lab',
      'x-fantasy-filter': JSON.stringify(filter),
    },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as EspnFantasyPlayerPayload | NonNullable<EspnFantasyPlayerPayload['players']>;
  const players = Array.isArray(body) ? body : body.players ?? [];
  const stats = players[0]?.player?.stats ?? [];
  return stats.filter(
    (s) =>
      s.seasonId === season &&
      s.statSourceId === 0 &&
      s.statSplitTypeId === 1 &&
      typeof s.scoringPeriodId === 'number' &&
      s.scoringPeriodId >= 1 &&
      s.scoringPeriodId <= 18
  );
}

function dstOppLabel(nflTeam: string | undefined, week: number): string {
  const game = enrichmentStore.getScheduleGame(nflTeam, week);
  if (!game || game.bye || !game.opponent) return '';
  return game.home === false ? `@${game.opponent}` : game.opponent;
}

async function buildDstGameLogRows(
  fantasyId: number,
  season: number,
  nflTeam: string | undefined,
  draftSeason: number
): Promise<PlayerGameLogRow[]> {
  const weeks = await fetchEspnDstFantasyWeeks(fantasyId, season);
  const byWeek = new Map<number, EspnFantasyWeekStat>();
  for (const week of weeks) {
    const w = week.scoringPeriodId!;
    // Prefer the entry with the richer stats map when duplicates appear.
    const prev = byWeek.get(w);
    if (!prev || Object.keys(week.stats ?? {}).length > Object.keys(prev.stats ?? {}).length) {
      byWeek.set(w, week);
    }
  }
  const rows: PlayerGameLogRow[] = [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, stat]) => {
      const fpts =
        stat.appliedTotal != null && Number.isFinite(stat.appliedTotal)
          ? round1(stat.appliedTotal)
          : null;
      return {
        week,
        opp: dstOppLabel(nflTeam, week),
        bye: false,
        cells: cellsFromDstFantasyStats(stat.stats, fpts),
        fpts: fpts ?? undefined,
      };
    });
  return finalizeLogRows(rows, nflTeam, season, draftSeason);
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

/**
 * Fallback My Team “ESPN” strip when the live/committed OPRK matrix is missing.
 * Same inputs as Lineup OPRK (raw Source B, 1 = easiest; no Off/OL), inverted to
 * OPRK scale (1 = toughest) so the UI can treat the slate as `scale: 'oprk'`.
 */
export function buildEspnStyleOprkSlate(
  nflTeam: string | undefined,
  position: Position
): PlayerSosSlate | undefined {
  const team = canonicalTeam(nflTeam);
  if (!team) return undefined;
  const board = enrichmentStore.listSosBoard();
  const row = board.teams.find((t) => t.team === team);
  if (!row?.games?.length) return undefined;

  return {
    team: row.team,
    position,
    currentWeek: enrichmentStore.currentWeek(),
    weeks: row.games.map((game) => {
      let rank: number | undefined;
      if (!game.bye && game.opponent) {
        if (position === 'D/ST') {
          rank = enrichmentStore.getOppOffenseRank(team, game.week);
        } else if (position !== 'K') {
          rank = enrichmentStore.getOppPosDefenseRank(team, game.week, position);
        }
      }
      return {
        week: game.week,
        opponent: game.opponent,
        home: game.home,
        bye: game.bye,
        rank: invertDefenseRank(rank),
      };
    }),
  };
}

function teamForLog(
  playerName: string,
  nflTeam: string | undefined,
  season: number
): string | undefined {
  const listed = canonicalTeam(nflTeam);
  if (listed && listed !== 'FA') return listed;
  return dstTeamFromName(playerName) ?? enrichmentStore.rosterTeam(playerName, season);
}

let oprkMatrixCache: { season: number; at: number; matrix: EspnOprkMatrix | null } | null = null;

async function loadOprkMatrix(season: number): Promise<EspnOprkMatrix | null> {
  if (
    oprkMatrixCache &&
    oprkMatrixCache.season === season &&
    Date.now() - oprkMatrixCache.at < LOG_TTL_MS
  ) {
    return oprkMatrixCache.matrix;
  }
  const matrix = await readCommittedEspnOprkMatrix(season);
  oprkMatrixCache = { season, at: Date.now(), matrix };
  return matrix;
}

async function withSos(
  log: PlayerGameLog,
  nflTeam: string | undefined,
  position: Position,
  draftSeason: number
): Promise<PlayerGameLog> {
  const { sosSlate: _s, oprkSlate: _o, ...rest } = log;
  const sosSlate = buildPlayerSosSlate(nflTeam, position);
  const matrix = await loadOprkMatrix(draftSeason);
  const oprkSlate = matrix
    ? buildEspnOprkSlateFromMatrix(nflTeam, position, matrix)
    : undefined;
  return { ...rest, sosSlate, oprkSlate };
}

async function cacheLog(
  cacheKey: string,
  log: PlayerGameLog,
  nflTeam: string | undefined,
  position: Position,
  draftSeason: number
): Promise<PlayerGameLog> {
  logCache.set(cacheKey, { at: Date.now(), log, nflTeam, position });
  return withSos(log, nflTeam, position, draftSeason);
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
    return withSos(
      cached.log,
      teamForLog(cached.log.playerName, cached.nflTeam, draftSeason),
      cached.position,
      draftSeason
    );
  }

  let player = await resolveLogPlayer(playerName);
  if (!player) {
    // Enrichment may have been mid-reload (empty maps); wait and retry once.
    await enrichmentStore.load();
    player = await resolveLogPlayer(playerName);
  }
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

  const team = teamForLog(player.playerName, player.nflTeam, draftSeason);

  if (player.position === 'D/ST') {
    let fantasyId = player.espnId;
    if (fantasyId == null || fantasyId >= 0) {
      fantasyId = dstFantasyEspnId(team ?? player.nflTeam);
    }
    if (fantasyId == null || fantasyId >= 0) {
      const ids = await espnIdIndex(draftSeason);
      const key = normalizeName(player.playerName);
      const hit =
        ids.get(key) ??
        [...ids.entries()].find(([name]) => name.includes(key) || key.includes(name))?.[1];
      if (hit?.id != null && hit.id < 0) fantasyId = hit.id;
    }
    if (fantasyId == null || fantasyId >= 0) {
      const log = empty(`No ${season} NFL games on ESPN.`);
      return cacheLog(cacheKey, log, team, player.position, draftSeason);
    }
    const rows = await buildDstGameLogRows(
      fantasyId,
      season,
      team ?? player.nflTeam,
      draftSeason
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
    return cacheLog(cacheKey, log, team, player.position, draftSeason);
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
    return cacheLog(cacheKey, log, team, player.position, draftSeason);
  }

  const payload = await fetchEspnGameLog(athleteId, season);
  if (!payload) {
    const log = empty(`No ${season} NFL games on ESPN.`);
    return cacheLog(cacheKey, log, team, player.position, draftSeason);
  }

  const names = payload.names ?? [];
  const events = payload.events ?? {};
  const played = regularEvents(payload).map((ev) => {
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
  });
  const rows = finalizeLogRows(played, team ?? player.nflTeam, season, draftSeason);

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
  return cacheLog(cacheKey, log, team, player.position, draftSeason);
}
