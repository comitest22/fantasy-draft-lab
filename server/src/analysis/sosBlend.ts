/** Remaining-SOS blend of prior-year stats with through-week current-year stats. */

export type DefStats = { pa: number; oppPass: number; oppRush: number };
export type OffStats = { pointsFor: number };

export type DefPosRanks = {
  overall: number;
  qb: number;
  rb: number;
  wr: number;
  te: number;
};

/** NFL regular-season games for prior-year per-game rates. */
export const NFL_REG_SEASON_GAMES = 17;

/** Soft-anchor: keep stats lead, pull toward ESPN OPRK (Source B polarity). */
export const SOS_STATS_ANCHOR_WEIGHT = 0.6;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Weight on current-season D/O stats. Week 1 → 0.25, then +0.25/week, 100% at week 4. */
export function currentSeasonWeight(completedWeeks: number): number {
  const weeks = Math.max(0, completedWeeks);
  if (weeks <= 0) return 0;
  return Math.min(1, 0.25 + 0.25 * (weeks - 1));
}

/** Weight on preseason DraftEdge/FPA. Preseason = 1; Week 1 → 0.75, gone by week 4. */
export function priorFade(completedWeeks: number): number {
  const weeks = Math.max(0, completedWeeks);
  if (weeks <= 0) return 1;
  return Math.max(0, 0.75 - 0.25 * (weeks - 1));
}

export function blendStat(current: number | undefined, prior: number | undefined, weight: number): number | undefined {
  if (current == null && prior == null) return undefined;
  if (current == null) return prior;
  if (prior == null) return current;
  return weight * current + (1 - weight) * prior;
}

export function rankDesc(rows: Array<{ team: string; value: number }>): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.team.localeCompare(b.team));
  const out = new Map<string, number>();
  sorted.forEach((row, i) => out.set(row.team, i + 1));
  return out;
}

export function rankAsc(rows: Array<{ team: string; value: number }>): Map<string, number> {
  const sorted = [...rows].sort((a, b) => a.value - b.value || a.team.localeCompare(b.team));
  const out = new Map<string, number>();
  sorted.forEach((row, i) => out.set(row.team, i + 1));
  return out;
}

/** Rank 1 (easiest) → 5.0, rank 32 → 1.0. */
export function rankToSosScore(avgRank: number): number {
  return Math.round((5 - (avgRank - 1) * (4 / 31)) * 10) / 10;
}

export function mixScore(prior: number | undefined, computed: number | undefined, fade: number): number | undefined {
  if (prior == null && computed == null) return undefined;
  if (prior == null) return computed;
  if (computed == null) return prior;
  return Math.round((fade * prior + (1 - fade) * computed) * 10) / 10;
}

export function blendDefStats(
  current: DefStats | undefined,
  prior: DefStats | undefined,
  weight: number
): DefStats | undefined {
  const pa = blendStat(current?.pa, prior?.pa, weight);
  const oppPass = blendStat(current?.oppPass, prior?.oppPass, weight);
  const oppRush = blendStat(current?.oppRush, prior?.oppRush, weight);
  if (pa == null && oppPass == null && oppRush == null) return undefined;
  return {
    pa: pa ?? oppPass ?? oppRush ?? 0,
    oppPass: oppPass ?? pa ?? 0,
    oppRush: oppRush ?? pa ?? 0,
  };
}

export function blendOffStats(
  current: OffStats | undefined,
  prior: OffStats | undefined,
  weight: number
): OffStats | undefined {
  const pointsFor = blendStat(current?.pointsFor, prior?.pointsFor, weight);
  if (pointsFor == null) return undefined;
  return { pointsFor };
}

/** Scale season totals to per-game rates (avoids YTD×full-season blend bias). */
export function scaleDefToPerGame(stats: DefStats | undefined, games: number): DefStats | undefined {
  if (!stats || !(games > 0)) return undefined;
  return {
    pa: stats.pa / games,
    oppPass: stats.oppPass / games,
    oppRush: stats.oppRush / games,
  };
}

export function scaleOffToPerGame(stats: OffStats | undefined, games: number): OffStats | undefined {
  if (!stats || !(games > 0)) return undefined;
  return { pointsFor: stats.pointsFor / games };
}

/** Blend prior + current defense stats as per-game rates, then return blended rates. */
export function blendDefStatsRates(
  current: DefStats | undefined,
  prior: DefStats | undefined,
  weight: number,
  currentGames: number,
  priorGames = NFL_REG_SEASON_GAMES
): DefStats | undefined {
  return blendDefStats(
    scaleDefToPerGame(current, currentGames),
    scaleDefToPerGame(prior, priorGames),
    weight
  );
}

export function blendOffStatsRates(
  current: OffStats | undefined,
  prior: OffStats | undefined,
  weight: number,
  currentGames: number,
  priorGames = NFL_REG_SEASON_GAMES
): OffStats | undefined {
  return blendOffStats(
    scaleOffToPerGame(current, currentGames),
    scaleOffToPerGame(prior, priorGames),
    weight
  );
}

export function ranksFromDefStats(byTeam: Map<string, DefStats>): Map<string, DefPosRanks> {
  const pa: Array<{ team: string; value: number }> = [];
  const pass: Array<{ team: string; value: number }> = [];
  const rush: Array<{ team: string; value: number }> = [];
  for (const [team, stats] of byTeam) {
    pa.push({ team, value: stats.pa });
    pass.push({ team, value: stats.oppPass });
    rush.push({ team, value: stats.oppRush });
  }
  const overall = rankDesc(pa);
  const qb = rankDesc(pass);
  const rb = rankDesc(rush);
  const out = new Map<string, DefPosRanks>();
  for (const team of byTeam.keys()) {
    const o = overall.get(team) ?? 16;
    const q = qb.get(team) ?? o;
    const r = rb.get(team) ?? o;
    out.set(team, { overall: o, qb: q, rb: r, wr: q, te: q });
  }
  return out;
}

export function ranksFromOffStats(byTeam: Map<string, OffStats>): Map<string, number> {
  const pf: Array<{ team: string; value: number }> = [];
  for (const [team, stats] of byTeam) pf.push({ team, value: stats.pointsFor });
  return rankAsc(pf);
}

/**
 * Soft-anchor QB/RB/WR/TE ranks toward ESPN OPRK (1 = toughest).
 * Overall (PA) stays stats-only. Missing OPRK for a team keeps the stats rank.
 * Re-ranks each position 1–32 after the blend.
 */
export function softAnchorDefRanks(
  statsRanks: Map<string, DefPosRanks>,
  espnOprk: Record<string, Record<string, number>> | null | undefined,
  statsWeight = SOS_STATS_ANCHOR_WEIGHT
): Map<string, DefPosRanks> {
  if (!espnOprk || statsRanks.size === 0) {
    return new Map(statsRanks);
  }

  const w = clamp(statsWeight, 0, 1);
  const posKeys = [
    { field: 'qb' as const, espn: 'QB' },
    { field: 'rb' as const, espn: 'RB' },
    { field: 'wr' as const, espn: 'WR' },
    { field: 'te' as const, espn: 'TE' },
  ];

  const anchored = new Map<string, DefPosRanks>();
  for (const [team, row] of statsRanks) {
    anchored.set(team, { ...row });
  }

  for (const { field, espn } of posKeys) {
    const byOpp = espnOprk[espn];
    const scores: Array<{ team: string; value: number }> = [];
    for (const [team, row] of statsRanks) {
      const statsRank = row[field];
      const oprk = byOpp?.[team];
      if (oprk != null && Number.isFinite(oprk)) {
        const espnEasy = 33 - Math.round(oprk);
        scores.push({ team, value: w * statsRank + (1 - w) * espnEasy });
      } else {
        scores.push({ team, value: statsRank });
      }
    }
    const reRanked = rankAsc(scores);
    for (const [team, rank] of reRanked) {
      const row = anchored.get(team);
      if (row) row[field] = rank;
    }
  }

  return anchored;
}
