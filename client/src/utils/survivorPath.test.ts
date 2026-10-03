import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SurvivorSeasonRow } from '../types';
import { minCostAssignment, optimizePath, formatRelative, buildEntryPaths, bpaLocks } from './survivorPath';

describe('minCostAssignment', () => {
  it('solves a 2x2 min-cost matrix', () => {
    const cost = [
      [4, 1],
      [2, 3],
    ];
    assert.deepEqual(minCostAssignment(cost), [1, 0]);
  });
});

describe('optimizePath', () => {
  it('picks the max product assignment, not the greedy high cells', () => {
    const rows: SurvivorSeasonRow[] = [
      {
        team: 'AAA',
        teamName: 'A',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 60, losePct: 40, opp: 'X', bye: false },
          { week: 2, winPct: 90, losePct: 10, opp: 'Y', bye: false },
        ],
      },
      {
        team: 'BBB',
        teamName: 'B',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 80, losePct: 20, opp: 'X', bye: false },
          { week: 2, winPct: 70, losePct: 30, opp: 'Y', bye: false },
        ],
      },
    ];
    const path = optimizePath(rows, false, null);
    assert.equal(path.slots[0]?.team, 'BBB');
    assert.equal(path.slots[1]?.team, 'AAA');
    assert.equal(path.survive, 0.8 * 0.9);
  });

  it('keeps a locked week-1 team and still maxes the rest', () => {
    const rows: SurvivorSeasonRow[] = [
      {
        team: 'AAA',
        teamName: 'A',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 99, losePct: 1, opp: 'X', bye: false },
          { week: 2, winPct: 50, losePct: 50, opp: 'Y', bye: false },
        ],
      },
      {
        team: 'BBB',
        teamName: 'B',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 40, losePct: 60, opp: 'X', bye: false },
          { week: 2, winPct: 90, losePct: 10, opp: 'Y', bye: false },
        ],
      },
    ];
    const locked = optimizePath(rows, false, 'BBB');
    assert.equal(locked.slots[0]?.team, 'BBB');
    assert.equal(locked.slots[1]?.team, 'AAA');
    const best = optimizePath(rows, false, null);
    assert.ok((locked.survive ?? 0) < (best.survive ?? 0));
    assert.equal(formatRelative(locked.survive, best.survive), '22%');
  });
});

describe('buildEntryPaths', () => {
  function team(
    code: string,
    weeks: Array<[number, number]>,
  ): SurvivorSeasonRow {
    return {
      team: code,
      teamName: code,
      futureValue: 1,
      cells: weeks.map(([week, winPct]) => ({
        week,
        winPct,
        losePct: 100 - winPct,
        opp: 'X',
        bye: false,
      })),
    };
  }

  it('splits leftover weeks across two same week-1 tickets instead of cloning the best slate', () => {
    const rows = [
      team('AAA', [[1, 90], [2, 50], [3, 50]]),
      team('BBB', [[1, 40], [2, 80], [3, 75]]),
      team('CCC', [[1, 40], [2, 70], [3, 85]]),
      team('DDD', [[1, 40], [2, 60], [3, 60]]),
    ];
    const { paths } = buildEntryPaths(rows, false, ['AAA', 'AAA']);
    assert.equal(paths[0]?.slots[0]?.team, 'AAA');
    assert.equal(paths[1]?.slots[0]?.team, 'AAA');
    const later = (path: (typeof paths)[0]) =>
      path.slots
        .filter((s): s is NonNullable<typeof s> => s != null && s.week !== 1)
        .map((s) => `${s.week}:${s.team}`);
    const a = new Set(later(paths[0]));
    for (const key of later(paths[1])) {
      assert.equal(a.has(key), false);
    }
    const ratio = (paths[0].survive ?? 0) / (paths[1].survive ?? 1);
    assert.ok(ratio > 0.5 && ratio < 2, `survival should be close, got ${ratio}`);
  });

  it('does not stack the same later-week team when week-1 locks differ', () => {
    const rows = [
      team('AAA', [[1, 80], [2, 50], [3, 50]]),
      team('BBB', [[1, 80], [2, 50], [3, 50]]),
      team('CCC', [[1, 40], [2, 90], [3, 85]]),
      team('DDD', [[1, 40], [2, 88], [3, 84]]),
    ];
    const { paths } = buildEntryPaths(rows, false, ['AAA', 'BBB']);
    assert.equal(paths[0]?.slots[0]?.team, 'AAA');
    assert.equal(paths[1]?.slots[0]?.team, 'BBB');
    const later = (path: (typeof paths)[0]) =>
      path.slots
        .filter((s): s is NonNullable<typeof s> => s != null && s.week !== 1)
        .map((s) => `${s.week}:${s.team}`);
    const a = new Set(later(paths[0]));
    for (const key of later(paths[1])) {
      assert.equal(a.has(key), false);
    }
  });

  it('keeps a locked completed week even when PoolGenius has W/L instead of a percent', () => {
    const rows = [
      team('BAL', [
        [1, 100],
        [2, 79],
      ]),
      team('SF', [
        [1, 100],
        [2, 85],
      ]),
    ];
    rows[0].cells[0].result = 'W';
    rows[0].cells[0].opp = '@IND';
    const { paths } = buildEntryPaths(rows, false, [['BAL']]);
    assert.equal(paths[0]?.slots[0]?.team, 'BAL');
    assert.equal(paths[0]?.slots[0]?.result, 'W');
  });

  it('keeps a locked team when that week has no live percent', () => {
    const rows: SurvivorSeasonRow[] = [
      {
        team: 'BAL',
        teamName: 'Baltimore',
        futureValue: 1,
        cells: [
          { week: 1, winPct: null, losePct: null, opp: '@IND', bye: false, result: 'W', score: '41-21' },
          { week: 2, winPct: 79, losePct: 21, opp: 'NO', bye: false },
        ],
      },
      {
        team: 'SF',
        teamName: 'San Francisco',
        futureValue: 1,
        cells: [
          { week: 1, winPct: null, losePct: null, opp: '@LA', bye: false, result: 'W', score: '17-13' },
          { week: 2, winPct: 85, losePct: 15, opp: 'MIA', bye: false },
        ],
      },
    ];
    const { paths } = buildEntryPaths(rows, false, [['BAL']]);
    assert.equal(paths[0]?.slots[0]?.team, 'BAL');
  });

  it('keeps a later-week lock on that ticket', () => {
    const rows = [
      team('AAA', [[1, 90], [2, 50], [3, 50]]),
      team('BBB', [[1, 40], [2, 80], [3, 75]]),
      team('CCC', [[1, 40], [2, 70], [3, 85]]),
      team('DDD', [[1, 40], [2, 60], [3, 60]]),
    ];
    const { paths } = buildEntryPaths(rows, false, [['AAA', 'BBB'], ['AAA']]);
    assert.equal(paths[0]?.slots[0]?.team, 'AAA');
    assert.equal(paths[0]?.slots[1]?.team, 'BBB');
  });
});

describe('bpaLocks', () => {
  it('keeps locked and already-played weeks, and lets optimizePath fill the rest', () => {
    const rows = [
      {
        team: 'AAA',
        teamName: 'A',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 90, losePct: 10, opp: 'X', bye: false, result: 'W' as const },
          { week: 2, winPct: 50, losePct: 50, opp: 'Y', bye: false },
          { week: 3, winPct: 50, losePct: 50, opp: 'Z', bye: false },
        ],
      },
      {
        team: 'BBB',
        teamName: 'B',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 40, losePct: 60, opp: 'X', bye: false },
          { week: 2, winPct: 80, losePct: 20, opp: 'Y', bye: false },
          { week: 3, winPct: 75, losePct: 25, opp: 'Z', bye: false },
        ],
      },
      {
        team: 'CCC',
        teamName: 'C',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 40, losePct: 60, opp: 'X', bye: false },
          { week: 2, winPct: 70, losePct: 30, opp: 'Y', bye: false },
          { week: 3, winPct: 85, losePct: 15, opp: 'Z', bye: false },
        ],
      },
    ];
    const locks = bpaLocks(['AAA', 'BBB', 'AAA'], 1, rows, 2);
    assert.equal(locks[0], 'AAA');
    assert.equal(locks[1], null);
    assert.equal(locks[2], null);
    const path = optimizePath(rows, false, locks[0], locks);
    assert.equal(path.slots[0]?.team, 'AAA');
    assert.equal(path.slots[1]?.team, 'BBB');
    assert.equal(path.slots[2]?.team, 'CCC');
  });

  it('joint BPA keeps played locks and splits leftover weeks across tickets', () => {
    const rows: SurvivorSeasonRow[] = ['AAA', 'BBB', 'CCC', 'DDD'].map((code, i) => ({
      team: code,
      teamName: code,
      futureValue: 1,
      cells: [
        { week: 1, winPct: i === 0 ? 90 : 40, losePct: i === 0 ? 10 : 60, opp: 'X', bye: false },
        { week: 2, winPct: [50, 80, 70, 60][i], losePct: [50, 20, 30, 40][i], opp: 'Y', bye: false },
        { week: 3, winPct: [50, 75, 85, 60][i], losePct: [50, 25, 15, 40][i], opp: 'Z', bye: false },
      ],
    }));
    rows[0].cells[0].result = 'W';
    const locks = [
      bpaLocks(['AAA', 'BBB', 'CCC'], 1, rows, 2),
      bpaLocks(['AAA', 'BBB', 'CCC'], 1, rows, 2),
    ];
    assert.equal(locks[0][0], 'AAA');
    assert.equal(locks[0][1], null);
    const { paths } = buildEntryPaths(rows, false, locks);
    assert.equal(paths[0]?.slots[0]?.team, 'AAA');
    assert.equal(paths[1]?.slots[0]?.team, 'AAA');
    const later = (path: (typeof paths)[0]) =>
      path.slots
        .filter((s): s is NonNullable<typeof s> => s != null && s.week !== 1)
        .map((s) => `${s.week}:${s.team}`);
    const a = new Set(later(paths[0]));
    for (const key of later(paths[1])) {
      assert.equal(a.has(key), false);
    }
  });

  it('does not keep a current-week leftover just because that game already has W/L', () => {
    const rows: SurvivorSeasonRow[] = [
      {
        team: 'JAX',
        teamName: 'JAX',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 90, losePct: 10, opp: 'CLE', bye: false, result: 'W' as const },
          { week: 2, winPct: 40, losePct: 60, opp: 'Y', bye: false },
        ],
      },
      {
        team: 'BUF',
        teamName: 'BUF',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 40, losePct: 60, opp: 'X', bye: false },
          { week: 2, winPct: 80, losePct: 20, opp: 'DET', bye: false, result: 'W' as const },
        ],
      },
    ];
    const locks = bpaLocks(['JAX', 'BUF'], 1, rows, 2);
    assert.equal(locks[0], 'JAX');
    assert.equal(locks[1], null);
  });

  it('leftover fill skips games that already have W/L', () => {
    const rows: SurvivorSeasonRow[] = [
      {
        team: 'JAX',
        teamName: 'JAX',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 90, losePct: 10, opp: 'CLE', bye: false, result: 'W' as const },
          { week: 2, winPct: 40, losePct: 60, opp: 'Y', bye: false },
          { week: 3, winPct: 50, losePct: 50, opp: 'Z', bye: false },
        ],
      },
      {
        team: 'BUF',
        teamName: 'BUF',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 40, losePct: 60, opp: 'X', bye: false },
          { week: 2, winPct: 99, losePct: 1, opp: 'DET', bye: false, result: 'W' as const },
          { week: 3, winPct: 50, losePct: 50, opp: 'Z', bye: false },
        ],
      },
      {
        team: 'SF',
        teamName: 'SF',
        futureValue: 1,
        cells: [
          { week: 1, winPct: 40, losePct: 60, opp: 'X', bye: false },
          { week: 2, winPct: 85, losePct: 15, opp: 'MIA', bye: false },
          { week: 3, winPct: 50, losePct: 50, opp: 'Z', bye: false },
        ],
      },
    ];
    const locks = [bpaLocks(['JAX', 'BUF'], 1, rows, 2)];
    const { paths } = buildEntryPaths(rows, false, locks);
    assert.equal(paths[0]?.slots[0]?.team, 'JAX');
    assert.notEqual(paths[0]?.slots[1]?.team, 'BUF');
    assert.equal(paths[0]?.slots[1]?.team, 'SF');
  });
});
