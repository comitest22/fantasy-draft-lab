import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlayerString,
  computeOverallPick,
  parseEspnDraftText,
  assignDraftSlots,
} from '../parsers/espnDocxParser';

describe('parsePlayerString', () => {
  it('parses standard RB format', () => {
    const result = parsePlayerString('Adrian Peterson Min, RB');
    assert.deepEqual(result, {
      playerName: 'Adrian Peterson',
      nflTeam: 'Min',
      position: 'RB',
    });
  });

  it('parses D/ST format', () => {
    const result = parsePlayerString('Seahawks D/ST Sea, D/ST');
    assert.deepEqual(result, {
      playerName: 'Seahawks D/ST',
      nflTeam: 'Sea',
      position: 'D/ST',
    });
  });

  it('parses multi-word names', () => {
    const result = parsePlayerString("Odell Beckham Jr. NYG, WR");
    assert.equal(result?.playerName, 'Odell Beckham Jr.');
    assert.equal(result?.position, 'WR');
  });
});

describe('computeOverallPick', () => {
  it('computes snake pick for odd rounds', () => {
    assert.equal(computeOverallPick(1, 3, 10), 3);
    assert.equal(computeOverallPick(3, 1, 10), 21);
  });

  it('computes snake pick for even rounds', () => {
    assert.equal(computeOverallPick(2, 1, 10), 20);
    assert.equal(computeOverallPick(2, 10, 10), 11);
  });
});

describe('parseEspnDraftText', () => {
  const sample = `Round 1
NO.
Player
Team
1
Adrian Peterson Min, RB
Team Alpha
2
Le'Veon Bell Pit, RB
Team Beta
Round 2
NO.
Player
Team
1
Dez Bryant Dal, WR
Team Beta
2
C.J. Anderson Den, RB
Team Alpha`;

  it('parses multi-round draft', () => {
    const result = parseEspnDraftText(sample, 2015, {
      leagueSize: 2,
    });
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.rounds, 2);
    assert.equal(result.picks.length, 4);
    assert.equal(result.picks[0].playerName, 'Adrian Peterson');
    assert.equal(result.picks[0].overallPick, 1);
    assert.equal(result.picks[3].overallPick, 3);
    assert.deepEqual(result.fantasyTeamNames.sort(), ['Team Alpha', 'Team Beta']);
  });

  it('assigns draft slots from round 1', () => {
    const result = parseEspnDraftText(sample, 2015, {
      leagueSize: 2,
    });
    const alpha = result.picks.find((p) => p.fantasyTeamName === 'Team Alpha');
    const beta = result.picks.find((p) => p.fantasyTeamName === 'Team Beta');
    assert.equal(alpha?.draftSlot, 1);
    assert.equal(beta?.draftSlot, 2);
  });

  it('infers 14 rounds without requiring a fixed round count', () => {
    const lines = ['Round 1', 'NO.', 'Player', 'Team'];
    for (let pick = 1; pick <= 2; pick++) {
      lines.push(String(pick), `Player ${pick} NE, RB`, `Team ${pick}`);
    }
    for (let round = 2; round <= 14; round++) {
      lines.push(`Round ${round}`, 'NO.', 'Player', 'Team');
      for (let pick = 1; pick <= 2; pick++) {
        lines.push(String(pick), `Player R${round}P${pick} NE, WR`, `Team ${pick}`);
      }
    }

    const result = parseEspnDraftText(lines.join('\n'), 2017, { leagueSize: 2 });
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.rounds, 14);
    assert.equal(result.picks.length, 28);
  });
});

describe('assignDraftSlots', () => {
  it('maps team to slot', () => {
    const picks = [
      {
        round: 1,
        pickInRound: 5,
        overallPick: 5,
        playerName: 'Test',
        nflTeam: 'NYG',
        position: 'WR' as const,
        fantasyTeamName: 'My Team',
      },
    ];
    const result = assignDraftSlots(picks, 10);
    assert.equal(result[0].draftSlot, 5);
  });
});
