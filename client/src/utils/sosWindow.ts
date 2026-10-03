import type { SosTeamRow } from '../types';

export type SosChartPos = 'overall' | 'qb' | 'rb' | 'wr' | 'te' | 'dst';

/** Clamp a Showing Week draft to 1…max and swap if from > to. */
export function clampWeekRange(
  fromRaw: string,
  toRaw: string,
  max: number
): { from: number; to: number } {
  const cap = Math.max(1, max);
  let from = Math.round(Number(fromRaw));
  let to = Math.round(Number(toRaw));
  if (!Number.isFinite(from)) from = 1;
  if (!Number.isFinite(to)) to = cap;
  from = Math.min(cap, Math.max(1, from));
  to = Math.min(cap, Math.max(1, to));
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  return { from, to };
}

/** Weekly matchup rank for one cell. Bye / missing weeks are null. */
export function weekMatchupRank(row: SosTeamRow, week: number, pos: SosChartPos): number | null {
  const cell = (row.games ?? []).find((g) => g.week === week);
  if (!cell || cell.bye || !cell.opponent) return null;
  const rating = cell[pos];
  return typeof rating === 'number' ? rating : null;
}

/**
 * Order teams by one week's matchup. Desc puts the toughest (highest) rank first.
 * Byes and missing cells stay at the bottom either way.
 */
export function compareWeekOrder(
  a: SosTeamRow,
  b: SosTeamRow,
  week: number,
  pos: SosChartPos,
  dir: 'asc' | 'desc'
): number {
  const ra = weekMatchupRank(a, week, pos);
  const rb = weekMatchupRank(b, week, pos);
  if (ra == null && rb == null) return a.team.localeCompare(b.team);
  if (ra == null) return 1;
  if (rb == null) return -1;
  const cmp = dir === 'desc' ? rb - ra : ra - rb;
  return cmp || a.team.localeCompare(b.team);
}

/** Average weekly matchup rank in the window (byes / missing cells skipped). Lower = easier. */
export function avgWindowMatchup(
  row: SosTeamRow,
  weeks: number[],
  pos: SosChartPos
): number | null {
  const byWeek = new Map((row.games ?? []).map((g) => [g.week, g]));
  const ratings: number[] = [];
  for (const week of weeks) {
    const cell = byWeek.get(week);
    if (!cell || cell.bye || !cell.opponent) continue;
    const rating = cell[pos];
    if (typeof rating === 'number') ratings.push(rating);
  }
  if (ratings.length === 0) return null;
  return ratings.reduce((sum, n) => sum + n, 0) / ratings.length;
}

/**
 * Re-rank teams 1–N by average matchup difficulty across the week window.
 * Rank 1 = easiest slate in range. Ties break alphabetically by team code.
 */
export function buildWindowRosRanks(
  teams: SosTeamRow[],
  weeks: number[],
  pos: SosChartPos
): Map<string, number> {
  const scored = teams
    .map((row) => ({ team: row.team, avg: avgWindowMatchup(row, weeks, pos) }))
    .filter((row): row is { team: string; avg: number } => row.avg != null);
  scored.sort((a, b) => a.avg - b.avg || a.team.localeCompare(b.team));
  const ranks = new Map<string, number>();
  scored.forEach((row, i) => ranks.set(row.team, i + 1));
  return ranks;
}
