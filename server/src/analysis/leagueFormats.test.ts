import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLeagueFormat,
  formatById,
  hasSuperflex,
  isDefaultLeagueFormat,
  parseTeamSize,
  rosterFromFormat,
} from './leagueFormats';
import type { LeagueConfig } from '../types';

const base: LeagueConfig = {
  leagueSize: 10,
  scoring: 'ppr',
  draftType: 'snake',
  rounds: 14,
  goodEraEnd: 2021,
  badEraStart: 2022,
  upcomingDraftSlot: 8,
  seasons: {},
};

describe('leagueFormats', () => {
  it('defaults teams and format', () => {
    assert.equal(parseTeamSize('9'), 10);
    assert.equal(formatById('nope').id, '2wr-1flex');
    assert.equal(isDefaultLeagueFormat(10, '2wr-1flex'), true);
  });

  it('applies 3 WR / 2 FLEX and clamps the seat', () => {
    const next = applyLeagueFormat(base, 8, '3wr-2flex');
    assert.equal(next.leagueSize, 8);
    assert.equal(next.roster?.wr, 3);
    assert.equal(next.roster?.flex, 2);
    assert.equal(next.upcomingDraftSlot, 8);
    assert.equal(hasSuperflex(next.roster!), false);
  });

  it('applies superflex', () => {
    const roster = rosterFromFormat(formatById('2flex-sf'));
    assert.equal(roster.flex, 2);
    assert.equal(roster.superflex, 1);
    assert.equal(hasSuperflex(roster), true);
  });
});
