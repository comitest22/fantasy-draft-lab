import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentSeasonWeight,
  mixScore,
  priorFade,
  rankToSosScore,
  ranksFromDefStats,
  ranksFromOffStats,
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
