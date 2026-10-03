import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignFutureToSchedule, lockCompletedFuture, normalizePgFutureCell } from './pgFuture';

describe('normalizePgFutureCell', () => {
  it('keeps upcoming percent cells', () => {
    assert.deepEqual(normalizePgFutureCell({ week: 2, winPct: 85, opp: 'MIA' }), {
      week: 2,
      winPct: 85,
      opp: 'MIA',
      bye: false,
      result: null,
      score: null,
      locked: false,
    });
  });

  it('parses completed W/L without turning the cell into 100/0', () => {
    assert.deepEqual(normalizePgFutureCell({ week: 1, winPct: null, opp: 'W @LA' }), {
      week: 1,
      winPct: null,
      opp: '@LA',
      bye: false,
      result: 'W',
      score: null,
      locked: false,
    });
    assert.deepEqual(normalizePgFutureCell({ week: 1, winPct: null, opp: 'L SF' }), {
      week: 1,
      winPct: null,
      opp: 'SF',
      bye: false,
      result: 'L',
      score: null,
      locked: false,
    });
  });

  it('keeps a stored projection on a W/L cell', () => {
    assert.equal(normalizePgFutureCell({ week: 1, winPct: 79, opp: 'W @IND' }).winPct, 79);
    assert.equal(normalizePgFutureCell({ week: 1, winPct: 79, opp: 'W @IND' }).result, 'W');
  });
});

describe('lockCompletedFuture', () => {
  it('freezes last week’s projected % and attaches W/L + score', () => {
    const prev = [normalizePgFutureCell({ week: 1, winPct: 79, opp: '@IND' })];
    const fresh = [normalizePgFutureCell({ week: 1, winPct: null, opp: 'W @IND' })];
    const locked = lockCompletedFuture(fresh, prev, new Map([[1, { result: 'W', score: '41-21', opp: 'IND' }]]));
    assert.equal(locked[0]?.winPct, 79);
    assert.equal(locked[0]?.result, 'W');
    assert.equal(locked[0]?.score, '41-21');
    assert.equal(locked[0]?.locked, true);
    assert.equal(locked[0]?.opp, '@IND');
  });

  it('lets remaining weeks take the new PoolGenius numbers', () => {
    const prev = [normalizePgFutureCell({ week: 2, winPct: 71, opp: 'NYG' })];
    const fresh = [normalizePgFutureCell({ week: 2, winPct: 68, opp: 'NYG' })];
    const locked = lockCompletedFuture(fresh, prev, new Map());
    assert.equal(locked[0]?.winPct, 68);
    assert.equal(locked[0]?.locked, false);
  });

  it('does not treat old 100/0 conversions as a stored projection', () => {
    const prev = [normalizePgFutureCell({ week: 1, winPct: 100, opp: 'W @IND' })];
    const fresh = [normalizePgFutureCell({ week: 1, winPct: null, opp: 'W @IND' })];
    const locked = lockCompletedFuture(fresh, prev, new Map([[1, { result: 'W', score: '41-21' }]]));
    assert.equal(locked[0]?.winPct, null);
    assert.equal(locked[0]?.score, '41-21');
    assert.equal(locked[0]?.locked, false);
  });

  it('prefers schedule finals over PoolGenius W/L on the wrong week', () => {
    const fresh = [normalizePgFutureCell({ week: 3, winPct: 77, opp: '@ARI' })];
    fresh[0] = { ...fresh[0]!, result: 'W' };
    const locked = lockCompletedFuture(
      fresh,
      undefined,
      new Map([[3, { result: 'L', score: '31-33', opp: '@WAS' }]]),
    );
    assert.equal(locked[0]?.result, 'L');
    assert.equal(locked[0]?.score, '31-33');
  });
});

describe('alignFutureToSchedule', () => {
  it('remaps shifted PoolGenius columns onto real NFL weeks by opponent', () => {
    const shifted = [
      normalizePgFutureCell({ week: 1, winPct: 58, opp: 'NE' }),
      normalizePgFutureCell({ week: 2, winPct: 64, opp: 'NE' }),
      normalizePgFutureCell({ week: 3, winPct: 77, opp: '@ARI' }),
      normalizePgFutureCell({ week: 4, winPct: 70, opp: '@WAS' }),
      normalizePgFutureCell({ week: 5, winPct: 73, opp: 'LAC' }),
      normalizePgFutureCell({ week: 6, winPct: 64, opp: 'SF' }),
    ];
    const schedule = [
      { week: 1, opp: 'NE', bye: false, result: 'W' as const, score: '13-10' },
      { week: 2, opp: '@ARI', bye: false, result: 'W' as const, score: '31-7' },
      { week: 3, opp: '@WAS', bye: false, result: 'L' as const, score: '31-33' },
      { week: 4, opp: 'LAC', bye: false },
      { week: 5, opp: 'SF', bye: false },
      { week: 6, opp: '@DEN', bye: false },
    ];
    const aligned = alignFutureToSchedule(shifted, schedule);
    assert.equal(aligned[0]?.opp, 'NE');
    assert.equal(aligned[0]?.winPct, 58);
    assert.equal(aligned[1]?.opp, '@ARI');
    assert.equal(aligned[1]?.winPct, 77);
    assert.equal(aligned[2]?.opp, '@WAS');
    assert.equal(aligned[2]?.winPct, 70);
    assert.equal(aligned[2]?.result, 'L');
    assert.equal(aligned[3]?.opp, 'LAC');
    assert.equal(aligned[3]?.winPct, 73);
    assert.equal(aligned[3]?.result, null);
    assert.equal(aligned[4]?.opp, 'SF');
    assert.equal(aligned[4]?.winPct, 64);
  });
});
