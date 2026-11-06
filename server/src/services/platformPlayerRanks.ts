import fs from 'fs/promises';
import path from 'path';
import { normalizeName } from '../data/enrichment';
import { enrichmentDir } from '../data/store';
import type { PlatformRatingCell, PlayerPlatformRatings, Position } from '../types';
import { enrichmentStore } from '../data/enrichment';

export type PlatformId = 'espn' | 'sleeper' | 'cbs';

export interface PlatformPlayerRankPair {
  week?: number;
  ros?: number;
}

export interface PlatformPlayerRanksFile {
  season: number;
  currentWeek: number;
  scoring: 'PPR';
  /** Ranks are positional (QB1 / RB1 / …), not overall. */
  rankScope: 'positional';
  fetchedAt: string;
  /** normalizeName(player) → per-platform week + ROS positional ranks (1 = best at pos). */
  byPlayer: Record<string, Partial<Record<PlatformId, PlatformPlayerRankPair>>>;
}

export function committedPlatformPlayerRanksPath(season: number): string {
  return path.join(enrichmentDir(), `platform-player-ranks-${season}.json`);
}

export async function readPlatformPlayerRanks(
  season: number
): Promise<PlatformPlayerRanksFile | null> {
  try {
    const raw = await fs.readFile(committedPlatformPlayerRanksPath(season), 'utf-8');
    const data = JSON.parse(raw) as PlatformPlayerRanksFile;
    if (!data?.byPlayer || typeof data.byPlayer !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

function cell(rank: number | undefined): PlatformRatingCell | undefined {
  if (rank == null) return undefined;
  return { rank };
}

/** Look up committed per-player week/ROS positional ranks for the bio ratings grid. */
export async function buildPlayerPlatformRatings(
  playerName: string,
  _nflTeam: string | undefined,
  position: Position,
  season: number
): Promise<PlayerPlatformRatings> {
  const currentWeek = enrichmentStore.currentWeek();
  const file = await readPlatformPlayerRanks(season);
  const entry = file?.byPlayer[normalizeName(playerName)] ?? {};

  const platforms: PlatformId[] = ['espn', 'sleeper', 'cbs'];
  const ros: PlayerPlatformRatings['ros'] = {};
  const week: PlayerPlatformRatings['week'] = {};
  for (const id of platforms) {
    const pair = entry[id];
    ros[id] = cell(pair?.ros);
    week[id] = cell(pair?.week);
  }

  // D/ST / K were added to the platform scrape later — until the next weekly
  // refresh, fall back to ESPN draft positional rank for the import host.
  if (position === 'D/ST' || position === 'K') {
    const espnPos = enrichmentStore.getEspnPosRank(playerName, position);
    if (espnPos != null && espnPos > 0) {
      if (!ros.espn) ros.espn = cell(espnPos);
      if (!week.espn) week.espn = cell(espnPos);
    }
  }

  return { currentWeek, ros, week };
}
