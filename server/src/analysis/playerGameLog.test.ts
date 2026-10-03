import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { insertByeWeeks, pprPoints, resolveGameLogSeason, sosPosKey, statMap } from './playerGameLog';

describe('pprPoints', () => {
  it('scores a PPR RB week', () => {
    const pts = pprPoints(
      {
        rushingYards: 80,
        rushingTouchdowns: 1,
        receptions: 4,
        receivingYards: 30,
        receivingTouchdowns: 0,
        fumblesLost: 0,
      },
      'RB'
    );
    assert.equal(pts, 21);
  });

  it('scores a PPR QB week', () => {
    const pts = pprPoints(
      {
        passingYards: 250,
        passingTouchdowns: 2,
        interceptions: 1,
        rushingYards: 20,
        rushingTouchdowns: 0,
      },
      'QB'
    );
    assert.equal(pts, 18);
  });
});

describe('insertByeWeeks', () => {
  it('fills a missing week as BYE in ascending order', () => {
    const rows = insertByeWeeks([
      { week: 3, opp: 'SEA', cells: { rec: 5 } },
      { week: 1, opp: '@ARI', cells: { rec: 2 } },
    ]);
    assert.deepEqual(
      rows.map((r) => `${r.week}:${r.opp}`),
      ['1:@ARI', '2:BYE', '3:SEA']
    );
    assert.equal(rows[1]?.bye, true);
  });
});

describe('statMap', () => {
  it('maps ESPN stat arrays by name', () => {
    const mapped = statMap(['rushingYards', 'receptions'], ['80', '-']);
    assert.equal(mapped.rushingYards, 80);
    assert.equal(mapped.receptions, null);
  });
});

describe('sosPosKey', () => {
  it('maps skill positions to chart keys and K/DST to overall/dst', () => {
    assert.equal(sosPosKey('WR'), 'wr');
    assert.equal(sosPosKey('RB'), 'rb');
    assert.equal(sosPosKey('QB'), 'qb');
    assert.equal(sosPosKey('TE'), 'te');
    assert.equal(sosPosKey('K'), 'overall');
    assert.equal(sosPosKey('D/ST'), 'dst');
  });
});

describe('resolveGameLogSeason', () => {
  it('defaults to the draft season', () => {
    assert.equal(resolveGameLogSeason(2026), 2026);
  });

  it('clamps requested years to the last five', () => {
    assert.equal(resolveGameLogSeason(2026, 2025), 2025);
    assert.equal(resolveGameLogSeason(2026, 2021), 2022);
    assert.equal(resolveGameLogSeason(2026, 2030), 2026);
  });
});
