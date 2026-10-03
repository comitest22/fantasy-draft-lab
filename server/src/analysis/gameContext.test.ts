import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampContext, contextAdjustment, CONTEXT_CAP, describeGameWeather } from './gameContext';

const base = {
  home: false,
  consecutiveAwayBefore: 0,
  traveling: true,
  divisional: false,
  outdoor: false,
};

describe('contextAdjustment', () => {
  it('caps the overlay at ±4', () => {
    assert.equal(clampContext(9), CONTEXT_CAP);
    assert.equal(clampContext(-9), -CONTEXT_CAP);
  });

  it('boosts a home game after a road streak', () => {
    const { adj, notes } = contextAdjustment({
      ...base,
      home: true,
      traveling: false,
      consecutiveAwayBefore: 2,
    });
    assert.equal(adj, 1.5);
    assert.ok(notes.some((n) => /home after/i.test(n)));
  });

  it('flips the sign in loser mode', () => {
    const win = contextAdjustment({ ...base, home: true, traveling: false, consecutiveAwayBefore: 2 }, 'win');
    const lose = contextAdjustment({ ...base, home: true, traveling: false, consecutiveAwayBefore: 2 }, 'lose');
    assert.equal(lose.adj, -win.adj);
  });

  it('does not overturn a large PoolGenius gap', () => {
    const { adj } = contextAdjustment({
      ...base,
      restDays: 4,
      divisional: true,
      tzHoursWestToEast: 3,
      earlyWindow: true,
      teamRoadWinPct: 0.2,
      qbRoadWinPct: 0.2,
      outdoor: true,
      forecastWindMph: 20,
      qbBadWeather: true,
    });
    assert.ok(Math.abs(adj) <= CONTEXT_CAP);
  });
});

describe('describeGameWeather', () => {
  it('uses a closed-dome label for indoor and retractable roofs', () => {
    const dome = describeGameWeather({ roof: 'dome', stadium: 'Ford Field', forecast: { outdoor: false } });
    assert.equal(dome?.kind, 'dome');
    assert.match(dome?.label ?? '', /Ford Field/);
    assert.match(dome?.label ?? '', /should not affect TD odds/i);
    const retract = describeGameWeather({
      roof: 'retractable',
      stadium: 'Mercedes-Benz Stadium',
      forecast: { outdoor: false },
    });
    assert.equal(retract?.kind, 'dome');
    assert.match(retract?.label ?? '', /Mercedes-Benz Stadium/);
  });

  it('describes outdoor rain and fair weather', () => {
    const rain = describeGameWeather({
      roof: 'outdoor',
      forecast: { outdoor: true, tempF: 68, windMph: 8, precipIn: 0.24 },
    });
    assert.equal(rain?.kind, 'rain');
    assert.match(rain?.label ?? '', /0\.24" rain/);
    assert.match(rain?.label ?? '', /passing TDs/i);
    const fair = describeGameWeather({
      roof: 'outdoor',
      forecast: { outdoor: true, tempF: 74, windMph: 9, precipIn: 0 },
    });
    assert.equal(fair?.kind, 'sun');
    assert.match(fair?.label ?? '', /not expected to change TD odds/i);
  });
});
