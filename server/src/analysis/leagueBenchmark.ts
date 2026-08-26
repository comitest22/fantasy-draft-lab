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
    const standingEntry = Object.values(config.seasons).find(
      (s) => s.userTeamName === teamName
    );

    return {
      fantasyTeamName: teamName,
      finalStanding: standingEntry?.finalStanding,
      draftGrade: computeDraftGrade(graded),
      totalValue: rates.totalValue,
      hitRate: rates.hitRate,
      bustRate: rates.bustRate,
    };
  });
}

export function compareUserToTop3(
  analysis: SeasonAnalysis,
  draft: DraftFile,
  config: LeagueConfig
): string[] {
  const insights: string[] = [];
  const benchmarks = benchmarkTeams(draft, config);
  const top3 = benchmarks
    .filter((b) => b.finalStanding != null && b.finalStanding <= 3)
    .sort((a, b) => (a.finalStanding ?? 99) - (b.finalStanding ?? 99));

  if (top3.length === 0 || !analysis.userTeamName) return insights;

  const userBench = benchmarks.find(
    (b) => b.fantasyTeamName === analysis.userTeamName
  );
  if (!userBench) return insights;

  const top3AvgGrade = top3.reduce((s, t) => s + t.draftGrade, 0) / top3.length;
  const gradeGap = top3AvgGrade - userBench.draftGrade;

  if (gradeGap >= 10) {
    insights.push(
      `In ${draft.season}, top-3 teams averaged a ${top3AvgGrade.toFixed(0)} draft grade vs your ${userBench.draftGrade}.`
    );
  }

  return insights;
}

export function getUserPicks(gradedPicks: GradedPick[]): GradedPick[] {
  return gradedPicks.filter((p) => p.isUserPick).sort((a, b) => a.overallPick - b.overallPick);
}
