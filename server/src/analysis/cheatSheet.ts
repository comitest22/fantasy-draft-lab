import { draftRounds, listRankedBoard } from './draftRoutes';
import { enrichmentStore, normalizeName } from '../data/enrichment';
import { readLeagueConfig } from '../data/store';
import type { Position, RankedPlayer, RosterSettings } from '../types';

export type CheatSheetScoring = 'ppr' | 'standard';

export interface CheatSheet {
  scoring: CheatSheetScoring;
  season: number;
  source: string;
  note?: string;
  leagueSize: number;
  suggestedSlot: number;
  rounds: number;
  roster: RosterSettings;
  players: RankedPlayer[];
}

const PAGE = 100;
const MAX_RANK = 300;
const STANDARD_TTL_MS = 10 * 60 * 1000;

const POS_BY_ID: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
};

type EspnPlayer = {
  fullName?: string;
  defaultPositionId?: number;
  player?: EspnPlayer;
  draftRanksByRankType?: Record<string, { rank?: number; published?: boolean }>;
};

let standardCache: { at: number; ranks: Map<string, number> } | null = null;

function dstName(name: string): string {
  const cleaned = name.replace(/\s+D\/ST$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  const nick = parts[parts.length - 1] ?? cleaned;
  return `${nick} D/ST`;
}

function unwrapPlayer(player: EspnPlayer): EspnPlayer {
  if (!player.player) return player;
  return { ...player.player, ...player, player: undefined };
}

function standardRankOf(player: EspnPlayer): number | undefined {
  const ranks = player.draftRanksByRankType;
  if (!ranks) return undefined;
  const direct = ranks.STANDARD?.rank;
  if (direct != null && Number.isFinite(direct)) return direct;
  for (const [key, val] of Object.entries(ranks)) {
    if (key.toUpperCase() === 'PPR') continue;
    if (val?.rank != null && Number.isFinite(val.rank)) return val.rank;
  }
  return undefined;
}

async function fetchEspnPage(season: number, offset: number): Promise<EspnPlayer[]> {
  const filter = {
    players: {
      limit: PAGE,
      offset,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' },
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

async function fetchStandardRanks(season: number): Promise<Map<string, number>> {
  if (standardCache && Date.now() - standardCache.at < STANDARD_TTL_MS) {
    return standardCache.ranks;
  }
  const ranks = new Map<string, number>();
  for (let offset = 0; offset < 800; offset += PAGE) {
    const page = await fetchEspnPage(season, offset);
    if (page.length === 0) break;
    let lastRank = 0;
    for (const raw of page) {
      const player = unwrapPlayer(raw);
      const pos = POS_BY_ID[player.defaultPositionId ?? -1];
      const rawName = (player.fullName ?? '').trim();
      const rank = standardRankOf(player);
      if (!rawName || !pos || rank == null || rank < 1 || rank > MAX_RANK) continue;
      const playerName = pos === 'D/ST' ? dstName(rawName) : rawName;
      if (/tqb$/i.test(playerName)) continue;
      const key = normalizeName(playerName);
      if (!ranks.has(key)) ranks.set(key, rank);
      lastRank = rank;
    }
    if (page.length < PAGE || lastRank > MAX_RANK) break;
  }
  if (ranks.size >= 50) {
    standardCache = { at: Date.now(), ranks };
  }
  return ranks;
}

function applyPosRanks(players: RankedPlayer[]): RankedPlayer[] {
  const counts: Partial<Record<Position, number>> = {};
  return players.map((p) => {
    const n = (counts[p.position] ?? 0) + 1;
    counts[p.position] = n;
    return { ...p, posRank: n };
  });
}

function leagueRoster(config: Awaited<ReturnType<typeof readLeagueConfig>>): RosterSettings {
  return {
    qb: config.roster?.qb ?? 1,
    rb: config.roster?.rb ?? 2,
    wr: config.roster?.wr ?? 2,
    te: config.roster?.te ?? 1,
    flex: config.roster?.flex ?? 1,
    superflex: config.roster?.superflex ?? 0,
    dst: config.roster?.dst ?? 1,
    k: config.roster?.k ?? 1,
    bench: config.roster?.bench ?? 5,
  };
}

export async function buildCheatSheet(scoring: CheatSheetScoring): Promise<CheatSheet> {
  const config = await readLeagueConfig();
  const board = await listRankedBoard();
  await enrichmentStore.load();
  const season = enrichmentStore.latestRankingSeason() ?? new Date().getFullYear();
  const rounds = draftRounds(config);
  const leagueSize = config.leagueSize;
  const suggestedSlot = Math.min(
    Math.max(1, config.upcomingDraftSlot ?? 8),
    Math.max(1, leagueSize)
  );
  const roster = leagueRoster(config);

  if (scoring !== 'standard') {
    return {
      scoring: 'ppr',
      season,
      source: 'ESPN PPR overall',
      leagueSize,
      suggestedSlot,
      rounds,
      roster,
      players: board,
    };
  }

  let note: string | undefined;
  let players = board;
  try {
    const ranks = await fetchStandardRanks(season);
    if (ranks.size < 50) {
      note = 'ESPN Standard ranks were thin — showing PPR order.';
    } else {
      const matched = board
        .map((p) => {
          const std = ranks.get(normalizeName(p.playerName));
          if (std == null) return null;
          return {
            ...p,
            rank: std,
            ...(p.ecr != null
              ? { espnMinusEcr: Math.round((std - p.ecr) * 10) / 10 }
              : {}),
          };
        })
        .filter((p): p is RankedPlayer => p != null)
        .sort((a, b) => a.rank - b.rank || a.playerName.localeCompare(b.playerName));
      if (matched.length < 50) {
        note = 'ESPN Standard ranks did not match this board — showing PPR order.';
      } else {
        players = applyPosRanks(matched);
      }
    }
  } catch {
    note = 'Could not load ESPN Standard ranks — showing PPR order.';
  }

  return {
    scoring: 'standard',
    season,
    source: note ? 'ESPN PPR overall' : 'ESPN Standard overall',
    note,
    leagueSize,
    suggestedSlot,
    rounds,
    roster,
    players,
  };
}
