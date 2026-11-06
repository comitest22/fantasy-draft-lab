import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageLast3FpAllowed,
  buildVsPosMatchup,
  emptyWeeklyDefenseAllowed,
  rankAscending,
  yardsPerGameFromWeeks,
} from './vsPosMatchup';

describe('averageLast3FpAllowed', () => {
  it('averages the last three completed weeks that have data', () => {
    const byWeek = new Map<number, number>([
      [5, 10],
      [6, 20],
      [7, 30],
    ]);
    assert.equal(averageLast3FpAllowed(byWeek, 7), 20);
  });

  it('skips missing weeks and averages what remains', () => {
    const byWeek = new Map<number, number>([
      [4, 12],
      [7, 18],
    ]);
    assert.equal(averageLast3FpAllowed(byWeek, 7), 15);
  });

  it('returns undefined when nothing is available', () => {
    assert.equal(averageLast3FpAllowed(undefined, 7), undefined);
    assert.equal(averageLast3FpAllowed(new Map(), 7), undefined);
    assert.equal(averageLast3FpAllowed(new Map([[5, 10]]), 0), undefined);
  });
});

describe('rankAscending', () => {
  it('ranks 1 = lowest value (toughest)', () => {
    const values = new Map([
      ['SEA', 10],
      ['ATL', 30],
      ['BUF', 20],
    ]);
    assert.equal(rankAscending(values, 'SEA'), 1);
    assert.equal(rankAscending(values, 'BUF'), 2);
    assert.equal(rankAscending(values, 'ATL'), 3);
  });
});

describe('yardsPerGameFromWeeks', () => {
  it('averages net pass yards across games with data', () => {
    const byWeek = new Map([
      [1, 160],
      [2, 287],
      [3, 246],
      [4, 247],
      [5, 190],
      [7, 287],
    ]);
    assert.equal(yardsPerGameFromWeeks(byWeek), 236.2);
  });
});

describe('buildVsPosMatchup', () => {
  it('returns undefined on bye or missing opponent', () => {
    assert.equal(
      buildVsPosMatchup({
        bye: true,
        opponent: 'ATL',
        position: 'RB',
        season: 2026,
        completedWeeks: 7,
        ranks: null,
        averages: null,
        weeklyFpa: null,
      }),
      undefined
    );
    assert.equal(
      buildVsPosMatchup({
        opponent: undefined,
        position: 'RB',
        season: 2026,
        completedWeeks: 7,
        ranks: null,
        averages: null,
        weeklyFpa: null,
      }),
      undefined
    );
  });

  it('attaches OPRK, season FPA, last-3 FPA, and FPA ranks when provided', () => {
    const ranks = new Map([['RB' as const, new Map([['ATL', 25]])]]);
    const averages = new Map([
      [
        'RB' as const,
        new Map([
          ['SEA', 10],
          ['ATL', 22.4],
          ['BUF', 18],
        ]),
      ],
    ]);
    const weeklyFpa = new Map([
      [
        'RB',
        new Map([
          [
            'ATL',
            new Map([
              [5, 10],
              [6, 20],
              [7, 30],
            ]),
          ],
          [
            'SEA',
            new Map([
              [5, 5],
              [6, 5],
              [7, 5],
            ]),
          ],
          [
            'BUF',
            new Map([
              [5, 15],
              [6, 15],
              [7, 15],
            ]),
          ],
        ]),
      ],
    ]);
    const m = buildVsPosMatchup({
      opponent: 'ATL',
      position: 'RB',
      season: 2026,
      completedWeeks: 7,
      ranks,
      averages,
      weekly: emptyWeeklyDefenseAllowed({ fpaByPos: weeklyFpa }),
    });
    assert.ok(m);
    assert.equal(m!.opponent, 'ATL');
    assert.equal(m!.position, 'RB');
    assert.equal(m!.oprkRank, 25);
    assert.equal(m!.fpAllowedPerGame, 22.4);
    assert.equal(m!.fpAllowedRank, 3);
    assert.equal(m!.last3FpAllowed, 20);
    assert.equal(m!.last3FpAllowedRank, 3);
    assert.equal(m!.tdsAllowed, undefined);
  });

  it('uses nflverse net pass yards/TDs for QB plus air/rush splits', () => {
    const miaPass = new Map([
      [1, 160],
      [2, 287],
      [3, 246],
      [4, 247],
      [5, 190],
      [7, 287],
    ]);
    const miaRush = new Map([
      [5, 20],
      [7, 40],
    ]);
    const weekly = emptyWeeklyDefenseAllowed({
      airYdsByPos: new Map([
        [
          'QB',
          new Map([
            ['MIA', miaPass],
            [
              'SEA',
              new Map([
                [1, 100],
                [2, 100],
                [3, 100],
                [4, 100],
                [5, 100],
                [7, 100],
              ]),
            ],
          ]),
        ],
      ]),
      ydsByPos: new Map([
        [
          'QB',
          new Map([
            ['MIA', miaPass],
            [
              'SEA',
              new Map([
                [1, 100],
                [2, 100],
                [3, 100],
                [4, 100],
                [5, 100],
                [7, 100],
              ]),
            ],
          ]),
        ],
      ]),
      rushYdsByPos: new Map([
        [
          'QB',
          new Map([
            ['MIA', miaRush],
            ['SEA', new Map([[5, 5], [7, 5]])],
          ]),
        ],
      ]),
      airTdsByPos: new Map([
        [
          'QB',
          new Map([
            ['MIA', 14],
            ['SEA', 6],
          ]),
        ],
      ]),
      rushTdsByPos: new Map([
        [
          'QB',
          new Map([
            ['MIA', 2],
            ['SEA', 1],
          ]),
        ],
      ]),
      qbPassTds: new Map([
        ['MIA', 14],
        ['SEA', 6],
      ]),
    });
    const m = buildVsPosMatchup({
      opponent: 'MIA',
      position: 'QB',
      season: 2026,
      completedWeeks: 7,
      ranks: null,
      averages: null,
      weekly,
      oppRank: 26,
    });
    assert.ok(m);
    assert.equal(m!.yardsAllowedPerGame, 236.2);
    assert.equal(m!.yardsAllowedRank, 2);
    assert.equal(m!.airYardsPerGame, 236.2);
    // Walks back from week 7: 7,5,4 (skips missing 6) → (287+190+247)/3
    assert.equal(m!.last3AirYards, 241.3);
    assert.equal(m!.last3YardsAllowed, 241.3);
    assert.equal(m!.rushYardsPerGame, 30);
    assert.equal(m!.last3RushYards, 30);
    assert.equal(m!.airTds, 14);
    assert.equal(m!.rushTds, 2);
    // Total TDs = pass + rush
    assert.equal(m!.tdsAllowed, 16);
    assert.equal(m!.tdsAllowedRank, 2);
  });

  it('keeps yards/TDs undefined for K and D/ST', () => {
    const m = buildVsPosMatchup({
      opponent: 'ATL',
      position: 'K',
      season: 2026,
      completedWeeks: 7,
      ranks: null,
      averages: null,
      weekly: null,
      oppRank: 12,
    });
    assert.ok(m);
    assert.equal(m!.oprkRank, 12);
    assert.equal(m!.yardsAllowedPerGame, undefined);
    assert.equal(m!.tdsAllowed, undefined);
    assert.equal(m!.airYardsPerGame, undefined);
    assert.equal(m!.rushYardsPerGame, undefined);
  });
});
