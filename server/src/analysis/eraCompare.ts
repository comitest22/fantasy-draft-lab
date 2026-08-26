import type {
  DraftFile,
  EraComparison,
  EraStats,
  LeagueConfig,
  Position,
  SeasonAnalysis,
} from '../types';
import { gradeDraftPicks, computeDraftGrade, computeRates } from './valueOverADP';
import { computePositionalTiming, comparePositionalTiming } from './positionalTiming';
import { computeReachRate } from './reachRate';
import { enrichmentStore } from '../data/enrichment';
import { sortBySeason, sortSeasons } from '../utils/sort';

const SKILL_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function getTopTeams(draft: DraftFile, config: LeagueConfig): string[] {
  const seasonConfig = config.seasons[String(draft.season)];
  if (seasonConfig?.teamStandings) {
    return Object.entries(seasonConfig.teamStandings)
      .filter(([, standing]) => standing <= 3)
      .sort(([, a], [, b]) => a - b)
      .map(([team]) => team);
  }
  return [];
}

export async function analyzeSeason(
  draft: DraftFile,
  config: LeagueConfig
): Promise<SeasonAnalysis> {
  await enrichmentStore.load();

  const seasonKey = String(draft.season);
  const seasonConfig = config.seasons[seasonKey] ?? {};
  const userTeamName = seasonConfig.userTeamName;

  const gradedPicks = gradeDraftPicks(draft.picks, userTeamName);
  const rates = computeRates(gradedPicks);
  const top3Teams = getTopTeams(draft, config);

  const positionalTiming = computePositionalTiming(
    draft,
    gradedPicks,
    userTeamName,
    top3Teams
  );

  const insights: string[] = [];

  if (userTeamName) {
    const reaches = gradedPicks.filter(
      (p) => p.isUserPick && p.grade === 'reach'
    );
    if (reaches.length >= 3) {
      insights.push(
        `You reached on ${reaches.length} picks in ${draft.season} — consider sticking closer to ADP.`
      );
    }

    for (const pt of positionalTiming) {
      if (pt.userRound != null && pt.userRound < pt.leagueAvgRound - 1) {
        insights.push(
          `You took your first ${pt.position} in round ${pt.userRound}, earlier than league avg (${pt.leagueAvgRound.toFixed(1)}).`
        );
      }
    }
  }

  return {
    season: draft.season,
    userTeamName,
    finalStanding: seasonConfig.finalStanding,
    draftGrade: computeDraftGrade(gradedPicks),
    totalValue: rates.totalValue,
    hitRate: rates.hitRate,
    bustRate: rates.bustRate,
    reachRate: rates.reachRate,
    picks: gradedPicks,
    positionalTiming,
    insights,
  };
}

function buildEraStats(
  label: string,
  analyses: SeasonAnalysis[],
  seasons: number[]
): EraStats {
  const positionalTiming: Record<Position, number | null> = {
    QB: null,
    RB: null,
    WR: null,
    TE: null,
    K: null,
    'D/ST': null,
  };

  for (const pos of SKILL_POSITIONS) {
    const rounds = analyses
      .flatMap((a) => a.positionalTiming)
      .filter((pt) => pt.position === pos && pt.userRound != null)
      .map((pt) => pt.userRound as number);
    positionalTiming[pos] = rounds.length > 0 ? avg(rounds) : null;
  }

  return {
    label,
    seasons: sortSeasons(seasons, 'asc'),
    avgDraftGrade: avg(analyses.map((a) => a.draftGrade)),
    avgHitRate: avg(analyses.map((a) => a.hitRate)),
    avgBustRate: avg(analyses.map((a) => a.bustRate)),
    avgReachRate: avg(analyses.map((a) => a.reachRate)),
    positionalTiming,
  };
}

export async function compareEras(
  drafts: DraftFile[],
  config: LeagueConfig
): Promise<EraComparison> {
  const analyses: SeasonAnalysis[] = [];
  for (const draft of drafts) {
    analyses.push(await analyzeSeason(draft, config));
  }

  const goodAnalyses = sortBySeason(
    analyses.filter((a) => a.season <= config.goodEraEnd),
    'asc'
  );
  const badAnalyses = sortBySeason(
    analyses.filter((a) => a.season >= config.badEraStart),
    'asc'
  );

  const goodEra = buildEraStats(
    'Good era',
    goodAnalyses,
    goodAnalyses.map((a) => a.season)
  );
  const badEra = buildEraStats(
    'Bad era',
    badAnalyses,
    badAnalyses.map((a) => a.season)
  );

  const insights: string[] = [];

  if (goodAnalyses.length > 0 && badAnalyses.length > 0) {
    const gradeDiff = badEra.avgDraftGrade - goodEra.avgDraftGrade;
    insights.push(
      `Draft grade dropped ${Math.abs(gradeDiff).toFixed(0)} points from good era (${goodEra.avgDraftGrade.toFixed(0)}) to bad era (${badEra.avgDraftGrade.toFixed(0)}).`
    );

    const hitDiff = badEra.avgHitRate - goodEra.avgHitRate;
    if (Math.abs(hitDiff) >= 0.05) {
      insights.push(
        `Hit rate ${hitDiff > 0 ? 'improved' : 'declined'} by ${(Math.abs(hitDiff) * 100).toFixed(0)}% in the bad era.`
      );
    }

    const reachDiff = badEra.avgReachRate - goodEra.avgReachRate;
    if (reachDiff >= 0.05) {
      insights.push(
        `Reach rate increased by ${(reachDiff * 100).toFixed(0)}% in the bad era — draft discipline may have slipped.`
      );
    }

    const goodTiming = goodAnalyses.flatMap((a) => a.positionalTiming);
    const badTiming = badAnalyses.flatMap((a) => a.positionalTiming);
    insights.push(...comparePositionalTiming(goodTiming, badTiming));
  }

  return { goodEra, badEra, insights };
}

export { computeReachRate };
