import type { SeasonAnalysis } from '../types';

export function sortSeasonAnalyses(
  analyses: SeasonAnalysis[],
  order: 'asc' | 'desc' = 'asc'
): SeasonAnalysis[] {
  const factor = order === 'asc' ? 1 : -1;
  return [...analyses].sort((a, b) => (a.season - b.season) * factor);
}
