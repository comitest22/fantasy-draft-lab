import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asTdPos,
  blendRates,
  buildMatchup,
  combinedMatchupRank,
  estimateTdChance,
  formatMismatch,
  formatKickoffDate,
  formatMatchupMeta,
  formatTdReason,
  formatVenueSplit,
  sampleYearsFromGames,
  ranksDesc,
  scoredInWeek,
  summarizeTdHistory,
  type TdDefenseSeason,
  type TdPlayerSeason,
} from './tdMatchup';
import { currentSeasonWeight } from './sosBlend';

function player(partial: Partial<TdPlayerSeason> & Pick<TdPlayerSeason, 'playerName' | 'season'>): TdPlayerSeason {
  return {
    position: 'RB',
    games: 17,
    tds: 12,
    yds: 1400,
    hitGames: 10,
    teamTds: 40,
    posTds: 24,
    weeks: new Map(),
    ...partial,
  };
}

function def(partial: Partial<TdDefenseSeason> & Pick<TdDefenseSeason, 'team' | 'season'>): TdDefenseSeason {
  return {
    position: 'RB',
    games: 17,
    yds: 2000,
    tds: 20,
    ...partial,
  };
}

describe('td matchup helpers', () => {
  it('maps FB to RB', () => {
    assert.equal(asTdPos('FB'), 'RB');
    assert.equal(asTdPos('K'), undefined);
  });

  it('ranks the defense that allows the most TDs first', () => {
    const ranks = ranksDesc(
      new Map([
        ['NO', 1.4],
        ['BAL', 0.4],
        ['CHI', 1.4],
      ]),
    );
    assert.equal(ranks.get('CHI'), 1);
    assert.equal(ranks.get('NO'), 2);
    assert.equal(ranks.get('BAL'), 3);
  });

  it('weights TDs allowed more than yards in the combined rank', () => {
    assert.equal(combinedMatchupRank(10, 2), 5);
  });

  it('uses the same week-5 fade as SOS', () => {
    assert.equal(currentSeasonWeight(1), 0.25);
    const blended = blendRates(1, 0, 1);
    assert.equal(blended, 0.25);
    assert.equal(blendRates(1, 0, 5), 1);
  });

  it('nudges TD chance up vs a leaky defense and a high positional share', () => {
    const soft = estimateTdChance({
      position: 'RB',
      hitRate: 0.5,
      posShare: 0.7,
      oppTdsPg: 1.6,
      leagueAvgOppTdsPg: 0.8,
      teamWinPct: 70,
    });
    const tough = estimateTdChance({
      position: 'RB',
      hitRate: 0.5,
      posShare: 0.2,
      oppTdsPg: 0.3,
      leagueAvgOppTdsPg: 0.8,
      teamWinPct: 30,
    });
    assert.ok(soft > tough);
    assert.ok(soft <= 72);
    assert.ok(tough >= 8);
  });

  it('marks scored / missed only after the week is complete', () => {
    const row = player({
      playerName: 'Jahmyr Gibbs',
      season: 2026,
      weeks: new Map([
        [1, 2],
        [2, 0],
      ]),
    });
    assert.equal(scoredInWeek(row, 1, 1), true);
    assert.equal(scoredInWeek(row, 2, 1), null);
    assert.equal(scoredInWeek(row, 2, 2), false);
    assert.equal(scoredInWeek(row, 3, 3), false);
    assert.equal(scoredInWeek(undefined, 1, 1), null);
  });

  it('prefers this-year last game and blends rates at week 1', () => {
    const view = buildMatchup({
      position: 'RB',
      week: 2,
      completedWeeks: 1,
      teamWinPct: 60,
      priorPlayer: player({ playerName: 'A', season: 2025, hitGames: 0, games: 10, tds: 0, posTds: 20 }),
      ytdPlayer: player({
        playerName: 'A',
        season: 2026,
        hitGames: 1,
        games: 1,
        tds: 2,
        posTds: 2,
        weeks: new Map([[1, 2]]),
      }),
      priorDef: def({ team: 'NO', season: 2025, yds: 1700, tds: 10, games: 17, lastWeek: 18, lastYds: 80, lastTds: 0 }),
      ytdDef: def({
        team: 'NO',
        season: 2026,
        yds: 200,
        tds: 3,
        games: 1,
        lastWeek: 1,
        lastYds: 200,
        lastTds: 3,
        lastOpp: 'ARI',
      }),
      oppYdsRank: 4,
      oppTdsRank: 2,
      leagueAvgOppTdsPg: 0.8,
    });
    assert.equal(view.lastGameWeek, 1);
    assert.equal(view.lastGameTds, 3);
    assert.equal(view.lastGameOpp, 'ARI');
    assert.equal(view.matchupRank, 3);
    assert.equal(view.scoredTd, null);
    assert.ok((view.hitRate ?? 0) > 0 && (view.hitRate ?? 1) < 1);
    assert.ok((view.tdChance ?? 0) > 20);
  });

  it('writes a plain-English reason for a tough QB rushing matchup', () => {
    const text = formatTdReason(
      {
        matchupRank: 28,
        oppTdsPg: 0.2,
        hitRate: 0.63,
        posTdShare: 1,
        lastGameTds: 0,
        tdChance: 50,
      },
      { playerName: 'Josh Allen', position: 'QB', opp: 'DET' },
    );
    assert.match(text, /tough matchup/i);
    assert.match(text, /stingy/i);
    assert.doesNotMatch(text, /SOS|PPR|proj/i);
  });

  it('mentions home vs that opponent in the reason', () => {
    const text = formatTdReason(
      {
        matchupRank: 10,
        oppTdsPg: 0.9,
        hitRate: 0.5,
        thisWeekHome: true,
        vsVenueGames: 3,
        vsVenueTds: 2,
      },
      { playerName: 'Derrick Henry', position: 'RB', opp: 'CLE' },
    );
    assert.match(text, /At home vs CLE he has 2 TD in 3 games/i);
  });

  it('summarizes 5-year TD history vs an opponent', () => {
    const hist = summarizeTdHistory(
      [
        { playerName: 'Star', season: 2026, week: 1, opp: 'NO', tds: 2 },
        { playerName: 'Star', season: 2025, week: 17, opp: 'CHI', tds: 0 },
        { playerName: 'Star', season: 2025, week: 16, opp: 'NO', tds: 1 },
        { playerName: 'Star', season: 2024, week: 8, opp: 'NO', tds: 0 },
        { playerName: 'Star', season: 2024, week: 7, opp: 'GB', tds: 1 },
        { playerName: 'Star', season: 2023, week: 3, opp: 'NO', tds: 0 },
      ],
      '@NO',
    );
    assert.equal(hist.totalTds, 4);
    assert.equal(hist.totalGames, 6);
    assert.equal(hist.last5Tds, 4);
    assert.equal(hist.last5Games, 5);
    assert.equal(hist.vsOppGames, 4);
    assert.equal(hist.vsOppTds, 3);
    assert.equal(hist.vsOppHits, 2);
    assert.equal(hist.vsOppHitPct, 50);
    assert.equal(hist.sampleYears, 4);
    assert.equal(hist.sampleYearsPlus, false);
  });

  it('uses tenure under 5 years, 5 years at exactly 5, and 5+ when longer', () => {
    assert.deepEqual(sampleYearsFromGames([{ season: 2023 }, { season: 2026 }], 2026), { years: 4, plus: false });
    assert.deepEqual(sampleYearsFromGames([{ season: 2023 }, { season: 2025 }], 2026), { years: 4, plus: false });
    assert.deepEqual(sampleYearsFromGames([{ season: 2022 }, { season: 2026 }], 2026), { years: 5, plus: false });
    assert.deepEqual(sampleYearsFromGames([{ season: 2021 }, { season: 2026 }], 2026), { years: 5, plus: true });
    assert.deepEqual(sampleYearsFromGames([{ season: 2022 }, { season: 2026 }], 2026, 2016), { years: 5, plus: true });
    assert.deepEqual(sampleYearsFromGames([{ season: 2022 }, { season: 2026 }], 2026, 2022), { years: 5, plus: false });
    assert.deepEqual(sampleYearsFromGames([{ season: 2026 }], 2026), { years: 1, plus: false });
    assert.deepEqual(sampleYearsFromGames([]), { years: 5, plus: false });
  });

  it('adds average receiving stats vs that opponent', () => {
    const hist = summarizeTdHistory(
      [
        {
          playerName: 'Rashee Rice',
          season: 2026,
          week: 1,
          position: 'WR',
          opp: 'IND',
          tds: 0,
          rec: 8,
          targets: 12,
          recYds: 141,
        },
      ],
      'IND',
    );
    assert.match(hist.vsOppLine ?? '', /Career stats vs IND/);
    assert.match(hist.vsOppLine ?? '', /0 TD in 1 game/);
    assert.match(hist.vsOppLine ?? '', /8 rec \/ 12 tgt \/ 141 yds/);
  });

  it('splits vs-opponent TDs into home and away', () => {
    const hist = summarizeTdHistory(
      [
        { playerName: 'Star', season: 2025, week: 2, opp: 'CLE', tds: 2, home: true },
        { playerName: 'Star', season: 2024, week: 8, opp: 'CLE', tds: 0, home: true },
        { playerName: 'Star', season: 2023, week: 4, opp: 'CLE', tds: 1, home: false },
        { playerName: 'Star', season: 2023, week: 12, opp: 'GB', tds: 1, home: true },
      ],
      'CLE',
    );
    assert.equal(hist.vsOppGames, 3);
    assert.equal(hist.vsOppHomeGames, 2);
    assert.equal(hist.vsOppHomeTds, 2);
    assert.equal(hist.vsOppAwayGames, 1);
    assert.equal(hist.vsOppAwayTds, 1);
  });

  it('formats the path-card matchup meta with date and this week’s venue split', () => {
    assert.equal(formatKickoffDate('2026-09-20T20:25Z'), 'Sun, Sep 20');
    assert.equal(
      formatVenueSplit({
        homeGames: 2,
        homeTds: 2,
        awayGames: 1,
        awayTds: 0,
        thisWeekHome: true,
        opp: 'CAR',
      }),
      '2 TDs in 2 home games vs CAR (Last 5 yrs)',
    );
    assert.equal(
      formatVenueSplit({ homeGames: 1, homeTds: 2, awayGames: 1, awayTds: 0, thisWeekHome: true }),
      '2 TDs in 1 home game (Last 5 yrs)',
    );
    assert.equal(
      formatVenueSplit({
        homeGames: 2,
        homeTds: 2,
        awayGames: 1,
        awayTds: 0,
        thisWeekHome: false,
        opp: '@CLE',
      }),
      '0 TDs in 1 away game vs CLE (Last 5 yrs)',
    );
    assert.equal(
      formatVenueSplit({ homeGames: 0, thisWeekHome: true, opp: 'NYG' }),
      'No home game in the last 5 years vs NYG',
    );
    assert.equal(
      formatVenueSplit({ awayGames: 0, thisWeekHome: false, opp: '@TEN' }),
      'No away game in the last 5 years vs TEN',
    );
    const away = formatMatchupMeta({
      opp: '@CLE',
      thisWeekHome: false,
      kickoff: '2026-09-20T20:25Z',
    });
    assert.equal(away, 'at CLE · Sun, Sep 20');
    const home = formatMatchupMeta({
      opp: 'CLE',
      thisWeekHome: true,
      kickoff: '2026-09-20T20:25Z',
    });
    assert.equal(home, 'vs CLE · Sun, Sep 20');
    assert.equal(
      formatVenueSplit({
        homeGames: 3,
        homeTds: 2,
        awayGames: 2,
        awayTds: 0,
        thisWeekHome: true,
        opp: 'CLE',
      }),
      '2 TDs in 3 home games vs CLE (Last 5 yrs)',
    );
    assert.equal(
      formatVenueSplit({
        homeGames: 3,
        homeTds: 5,
        thisWeekHome: true,
        opp: 'CAR',
        years: 4,
      }),
      '5 TDs in 3 home games vs CAR (Last 4 yrs)',
    );
    assert.equal(
      formatVenueSplit({ homeGames: 0, thisWeekHome: true, opp: 'NYG', years: 3 }),
      'No home game in the last 3 years vs NYG',
    );
    assert.equal(
      formatVenueSplit({ awayGames: 0, thisWeekHome: false, opp: '@TEN', years: 1 }),
      'No away game in the last year vs TEN',
    );
    assert.equal(
      formatVenueSplit({
        homeGames: 3,
        homeTds: 5,
        thisWeekHome: true,
        opp: 'CLE',
        years: 5,
        plus: true,
      }),
      '5 TDs in 3 home games vs CLE (Last 5+ yrs)',
    );
    assert.equal(
      formatVenueSplit({ homeGames: 0, thisWeekHome: true, opp: 'NYG', years: 5, plus: true }),
      'No home game in the last 5+ years vs NYG',
    );
    assert.equal(
      formatVenueSplit({ homeGames: 2, homeTds: 1, thisWeekHome: true, opp: 'SF', years: 5 }),
      '1 TD in 2 home games vs SF (Last 5 yrs)',
    );
  });

  it('labels a positional mismatch with inverted D rank and no you-line', () => {
    assert.match(formatMismatch('RB', 3, 4) ?? '', /mismatch in your favor/i);
    assert.match(formatMismatch('RB', 3, 4) ?? '', /ranks #29/);
    assert.doesNotMatch(formatMismatch('RB', 3, 4) ?? '', /you RB/);
    assert.match(formatMismatch('WR', 2, 28) ?? '', /match up well/i);
    assert.match(formatMismatch('TE', 20, 16) ?? '', /even matchup/i);
    assert.match(formatMismatch('RB', 15, 23) ?? '', /they cover this position well/i);
    assert.match(formatMismatch('RB', 15, 23) ?? '', /ranks #10/);
  });

  it('bumps TD chance after a multi-TD week and a new-team bellcow role', () => {
    const base = estimateTdChance({ position: 'RB', hitRate: 0.4, posShare: 0.7 });
    const hot = estimateTdChance({
      position: 'RB',
      hitRate: 0.4,
      posShare: 0.7,
      lastWeekTds: 2,
      lastOppTds: 2,
      newTeamBellcow: true,
    });
    assert.ok(hot > base);
  });

  it('nudges TD chance from home/away vs this opponent when the sample is at least two games', () => {
    const base = estimateTdChance({ position: 'RB', hitRate: 0.4, posShare: 0.4 });
    const hotVenue = estimateTdChance({
      position: 'RB',
      hitRate: 0.4,
      posShare: 0.4,
      vsVenueGames: 4,
      vsVenueHitRate: 1,
    });
    const coldVenue = estimateTdChance({
      position: 'RB',
      hitRate: 0.4,
      posShare: 0.4,
      vsVenueGames: 4,
      vsVenueHitRate: 0,
    });
    const tooSmall = estimateTdChance({
      position: 'RB',
      hitRate: 0.4,
      posShare: 0.4,
      vsVenueGames: 1,
      vsVenueHitRate: 1,
    });
    assert.ok(hotVenue > base);
    assert.ok(coldVenue < base);
    assert.equal(tooSmall, base);
  });
});
