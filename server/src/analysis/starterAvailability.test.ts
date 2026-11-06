import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityAdjustment,
  injurySeverity,
  lastName,
  starterAvailabilityFactors,
  type SkillPlayerSnap,
} from './starterAvailability';

const hurts: SkillPlayerSnap = {
  playerName: 'Jalen Hurts',
  position: 'QB',
  status: 'INJURY_RESERVE',
  fantasyPoints: 80,
  games: 5,
  snapPct: 98.8,
  careerGames: 80,
  rank: 40,
};

const mckee: SkillPlayerSnap = {
  playerName: 'Tanner McKee',
  position: 'QB',
  status: 'ACTIVE',
  fantasyPoints: 12.6,
  games: 1,
  snapPct: 100,
  careerGames: 7, // 2024–26 cameos — still inexperienced vs Hurts
};

const dak: SkillPlayerSnap = {
  playerName: 'Dak Prescott',
  position: 'QB',
  status: 'ACTIVE',
  fantasyPoints: 104.8,
  games: 6,
  snapPct: 100,
  careerGames: 120,
  rank: 50,
};

const baker: SkillPlayerSnap = {
  playerName: 'Baker Mayfield',
  position: 'QB',
  status: 'QUESTIONABLE',
  fantasyPoints: 35.1,
  games: 3,
  snapPct: 97.9,
  careerGames: 100,
  rank: 119,
  rookie: false,
};

const jalon: SkillPlayerSnap = {
  playerName: 'Jalon Daniels',
  position: 'QB',
  status: 'ACTIVE',
  fantasyPoints: 35.4,
  games: 4,
  snapPct: 98.2,
  careerGames: 4,
  rank: 900,
  rookie: true,
};

describe('starterAvailability', () => {
  it('treats IR / OUT as unavailable', () => {
    assert.equal(injurySeverity('INJURY_RESERVE'), 'out');
    assert.equal(injurySeverity('OUT'), 'out');
    assert.equal(injurySeverity('DOUBTFUL'), 'doubtful');
    assert.equal(injurySeverity('QUESTIONABLE'), null);
    assert.equal(injurySeverity('ACTIVE'), null);
    assert.equal(lastName('Jalen Hurts'), 'Hurts');
  });

  it('flags PHI QB out with McKee starting (DAL gets the flip)', () => {
    const phi = availabilityAdjustment({
      team: 'PHI',
      opponent: 'DAL',
      teamPlayers: [hurts, mckee],
      oppPlayers: [dak],
    });
    assert.ok(phi.notes.some((n) => /QB out \(Hurts\).*McKee starting/i.test(n)));
    assert.ok(phi.notes.some((n) => /Inexperienced QB \(McKee\)/i.test(n)));
    assert.ok(phi.adj <= -2.5);

    const dal = availabilityAdjustment({
      team: 'DAL',
      opponent: 'PHI',
      teamPlayers: [dak],
      oppPlayers: [hurts, mckee],
    });
    assert.ok(dal.notes.some((n) => /Opp QB out \(Hurts\).*McKee starting/i.test(n)));
    assert.ok(dal.adj >= 2.5);
  });

  it('picks the snap leader as backup when the starter is out', () => {
    const factors = starterAvailabilityFactors({
      team: 'PHI',
      teamPlayers: [
        hurts,
        mckee,
        {
          playerName: 'Andy Dalton',
          position: 'QB',
          status: 'ACTIVE',
          fantasyPoints: -2,
          games: 1,
          snapPct: 8,
          careerGames: 131,
          rank: 400,
        },
      ],
      oppPlayers: [],
    });
    assert.ok(factors.some((f) => /McKee starting/i.test(f.label)), JSON.stringify(factors));
    assert.equal(factors.some((f) => /Dalton starting/i.test(f.label)), false);
  });

  it('keeps Baker as TB QB1 over a rookie with a tiny FP edge', () => {
    const factors = starterAvailabilityFactors({
      team: 'CAR',
      opponent: 'TB',
      teamPlayers: [],
      oppPlayers: [baker, jalon],
    });
    assert.equal(
      factors.some((f) => /Rookie QB start \(Daniels\)/i.test(f.label)),
      false,
      JSON.stringify(factors),
    );
    assert.equal(factors.some((f) => /Mayfield|Daniels/i.test(f.label)), false);
  });

  it('flags a healthy rookie QB start only when that rookie is the established QB1', () => {
    const factors = starterAvailabilityFactors({
      team: 'NYG',
      teamPlayers: [
        {
          playerName: 'Jaxson Dart',
          position: 'QB',
          status: 'ACTIVE',
          fantasyPoints: 90,
          games: 6,
          snapPct: 100,
          rookie: true,
          careerGames: 6,
          rank: 80,
        },
      ],
      oppPlayers: [],
    });
    assert.ok(factors.some((f) => /Rookie QB start \(Dart\)/i.test(f.label)));
    assert.ok(factors.some((f) => f.points < 0));
  });

  it('flags a lead RB1 out', () => {
    const { notes, adj } = availabilityAdjustment({
      team: 'SF',
      teamPlayers: [
        dak,
        {
          playerName: 'Christian McCaffrey',
          position: 'RB',
          status: 'OUT',
          fantasyPoints: 120,
          snapPct: 80,
          sharePct: 70,
          careerGames: 90,
        },
      ],
      oppPlayers: [],
    });
    assert.ok(notes.some((n) => /RB1 out \(McCaffrey\)/i.test(n)));
    assert.ok(adj < 0);
  });
});
