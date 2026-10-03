import type { DraftFile, GradedPick, LeagueConfig, SeasonAnalysis } from '../types';
import { gradeDraftPicks, computeDraftGrade, computeRates } from './valueOverADP';

export interface TeamBenchmark {
  fantasyTeamName: string;
  finalStanding?: number;
  draftGrade: number;
  totalValue: number;
  hitRate: number;
  bustRate: number;
}

export function benchmarkTeams(
  draft: DraftFile,
  config: LeagueConfig
): TeamBenchmark[] {
  const teams = [...new Set(draft.picks.map((p) => p.fantasyTeamName))];

  return teams.map((teamName) => {
    const graded = gradeDraftPicks(draft.picks, teamName);
    const rates = computeRates(graded);
    const standing = config.seasons[String(draft.season)]?.teamStandings?.[teamName];

    return {
      fantasyTeamName: teamName,
      finalStanding: standing,
      draftGrade: computeDraftGrade(graded),
      totalValue: rates.totalValue,
      hitRate: rates.hitRate,
      bustRate: rates.bustRate,
    };
  });
}

export function compareUserToTop3(analysis: SeasonAnalysis): string[] {
  const insights: string[] = [];
  if (analysis.podium.length === 0 || !analysis.userTeamName) return insights;

  const top3AvgGrade =
    analysis.podium.reduce((s, t) => s + t.draftGrade, 0) / analysis.podium.length;
  const gradeGap = top3AvgGrade - analysis.draftGrade;

  if (gradeGap >= 10) {
    insights.push(
      `In ${analysis.season}, top-3 teams averaged a ${top3AvgGrade.toFixed(0)} draft grade vs your ${analysis.draftGrade}.`
    );
  }

  return insights;
}

export function getUserPicks(gradedPicks: GradedPick[]): GradedPick[] {
  return gradedPicks.filter((p) => p.isUserPick).sort((a, b) => a.overallPick - b.overallPick);
}
