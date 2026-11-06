import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  blendDefStats,
  blendDefStatsRates,
  currentSeasonWeight,
  mixScore,
  priorFade,
  rankToSosScore,
  ranksFromDefStats,
  ranksFromOffStats,
  softAnchorDefRanks,
} from './sosBlend';

describe('SOS blend weights', () => {
  it('week 1 is 25% current-season stats', () => {
    assert.equal(currentSeasonWeight(1), 0.25);
  });

  it('week 3 is 75% current-season stats', () => {
    assert.equal(currentSeasonWeight(3), 0.75);
  });

  it('week 4+ is 100% current-season stats', () => {
    assert.equal(currentSeasonWeight(4), 1);
    assert.equal(currentSeasonWeight(18), 1);
  });

  it('week 0 keeps the full prior', () => {
    assert.equal(currentSeasonWeight(0), 0);
    assert.equal(priorFade(0), 1);
  });

  it('week 1 keeps 75% DraftEdge/FPA prior', () => {
    assert.equal(priorFade(1), 0.75);
  });

  it('week 3 keeps 25% DraftEdge/FPA prior', () => {
    assert.equal(priorFade(3), 0.25);
  });

  it('week 4+ drops the preseason SOS prior', () => {
    assert.equal(priorFade(4), 0);
    assert.equal(priorFade(18), 0);
  });
});

describe('rankToSosScore', () => {
  it('maps rank 1 to 5.0 and rank 32 to 1.0', () => {
    assert.equal(rankToSosScore(1), 5);
    assert.equal(rankToSosScore(32), 1);
  });
});

describe('mixScore', () => {
  it('fades prior into computed remaining SOS', () => {
    assert.equal(mixScore(4, 2, 0.75), 3.5);
    assert.equal(mixScore(4, 2, 0), 2);
    assert.equal(mixScore(4, undefined, 0.5), 4);
  });
});

describe('ranks from stats', () => {
  it('ranks highest PA as easiest defense', () => {
    const ranks = ranksFromDefStats(
      new Map([
        ['A', { pa: 30, oppPass: 250, oppRush: 100 }],
        ['B', { pa: 10, oppPass: 180, oppRush: 140 }],
      ])
    );
    assert.equal(ranks.get('A')?.overall, 1);
    assert.equal(ranks.get('B')?.overall, 2);
    assert.equal(ranks.get('B')?.rb, 1);
  });

  it('ranks fewest points scored as easiest D/ST', () => {
    const ranks = ranksFromOffStats(
      new Map([
        ['A', { pointsFor: 10 }],
        ['B', { pointsFor: 30 }],
      ])
    );
    assert.equal(ranks.get('A'), 1);
    assert.equal(ranks.get('B'), 2);
  });
});

describe('per-game rate blend', () => {
  it('does not keep elite prior totals as near-toughest vs mid YTD (HOU-style)', () => {
    // League where YTD ≈ prior pace, plus HOU: elite prior (low yards) but mid YTD rate.
    const prior = new Map<string, { pa: number; oppPass: number; oppRush: number }>();
    const current = new Map<string, { pa: number; oppPass: number; oppRush: number }>();
    for (let i = 0; i < 31; i++) {
      const team = `T${String(i).padStart(2, '0')}`;
      const priorPass = 6200 - i * 45; // ~6200 … ~4850
      prior.set(team, { pa: 480 - i * 6, oppPass: priorPass, oppRush: 2100 - i * 20 });
      current.set(team, {
        pa: Math.round((480 - i * 6) / 17 * 3),
        oppPass: Math.round((priorPass / 17) * 3),
        oppRush: Math.round((2100 - i * 20) / 17 * 3),
      });
    }
    prior.set('HOU', { pa: 295, oppPass: 5079, oppRush: 1593 }); // elite prior rate ~299/g
    current.set('HOU', { pa: 75, oppPass: 1036, oppRush: 260 }); // mid YTD ~345/g

    const weight = 0.75;
    const totalBlend = new Map();
    const rateBlend = new Map();
    for (const team of prior.keys()) {
      totalBlend.set(team, blendDefStats(current.get(team), prior.get(team), weight)!);
      rateBlend.set(team, blendDefStatsRates(current.get(team), prior.get(team), weight, 3, 17)!);
    }

    const totalRanks = ranksFromDefStats(totalBlend);
    const rateRanks = ranksFromDefStats(rateBlend);
    const houTotal = totalRanks.get('HOU')?.wr ?? 0;
    const houRate = rateRanks.get('HOU')?.wr ?? 0;

    // Totals mix full-season prior with 3-game YTD → HOU stays tough; rates reflect mid YTD.
    assert.ok(houTotal >= 20, `expected tough total-blend HOU, got ${houTotal}`);
    assert.ok(houRate < houTotal, `rates should ease HOU (${houRate} vs total ${houTotal})`);
    assert.ok(houRate <= 18, `expected HOU rate rank mid-pack or easier, got ${houRate}`);
  });
});

describe('softAnchorDefRanks', () => {
  it('pulls stats ranks toward ESPN OPRK then re-ranks', () => {
    const stats = new Map([
      ['HOU', { overall: 20, qb: 29, rb: 20, wr: 29, te: 29 }],
      ['SEA', { overall: 30, qb: 32, rb: 28, wr: 32, te: 32 }],
      ['ARI', { overall: 5, qb: 6, rb: 8, wr: 6, te: 6 }],
    ]);
    // ESPN OPRK: 1 = toughest. HOU easy (31), SEA tough (4), ARI easy (29).
    const anchored = softAnchorDefRanks(stats, {
      WR: { HOU: 31, SEA: 4, ARI: 29 },
      QB: { HOU: 31, SEA: 4, ARI: 29 },
      RB: { HOU: 20, SEA: 10, ARI: 25 },
      TE: { HOU: 28, SEA: 5, ARI: 30 },
    });

    // HOU should no longer be the toughest WR after anchoring toward ESPN easy.
    assert.ok((anchored.get('HOU')?.wr ?? 0) < (stats.get('HOU')?.wr ?? 0));
    assert.equal(anchored.get('SEA')?.wr, 3); // still toughest of the three
    assert.equal(anchored.get('HOU')?.overall, 20); // overall unchanged
  });

  it('returns stats ranks when ESPN matrix is missing', () => {
    const stats = new Map([['HOU', { overall: 10, qb: 12, rb: 11, wr: 12, te: 12 }]]);
    const out = softAnchorDefRanks(stats, null);
    assert.equal(out.get('HOU')?.wr, 12);
  });
});
