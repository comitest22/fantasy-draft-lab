/**
 * Week 1 2026 favorite win% (Predicted Sports model snapshot, Sep 2026).
 * Used only to backfill PoolGenius cells that finished before projections were locked.
 * Underdogs get 100 − favorite.
 */
export const WEEK1_2026_FAVORITE_WIN_PCT: Array<{ favorite: string; underdog: string; winPct: number }> = [
  { favorite: 'JAX', underdog: 'CLE', winPct: 80 },
  { favorite: 'LAC', underdog: 'ARI', winPct: 80 },
  { favorite: 'PIT', underdog: 'ATL', winPct: 70 },
  { favorite: 'DET', underdog: 'NO', winPct: 70 },
  { favorite: 'DAL', underdog: 'NYG', winPct: 64 },
  { favorite: 'CIN', underdog: 'TB', winPct: 62 },
  { favorite: 'MIN', underdog: 'GB', winPct: 61 },
  { favorite: 'PHI', underdog: 'WAS', winPct: 61 },
  { favorite: 'BAL', underdog: 'IND', winPct: 60 },
  { favorite: 'CHI', underdog: 'CAR', winPct: 59 },
  { favorite: 'SEA', underdog: 'NE', winPct: 58 },
  { favorite: 'LA', underdog: 'SF', winPct: 58 },
  { favorite: 'BUF', underdog: 'HOU', winPct: 57 },
  { favorite: 'NYJ', underdog: 'TEN', winPct: 57 },
  { favorite: 'LV', underdog: 'MIA', winPct: 56 },
  { favorite: 'KC', underdog: 'DEN', winPct: 56 },
];

export function week1SeedWinPct(team: string): number | null {
  for (const row of WEEK1_2026_FAVORITE_WIN_PCT) {
    if (row.favorite === team) return row.winPct;
    if (row.underdog === team) return 100 - row.winPct;
  }
  return null;
}
