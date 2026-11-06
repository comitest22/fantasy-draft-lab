import fs from 'fs/promises';
import path from 'path';
import { enrichmentDir } from '../data/store';
import type { PlatformRatingCell, Position } from '../types';
import {
  buildEspnOprkSlateFromMatrix,
  matrixFromRatings,
  matrixToRatings,
  type EspnOprkMatrix,
} from './espnOprk';

export type PlatformOprkMatrix = EspnOprkMatrix;

export interface PlatformOprkFile {
  season: number;
  /** Through-week / scoring period when fetched (informational). */
  scoringPeriodId?: number;
  source: 'sleeper' | 'cbs';
  fetchedAt: string;
  /** position → opponent abbrev → OPRK (1 = toughest). */
  ratings: Record<string, Record<string, number>>;
}

export function committedSleeperOprkPath(season: number): string {
  return path.join(enrichmentDir(), `sleeper-oprk-${season}.json`);
}

export function committedCbsOprkPath(season: number): string {
  return path.join(enrichmentDir(), `cbs-oprk-${season}.json`);
}

export async function readCommittedPlatformOprkMatrix(
  filePath: string
): Promise<PlatformOprkMatrix | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as PlatformOprkFile;
    const matrix = matrixFromRatings(data.ratings);
    return matrix.size > 0 ? matrix : null;
  } catch {
    return null;
  }
}

export async function readCommittedSleeperOprkMatrix(
  season: number
): Promise<PlatformOprkMatrix | null> {
  return readCommittedPlatformOprkMatrix(committedSleeperOprkPath(season));
}

export async function readCommittedCbsOprkMatrix(
  season: number
): Promise<PlatformOprkMatrix | null> {
  return readCommittedPlatformOprkMatrix(committedCbsOprkPath(season));
}

export function platformOprkFilePayload(
  season: number,
  source: 'sleeper' | 'cbs',
  matrix: PlatformOprkMatrix,
  scoringPeriodId?: number
): PlatformOprkFile {
  return {
    season,
    scoringPeriodId,
    source,
    fetchedAt: new Date().toISOString(),
    ratings: matrixToRatings(matrix),
  };
}

/** Build ROS + current-week rating cells from an OPRK-style matrix (1 = toughest). */
export function ratingCellsFromMatrix(
  nflTeam: string | undefined,
  position: Position,
  currentWeek: number,
  matrix: PlatformOprkMatrix | null
): { ros?: PlatformRatingCell; week?: PlatformRatingCell } {
  if (!matrix) return {};
  const slate = buildEspnOprkSlateFromMatrix(nflTeam, position, matrix);
  if (!slate) return {};

  const weekRow = slate.weeks.find((w) => w.week === currentWeek);
  const remaining = slate.weeks.filter(
    (w) => w.week >= currentWeek && !w.bye && w.rank != null
  );
  let rosRank: number | undefined;
  if (remaining.length > 0) {
    const avg =
      remaining.reduce((sum, w) => sum + (w.rank as number), 0) / remaining.length;
    rosRank = Math.round(avg);
  }

  return {
    ros: rosRank != null ? { rank: rosRank } : undefined,
    week: weekRow
      ? {
          rank: weekRow.bye ? undefined : weekRow.rank,
          opponent: weekRow.opponent,
          home: weekRow.home,
          bye: weekRow.bye,
        }
      : undefined,
  };
}
