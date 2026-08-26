export function sortBySeason<T extends { season: number }>(
  items: T[],
  order: 'asc' | 'desc' = 'asc'
): T[] {
  const factor = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => (a.season - b.season) * factor);
}

export function sortSeasons(seasons: number[], order: 'asc' | 'desc' = 'asc'): number[] {
  const factor = order === 'asc' ? 1 : -1;
  return [...seasons].sort((a, b) => (a - b) * factor);
}
