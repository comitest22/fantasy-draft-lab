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
import { compareUserToTop3 } from './leagueBenchmark';
import {
  buildPodiumSnapshot,
  draftSlotFor,
  getSeasonStandings,
  openingPicks,
  seasonContenderInsights,
} from './contenderPlaybook';

const SKILL_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function getTopTeams(draft: DraftFile, config: LeagueConfig): string[] {
  return getSeasonStandings(config, draft.season)
    .filter((t) => t.standing <= 3)
    .map((t) => t.teamName);
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
  const podium = buildPodiumSnapshot(draft, config);
  const userDraftSlot = userTeamName ? draftSlotFor(draft, userTeamName) : undefined;
  const userFirstThree = userTeamName ? openingPicks(draft, userTeamName, 3) : [];

  insights.push(
    ...seasonContenderInsights(
      draft,
      config,
      userTeamName,
      userDraftSlot,
      userFirstThree,
      podium
    )
  );

  if (!enrichmentStore.hasSeasonPoints(draft.season)) {
    insights.unshift(
      `${draft.season} is in progress — pick badges are steal/reach vs ESPN PPR rank, not end-of-season hits and busts.`
    );
    if (userDraftSlot != null && userFirstThree.length > 0) {
      insights.push(
        `You opened ${userFirstThree.map((p) => p.position).join('-')} from slot ${userDraftSlot}: ${userFirstThree.map((p) => p.playerName).join(', ')}.`
      );
    }
  }

  if (userTeamName) {
    const reaches = gradedPicks.filter(
      (p) => p.isUserPick && p.grade === 'reach'
    );
    if (reaches.length >= 3) {
      insights.push(
        `You reached on ${reaches.length} picks in ${draft.season} — podium teams in this league stay closer to ADP early.`
      );
    }
  }

  const analysis: SeasonAnalysis = {
    season: draft.season,
    userTeamName,
    finalStanding: seasonConfig.finalStanding,
    userDraftSlot,
    userFirstThree,
    podium,
    draftGrade: computeDraftGrade(gradedPicks),
    totalValue: rates.totalValue,
    hitRate: rates.hitRate,
    bustRate: rates.bustRate,
    reachRate: rates.reachRate,
    picks: gradedPicks,
    positionalTiming,
    insights,
  };

  analysis.insights.push(...compareUserToTop3(analysis));
  analysis.insights = analysis.insights.slice(0, 6);

  return analysis;
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
    seasons: sortSeasons(seasons, 'desc'),
    avgDraftGrade: avg(analyses.map((a) => a.draftGrade)),
    avgHitRate: avg(analyses.map((a) => a.hitRate)),
    avgBustRate: avg(analyses.map((a) => a.bustRate)),
    avgReachRate: avg(analyses.map((a) => a.reachRate)),
    positionalTiming,
  };
}

export async function compareEras(
  drafts: DraftFile[],
  config: LeagueConfig,
  precomputed?: SeasonAnalysis[]
): Promise<EraComparison> {
  await enrichmentStore.load();

  const analyses: SeasonAnalysis[] =
    precomputed && precomputed.length > 0 ? precomputed : [];
  if (analyses.length === 0) {
    for (const draft of drafts) {
      analyses.push(await analyzeSeason(draft, config));
    }
  }

  const scored = analyses.filter((a) => enrichmentStore.hasSeasonPoints(a.season));
  const goodAnalyses = sortBySeason(
    scored.filter((a) => a.season <= config.goodEraEnd),
    'asc'
  );
  const badAnalyses = sortBySeason(
    scored.filter((a) => a.season >= config.badEraStart),
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
