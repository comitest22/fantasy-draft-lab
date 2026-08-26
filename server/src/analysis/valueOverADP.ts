import type { DraftPick, GradedPick, PickGrade } from '../types';
import { enrichmentStore } from '../data/enrichment';

const REACH_THRESHOLD = 12;
const STEAL_THRESHOLD = 12;

export function gradePick(
  pick: DraftPick,
  isUserPick: boolean
): GradedPick {
  const adpEntry = enrichmentStore.getAdp(pick.playerName, pick.season);
  const adp = adpEntry?.adp;
  const fantasyPoints = enrichmentStore.getFantasyPoints(pick.playerName, pick.season);
  const expectedPoints =
    adp != null
      ? adpEntry?.expectedPoints ?? enrichmentStore.getExpectedPointsAtAdp(adp, pick.season)
      : undefined;

  let valueScore: number | undefined;
  let grade: PickGrade = 'unknown';

  if (fantasyPoints != null && expectedPoints != null) {
    valueScore = fantasyPoints - expectedPoints;
    if (valueScore >= 40) grade = 'hit';
    else if (valueScore >= 10) grade = 'fair';
    else if (valueScore <= -30) grade = 'bust';
    else grade = 'fair';
  }

  if (adp != null) {
    const adpDelta = pick.overallPick - adp;
    if (adpDelta >= REACH_THRESHOLD && grade !== 'hit') grade = 'reach';
    if (adpDelta <= -STEAL_THRESHOLD && grade !== 'bust') grade = 'steal';
  }

  return {
    ...pick,
    adp,
    fantasyPoints,
    expectedPoints,
    valueScore,
    grade,
    isUserPick,
  };
}

export function gradeDraftPicks(
  picks: DraftPick[],
  userTeamName?: string
): GradedPick[] {
  return picks.map((pick) =>
    gradePick(pick, userTeamName ? pick.fantasyTeamName === userTeamName : false)
  );
}

export function computeDraftGrade(gradedPicks: GradedPick[]): number {
  const userPicks = gradedPicks.filter((p) => p.isUserPick);
  if (userPicks.length === 0) return 0;

  const scored = userPicks.filter((p) => p.valueScore != null);
  if (scored.length === 0) return 50;

  const avgValue =
    scored.reduce((sum, p) => sum + (p.valueScore ?? 0), 0) / scored.length;

  return Math.max(0, Math.min(100, Math.round(50 + avgValue)));
}

export function computeRates(gradedPicks: GradedPick[]): {
  hitRate: number;
  bustRate: number;
  reachRate: number;
  totalValue: number;
} {
  const userPicks = gradedPicks.filter((p) => p.isUserPick);
  if (userPicks.length === 0) {
    return { hitRate: 0, bustRate: 0, reachRate: 0, totalValue: 0 };
  }

  const hits = userPicks.filter((p) => p.grade === 'hit' || p.grade === 'steal').length;
  const busts = userPicks.filter((p) => p.grade === 'bust').length;
  const reaches = userPicks.filter((p) => p.grade === 'reach').length;
  const totalValue = userPicks.reduce((sum, p) => sum + (p.valueScore ?? 0), 0);

  return {
    hitRate: hits / userPicks.length,
    bustRate: busts / userPicks.length,
    reachRate: reaches / userPicks.length,
    totalValue,
  };
}

export { REACH_THRESHOLD, STEAL_THRESHOLD };
