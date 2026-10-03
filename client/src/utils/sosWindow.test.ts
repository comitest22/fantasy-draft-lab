import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SosTeamRow } from '../types';
import { avgWindowMatchup, buildWindowRosRanks, clampWeekRange, compareWeekOrder } from './sosWindow';

function team(
  code: string,
  games: Array<{ week: number; opp?: string; bye?: boolean; overall?: number; rb?: number }>
): SosTeamRow {
  return {
    team: code,
    overall: {},
    qb: {},
    rb: {},
    wr: {},
    te: {},
    games: games.map((g) => ({
      week: g.week,
      opponent: g.opp,
      bye: g.bye,
      overall: g.overall,
      rb: g.rb,
    })),
  };
}

describe('avgWindowMatchup', () => {
  it('averages non-bye weeks in the window', () => {
    const row = team('SEA', [
      { week: 1, opp: 'SF', overall: 10 },
      { week: 2, bye: true },
      { week: 3, opp: 'ARI', overall: 20 },
    ]);
    assert.equal(avgWindowMatchup(row, [1, 2, 3], 'overall'), 15);
  });

  it('returns null when every week is a bye', () => {
    const row = team('SEA', [{ week: 5, bye: true }]);
    assert.equal(avgWindowMatchup(row, [5], 'overall'), null);
  });
});

describe('clampWeekRange', () => {
  it('clamps to 1…max and swaps a backwards range', () => {
    assert.deepEqual(clampWeekRange('0', '99', 18), { from: 1, to: 18 });
    assert.deepEqual(clampWeekRange('14', '6', 18), { from: 6, to: 14 });
    assert.deepEqual(clampWeekRange('nope', 'nope', 18), { from: 1, to: 18 });
  });
});

describe('compareWeekOrder', () => {
  it('sorts a week descending with byes last', () => {
    const easy = team('AAA', [{ week: 4, opp: 'X', overall: 3 }]);
    const tough = team('BBB', [{ week: 4, opp: 'Y', overall: 28 }]);
    const bye = team('CCC', [{ week: 4, bye: true }]);
    const rows = [easy, bye, tough];
    rows.sort((a, b) => compareWeekOrder(a, b, 4, 'overall', 'desc'));
    assert.deepEqual(
      rows.map((r) => r.team),
      ['BBB', 'AAA', 'CCC']
    );
    rows.sort((a, b) => compareWeekOrder(a, b, 4, 'overall', 'asc'));
    assert.deepEqual(
      rows.map((r) => r.team),
      ['AAA', 'BBB', 'CCC']
    );
  });
});

describe('buildWindowRosRanks', () => {
  it('ranks easier averages first and recalculates when the window shrinks', () => {
    const teams = [
      team('AAA', [
        { week: 1, opp: 'X', rb: 2 },
        { week: 2, opp: 'Y', rb: 30 },
        { week: 3, opp: 'Z', rb: 30 },
      ]),
      team('BBB', [
        { week: 1, opp: 'X', rb: 20 },
        { week: 2, opp: 'Y', rb: 4 },
        { week: 3, opp: 'Z', rb: 4 },
      ]),
    ];
    const full = buildWindowRosRanks(teams, [1, 2, 3], 'rb');
    assert.equal(full.get('BBB'), 1);
    assert.equal(full.get('AAA'), 2);

    const early = buildWindowRosRanks(teams, [1], 'rb');
    assert.equal(early.get('AAA'), 1);
    assert.equal(early.get('BBB'), 2);
  });
});
