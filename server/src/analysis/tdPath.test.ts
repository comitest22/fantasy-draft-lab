import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignPrimaries,
  pickAlternate,
  survivalP,
  week1Survival,
  type TdPathPlayer,
} from './tdPath';

function p(name: string, chance: number, team: string, opp: string): TdPathPlayer {
  return { playerName: name, tdChance: chance, nflTeam: team, opp };
}

describe('td path assignment', () => {
  it('week 1 survival is either-scores', () => {
    assert.equal(Math.round(week1Survival(50, 50) * 1000) / 1000, 0.75);
    assert.ok(week1Survival(60, 40) > survivalP(60));
  });

  it('never repeats a primary', () => {
    const byWeek = new Map<number, TdPathPlayer[]>([
      [1, [p('Star', 70, 'DET', 'NO'), p('QB', 65, 'BUF', '@BAL'), p('RB2', 40, 'SF', 'SEA')]],
      [2, [p('Star', 55, 'DET', '@CHI'), p('QB', 50, 'BUF', 'NYJ'), p('RB2', 35, 'SF', '@LA')]],
      [3, [p('Star', 40, 'DET', 'GB'), p('QB', 38, 'BUF', '@MIA'), p('RB2', 62, 'SF', 'NYG')]],
    ]);
    const slots = assignPrimaries(byWeek, 3);
    const names = [slots.get(1)?.primary?.playerName, slots.get(1)?.primary2?.playerName, slots.get(2)?.primary?.playerName, slots.get(3)?.primary?.playerName].filter(Boolean);
    assert.equal(new Set(names).size, names.length);
  });

  it('saves a star for a much better later week instead of burning them early', () => {
    const byWeek = new Map<number, TdPathPlayer[]>([
      [1, [p('Star', 48, 'DET', 'NO'), p('Other', 47, 'BUF', '@BAL'), p('Filler', 45, 'KC', 'LV')]],
      [2, [p('Star', 70, 'DET', '@CHI'), p('Other', 46, 'BUF', 'NYJ'), p('Filler', 44, 'KC', '@LAC')]],
    ]);
    const slots = assignPrimaries(byWeek, 2);
    assert.equal(slots.get(2)?.primary?.playerName, 'Star');
    assert.notEqual(slots.get(1)?.primary?.playerName, 'Star');
    assert.notEqual(slots.get(1)?.primary2?.playerName, 'Star');
  });

  it('week 1 primaries come from different games', () => {
    const byWeek = new Map<number, TdPathPlayer[]>([
      [1, [p('A', 70, 'DET', 'CHI'), p('B', 69, 'CHI', '@DET'), p('C', 50, 'BUF', 'NYJ')]],
    ]);
    const slots = assignPrimaries(byWeek, 1);
    const a = slots.get(1)?.primary;
    const b = slots.get(1)?.primary2;
    assert.ok(a && b);
    assert.notEqual(a.nflTeam, b.nflTeam);
    const games = [ [a.nflTeam, (a.opp ?? '').replace(/^@/, '')].sort().join('|'), [b.nflTeam, (b.opp ?? '').replace(/^@/, '')].sort().join('|') ];
    assert.notEqual(games[0], games[1]);
  });

  it('alternate may be a later-week starter', () => {
    const star = p('Star', 70, 'DET', 'NO');
    const sit = p('Sit', 40, 'SF', 'SEA');
    const alt = pickAlternate([star, sit], [sit], new Set());
    assert.equal(alt?.playerName, 'Star');
  });

  it('alternate skips burned names', () => {
    const pool = [p('Star', 70, 'DET', 'NO'), p('Alt', 40, 'SF', 'SEA'), p('Other', 38, 'KC', 'LV')];
    const alt = pickAlternate(pool, [pool[0]], new Set(['Other']));
    assert.equal(alt?.playerName, 'Alt');
  });

  it('hardest-first product beats taking the same star every week', () => {
    const byWeek = new Map<number, TdPathPlayer[]>([
      [1, [p('Star', 50, 'DET', 'NO'), p('QB', 49, 'BUF', '@BAL')]],
      [2, [p('Star', 68, 'DET', '@CHI'), p('QB', 40, 'BUF', 'NYJ')]],
    ]);
    const assigned = assignPrimaries(byWeek, 2);
    assert.equal(assigned.get(2)?.primary?.playerName, 'Star');
    const names = [assigned.get(1)?.primary?.playerName, assigned.get(1)?.primary2?.playerName, assigned.get(2)?.primary?.playerName];
    assert.equal(new Set(names.filter(Boolean)).size, names.filter(Boolean).length);
  });

  it('keeps locked starters and fills the rest around them', () => {
    const byWeek = new Map<number, TdPathPlayer[]>([
      [1, [p('LockA', 40, 'DET', 'NO'), p('LockB', 39, 'BUF', '@BAL'), p('Other', 80, 'KC', 'LV')]],
      [2, [p('LockA', 70, 'DET', '@CHI'), p('Star', 68, 'SF', 'SEA'), p('Other', 40, 'KC', '@LAC')]],
    ]);
    const locked = new Map([
      [1, { primary: p('LockA', 40, 'DET', 'NO'), primary2: p('LockB', 39, 'BUF', '@BAL') }],
    ]);
    const slots = assignPrimaries(byWeek, 2, { locked, banned: ['Other'] });
    assert.equal(slots.get(1)?.primary?.playerName, 'LockA');
    assert.equal(slots.get(1)?.primary2?.playerName, 'LockB');
    assert.equal(slots.get(2)?.primary?.playerName, 'Star');
  });
});
