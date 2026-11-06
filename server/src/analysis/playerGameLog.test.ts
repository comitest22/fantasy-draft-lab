import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellsFromDstFantasyStats,
  cellsFromStats,
  dstFantasyEspnId,
  expandMadeAttemptPairs,
  insertByeWeeks,
  mergeLogWithSchedule,
  pprPoints,
  resolveGameLogSeason,
  sosPosKey,
  statMap,
} from './playerGameLog';

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

  it('scores a kicker week from totalKickingPoints or FG/XP', () => {
    assert.equal(pprPoints({ totalKickingPoints: 14 }, 'K'), 14);
    assert.equal(
      pprPoints({ fieldGoalsMade: 4, extraPointsMade: 2 }, 'K'),
      14
    );
    assert.equal(pprPoints({ fieldGoalsMade: 0, extraPointsMade: 3 }, 'K'), 3);
  });
});

describe('statMap kicker pairs', () => {
  it('splits ESPN made-attempt compound keys', () => {
    const names = [
      'fieldGoalsMade-fieldGoalAttempts',
      'extraPointsMade-extraPointAttempts',
      'totalKickingPoints',
    ];
    const stats = ['4-5', '2-2', '14'];
    const mapped = statMap(names, stats);
    assert.equal(mapped.fieldGoalsMade, 4);
    assert.equal(mapped.fieldGoalAttempts, 5);
    assert.equal(mapped.extraPointsMade, 2);
    assert.equal(mapped.extraPointAttempts, 2);
    assert.equal(mapped.totalKickingPoints, 14);

    const fpts = pprPoints(mapped, 'K');
    assert.deepEqual(cellsFromStats(mapped, 'K', fpts), {
      fg: 4,
      fga: 5,
      xp: 2,
      xpa: 2,
      fpts: 14,
    });
  });

  it('expandMadeAttemptPairs is a no-op for plain numeric cols', () => {
    const names = ['passingYards'];
    const stats = ['250'];
    const base = { passingYards: 250 };
    assert.deepEqual(expandMadeAttemptPairs(names, stats, base), base);
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

describe('mergeLogWithSchedule', () => {
  it('keeps played weeks and pads upcoming opponents with empty cells', () => {
    const rows = mergeLogWithSchedule(
      [{ week: 1, opp: 'CLE', cells: { rec: 4, fpts: 12 }, fpts: 12 }],
      [
        { week: 1, opponent: 'CLE', home: true },
        { week: 2, opponent: 'DEN', home: false },
        { week: 3, bye: true },
        { week: 4, opponent: 'CIN', home: false },
      ]
    );
    assert.equal(rows.length, 18);
    assert.deepEqual(rows[0], {
      week: 1,
      opp: 'CLE',
      cells: { rec: 4, fpts: 12 },
      fpts: 12,
    });
    assert.deepEqual(rows[1], { week: 2, opp: '@DEN', bye: false, cells: {} });
    assert.deepEqual(rows[2], { week: 3, opp: 'BYE', bye: true, cells: {} });
    assert.deepEqual(rows[3], { week: 4, opp: '@CIN', bye: false, cells: {} });
    assert.equal(rows[17]?.week, 18);
    assert.equal(rows[17]?.bye, true);
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

describe('dstFantasyEspnId', () => {
  it('maps team abbr to negative fantasy D/ST ids', () => {
    assert.equal(dstFantasyEspnId('JAX'), -16030);
    assert.equal(dstFantasyEspnId('GB'), -16009);
  });
});

describe('cellsFromDstFantasyStats', () => {
  it('reads ESPN fantasy D/ST week stats', () => {
    const cells = cellsFromDstFantasyStats(
      {
        '95': 1,
        '96': 1,
        '97': 0,
        '98': 0,
        '99': 5,
        '105': 0,
        '120': 10,
        '127': 272,
        '187': 10,
      },
      14
    );
    assert.equal(cells.int, 1);
    assert.equal(cells.fr, 1);
    assert.equal(cells.sck, 5);
    assert.equal(cells.pa, 10);
    assert.equal(cells.ya, 272);
    assert.equal(cells.fpts, 14);
  });
});
