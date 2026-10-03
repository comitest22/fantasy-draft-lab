export function snakeOverall(slot: number, round: number, leagueSize: number): number {
  if (round % 2 === 1) return (round - 1) * leagueSize + slot;
  return leagueSize * round - slot + 1;
}

export function snakePath(slot: number, leagueSize: number, rounds: number): number[] {
  const size = Math.max(1, leagueSize);
  const seat = Math.min(Math.max(1, slot), size);
  return Array.from({ length: Math.max(1, rounds) }, (_, i) => snakeOverall(seat, i + 1, size));
}
