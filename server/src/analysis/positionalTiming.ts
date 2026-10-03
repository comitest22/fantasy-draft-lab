import type { DraftFile, GradedPick, Position, PositionalTimingEntry } from '../types';
import { POSITIONS } from '../parsers/espnDocxParser';

export function getNthRoundForPosition(
  picks: GradedPick[],
  teamName: string,
  position: Position,
  n: number
): number | null {
  const teamPicks = picks
    .filter((p) => p.fantasyTeamName === teamName && p.position === position)
    .sort((a, b) => a.round - b.round || a.overallPick - b.overallPick);
  return teamPicks.length >= n ? teamPicks[n - 1].round : null;
}

export function getFirstRoundForPosition(
  picks: GradedPick[],
  teamName: string,
  position: Position
): number | null {
  return getNthRoundForPosition(picks, teamName, position, 1);
}

export function avgFirstRoundForPosition(
  picks: GradedPick[],
  position: Position,
  teamFilter?: (teamName: string) => boolean
): number {
  const teams = [...new Set(picks.map((p) => p.fantasyTeamName))];
  const rounds: number[] = [];

  for (const team of teams) {
    if (teamFilter && !teamFilter(team)) continue;
    const round = getFirstRoundForPosition(picks, team, position);
    if (round != null) rounds.push(round);
  }

  if (rounds.length === 0) return 0;
  return rounds.reduce((a, b) => a + b, 0) / rounds.length;
}

export function computePositionalTiming(
  draft: DraftFile,
  gradedPicks: GradedPick[],
  userTeamName?: string,
  top3TeamNames: string[] = []
): PositionalTimingEntry[] {
  const skillPositions: Position[] = ['QB', 'RB', 'WR', 'TE'];

  return skillPositions.map((position) => ({
    position,
    userRound: userTeamName
      ? getFirstRoundForPosition(gradedPicks, userTeamName, position)
      : null,
    leagueAvgRound: avgFirstRoundForPosition(gradedPicks, position),
    top3AvgRound:
      top3TeamNames.length > 0
        ? avgFirstRoundForPosition(gradedPicks, position, (t) =>
            top3TeamNames.includes(t)
          )
        : avgFirstRoundForPosition(gradedPicks, position),
  }));
}

export function comparePositionalTiming(
  goodEra: PositionalTimingEntry[],
  badEra: PositionalTimingEntry[]
): string[] {
  const insights: string[] = [];

  for (const pos of POSITIONS.filter((p) => ['QB', 'RB', 'WR', 'TE'].includes(p))) {
    const good = goodEra.find((e) => e.position === pos);
    const bad = badEra.find((e) => e.position === pos);
    if (!good?.userRound || !bad?.userRound) continue;

    const diff = bad.userRound - good.userRound;
    if (Math.abs(diff) >= 1) {
      const direction = diff > 0 ? 'later' : 'earlier';
      insights.push(
        `You drafted ${pos} ${Math.abs(diff).toFixed(1)} rounds ${direction} in bad years vs good years.`
      );
    }
  }

  return insights;
}
