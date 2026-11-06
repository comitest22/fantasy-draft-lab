import { enrichmentStore } from '../data/enrichment';
import type {
  EspnTeamSummary,
  LineupSlot,
  MyTeamFile,
  MyTeamPlayer,
  Position,
} from '../types';

const ESPN_LEAGUE_BASE =
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

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

const POS_BY_ID: Record<number, Position> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

/** ESPN FFL lineupSlotId → display slot. */
const LINEUP_SLOT_BY_ID: Record<number, LineupSlot> = {
  0: 'QB',
  2: 'RB',
  3: 'FLEX',
  4: 'WR',
  5: 'FLEX',
  6: 'TE',
  7: 'FLEX',
  16: 'D/ST',
  17: 'K',
  20: 'BE',
  21: 'IR',
  23: 'FLEX',
};

const SLOT_ORDER: LineupSlot[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'FLEX',
  'D/ST',
  'K',
  'BE',
  'IR',
  'UNKNOWN',
];

export const DEFAULT_ESPN_LEAGUE_ID = 1735901;

export class EspnLeagueError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'EspnLeagueError';
    this.status = status;
  }
}

export interface EspnAuth {
  espnS2: string;
  swid: string;
}

interface EspnPlayerInfo {
  id?: number;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  injuryStatus?: string;
}

interface EspnPlayerPoolEntry {
  id?: number;
  playerId?: number;
  lineupSlotId?: number;
  player?: EspnPlayerInfo;
  /** ESPN often nests the player here on mRoster. */
  playerPoolEntry?: {
    id?: number;
    player?: EspnPlayerInfo;
  };
}

interface EspnTeamEntry {
  id?: number;
  abbrev?: string;
  location?: string;
  nickname?: string;
  name?: string;
  roster?: {
    entries?: EspnPlayerPoolEntry[];
  };
}

interface EspnLeaguePayload {
  id?: number;
  teams?: EspnTeamEntry[];
}

function normalizeSwid(swid: string): string {
  const trimmed = swid.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  return `{${trimmed}}`;
}

function teamDisplayName(team: EspnTeamEntry): string {
  if (team.name?.trim()) return team.name.trim();
  const loc = team.location?.trim() ?? '';
  const nick = team.nickname?.trim() ?? '';
  const combined = `${loc} ${nick}`.trim();
  return combined || team.abbrev?.trim() || `Team ${team.id ?? '?'}`;
}

function dstName(name: string): string {
  const cleaned = name.replace(/\s+D\/ST$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const nick = parts[parts.length - 1] ?? cleaned;
  return `${nick} D/ST`;
}

function mapPlayer(entry: EspnPlayerPoolEntry): MyTeamPlayer | null {
  const player = entry.player ?? entry.playerPoolEntry?.player;
  const espnId =
    player?.id ?? entry.playerId ?? entry.playerPoolEntry?.id ?? entry.id;
  if (espnId == null) return null;

  const posId = player?.defaultPositionId ?? -1;
  const position = POS_BY_ID[posId] ?? 'RB';
  const rawName = player?.fullName?.trim() || `Player ${espnId}`;
  const name = position === 'D/ST' ? dstName(rawName) : rawName;
  const lineupSlotId = entry.lineupSlotId ?? 20;
  const lineupSlot = LINEUP_SLOT_BY_ID[lineupSlotId] ?? 'UNKNOWN';
  const nflTeam =
    position === 'D/ST'
      ? ESPN_TEAM[player?.proTeamId ?? 0] ?? ''
      : ESPN_TEAM[player?.proTeamId ?? 0] ?? 'FA';
  const espnStatus = player?.injuryStatus?.trim();
  const fallback = enrichmentStore.getPlayerStatus(name);
  const status = espnStatus || fallback || undefined;

  return {
    espnId,
    name,
    nflTeam,
    position,
    lineupSlot,
    lineupSlotId,
    ...(status && status.toUpperCase() !== 'ACTIVE' ? { status } : {}),
  };
}

function sortPlayers(players: MyTeamPlayer[]): MyTeamPlayer[] {
  return [...players].sort((a, b) => {
    const slotDiff =
      SLOT_ORDER.indexOf(a.lineupSlot) - SLOT_ORDER.indexOf(b.lineupSlot);
    if (slotDiff !== 0) return slotDiff;
    return a.lineupSlotId - b.lineupSlotId || a.name.localeCompare(b.name);
  });
}

function parseRoster(team: EspnTeamEntry): MyTeamPlayer[] {
  const entries = team.roster?.entries ?? [];
  const players: MyTeamPlayer[] = [];
  for (const entry of entries) {
    const mapped = mapPlayer(entry);
    if (mapped) players.push(mapped);
  }
  return sortPlayers(players);
}

export async function fetchEspnLeague(
  leagueId: number,
  season: number,
  auth: EspnAuth
): Promise<EspnLeaguePayload> {
  const espnS2 = auth.espnS2.trim();
  const swid = normalizeSwid(auth.swid);
  if (!espnS2 || !swid || swid === '{}') {
    throw new EspnLeagueError(
      'ESPN cookies required: paste espn_s2 and SWID, or set ESPN_S2 / ESPN_SWID in .env.',
      401
    );
  }

  const url = `${ESPN_LEAGUE_BASE}/${season}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster`;
  const res = await fetch(url, {
    headers: {
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new EspnLeagueError(
      'ESPN rejected the cookies (401/403). Re-copy espn_s2 and SWID from fantasy.espn.com while logged in.',
      res.status
    );
  }
  if (res.status === 404) {
    throw new EspnLeagueError(
      `League ${leagueId} not found for season ${season}. Check league ID and year.`,
      404
    );
  }
  if (!res.ok) {
    throw new EspnLeagueError(`ESPN league fetch failed (${res.status}).`, res.status);
  }

  return (await res.json()) as EspnLeaguePayload;
}

export function listEspnTeams(payload: EspnLeaguePayload): EspnTeamSummary[] {
  const teams = payload.teams ?? [];
  return teams
    .filter((t) => t.id != null)
    .map((t) => ({
      teamId: t.id!,
      name: teamDisplayName(t),
      abbrev: t.abbrev,
      playerCount: t.roster?.entries?.length ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findEspnTeam(
  payload: EspnLeaguePayload,
  teamId: number
): EspnTeamEntry | null {
  return payload.teams?.find((t) => t.id === teamId) ?? null;
}

export function suggestTeamId(
  teams: EspnTeamSummary[],
  preferredName?: string
): number | null {
  if (teams.length === 0) return null;
  if (preferredName) {
    const want = preferredName.trim().toLowerCase();
    const exact = teams.find((t) => t.name.toLowerCase() === want);
    if (exact) return exact.teamId;
    const partial = teams.find(
      (t) =>
        t.name.toLowerCase().includes(want) || want.includes(t.name.toLowerCase())
    );
    if (partial) return partial.teamId;
  }
  return teams[0]?.teamId ?? null;
}

export function buildMyTeamFile(opts: {
  leagueId: number;
  season: number;
  team: EspnTeamEntry;
  previous?: MyTeamFile | null;
}): MyTeamFile {
  const now = new Date().toISOString();
  const teamId = opts.team.id;
  if (teamId == null) {
    throw new EspnLeagueError('Selected ESPN team is missing an id.');
  }
  return {
    season: opts.season,
    platform: 'espn',
    leagueId: opts.leagueId,
    teamId,
    teamName: teamDisplayName(opts.team),
    importedAt: opts.previous?.importedAt ?? now,
    refreshedAt: now,
    players: parseRoster(opts.team),
  };
}

export function rosterForTeam(
  payload: EspnLeaguePayload,
  teamId: number
): { teamName: string; players: MyTeamPlayer[] } | null {
  const team = findEspnTeam(payload, teamId);
  if (!team) return null;
  return {
    teamName: teamDisplayName(team),
    players: parseRoster(team),
  };
}
