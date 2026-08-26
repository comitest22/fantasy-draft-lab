import type { GradedPick } from '../types';
import { REACH_THRESHOLD } from './valueOverADP';

export function computeReachRate(gradedPicks: GradedPick[]): number {
  const userPicks = gradedPicks.filter((p) => p.isUserPick);
  if (userPicks.length === 0) return 0;

  const reaches = userPicks.filter((p) => {
    if (p.adp == null) return p.grade === 'reach';
    return p.overallPick - p.adp >= REACH_THRESHOLD;
  });

  return reaches.length / userPicks.length;
}

export function listReaches(gradedPicks: GradedPick[]): GradedPick[] {
  return gradedPicks
    .filter((p) => p.isUserPick)
    .filter((p) => {
      if (p.adp == null) return p.grade === 'reach';
      return p.overallPick - p.adp >= REACH_THRESHOLD;
    })
    .sort((a, b) => (b.overallPick - (b.adp ?? 0)) - (a.overallPick - (a.adp ?? 0)));
}

export function listSteals(gradedPicks: GradedPick[]): GradedPick[] {
  return gradedPicks
    .filter((p) => p.isUserPick)
    .filter((p) => p.grade === 'steal' || (p.adp != null && p.overallPick - p.adp <= -12))
    .sort((a, b) => (a.overallPick - (a.adp ?? 999)) - (b.overallPick - (b.adp ?? 999)));
}
