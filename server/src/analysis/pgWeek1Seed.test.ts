import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { week1SeedWinPct } from './pgWeek1Seed';

describe('week1SeedWinPct', () => {
  it('covers all 32 teams as favorite or underdog', () => {
    const teams = [
      'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
      'HOU', 'IND', 'JAX', 'KC', 'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
      'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
    ];
    for (const team of teams) {
      const pct = week1SeedWinPct(team);
      assert.ok(pct != null && pct > 0 && pct < 100, team);
    }
    assert.equal(week1SeedWinPct('JAX'), 80);
    assert.equal(week1SeedWinPct('CLE'), 20);
    assert.equal(week1SeedWinPct('KC'), 56);
    assert.equal(week1SeedWinPct('DEN'), 44);
  });
});
