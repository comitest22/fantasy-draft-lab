import type { DraftPick, GradedPick, PickGrade, Position } from '../types';
import { enrichmentStore } from '../data/enrichment';

const REACH_THRESHOLD = 12;
const STEAL_THRESHOLD = 12;
const POINTS_HIT = 40;
const POINTS_BUST = -30;
const RANK_HIT = 20;
const RANK_BUST = -20;
/** Finish used when a skill player has no EOS PPR row (outside the scored board). */
const UNRANKED_EOS = 301;

function applyOutcomeGrade(valueScore: number, byRank: boolean): PickGrade {
  const hitAt = byRank ? RANK_HIT : POINTS_HIT;
  const bustAt = byRank ? RANK_BUST : POINTS_BUST;
  if (valueScore >= hitAt) return 'hit';
  if (valueScore <= bustAt) return 'bust';
  return 'fair';
}

function canRankGrade(position: Position): boolean {
  return position !== 'K' && position !== 'D/ST';
}

export function gradePick(
  pick: DraftPick,
  isUserPick: boolean
): GradedPick {
  const adpEntry = enrichmentStore.getAdp(pick.playerName, pick.season);
  const adp = adpEntry?.adp;
  const fantasyPoints = enrichmentStore.getFantasyPoints(pick.playerName, pick.season);
  const expectedPoints = adpEntry?.expectedPoints;
  const eosRank = enrichmentStore.getEosRank(pick.playerName, pick.season);
  const isRookie = enrichmentStore.isRookie(pick.playerName, pick.season, pick.position);

  let valueScore: number | undefined;
  let grade: PickGrade = 'unknown';
  let finishRank = eosRank;

  if (fantasyPoints != null && expectedPoints != null) {
    valueScore = fantasyPoints - expectedPoints;
    grade = applyOutcomeGrade(valueScore, false);
  } else if (adp != null && canRankGrade(pick.position)) {
    finishRank = eosRank ?? UNRANKED_EOS;
    const rankDelta = adp - finishRank;
    grade = applyOutcomeGrade(rankDelta, true);
    // Cap so season totals/draft grade stay on a similar scale to PPR value.
    valueScore = Math.max(-50, Math.min(50, rankDelta));
  }

  if (adp != null) {
    const adpDelta = pick.overallPick - adp;
    if (adpDelta >= REACH_THRESHOLD && grade !== 'hit') grade = 'reach';
    if (adpDelta <= -STEAL_THRESHOLD && grade !== 'bust') grade = 'steal';
  }

  // Rookie badge only when we have no rank to grade against
  if (grade === 'unknown' && isRookie && adp == null) {
    grade = 'rookie';
  }

  return {
    ...pick,
    adp,
    fantasyPoints,
    expectedPoints,
    eosRank: finishRank,
    valueScore,
    grade,
    isUserPick,
    isRookie,
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

export { REACH_THRESHOLD, STEAL_THRESHOLD, RANK_HIT, RANK_BUST, UNRANKED_EOS };
