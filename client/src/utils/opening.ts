import type { DraftRoute, OpeningPattern, OpeningPick } from '../types';

export function formatOpening(picks?: OpeningPick[]): string {
  if (!picks?.length) return '—';
  return picks.map((p) => `${p.position} ${p.playerName}`).join(' / ');
}

export function isSkillOpening(pattern: string): boolean {
  const parts = pattern.split('-');
  return parts.length === 3 && parts.every((p) => p === 'WR' || p === 'RB' || p === 'TE');
}

export function firstThreeOpening(route: DraftRoute | null | undefined): string | null {
  if (!route) return null;
  const first = [...route.picks.filter((p) => p.round <= 3)].sort((a, b) => a.round - b.round);
  if (first.length < 3) return null;
  const pattern = first.map((p) => p.player.position).join('-');
  return isSkillOpening(pattern) ? pattern : null;
}

function uniqueSkill(historical: OpeningPattern[]): OpeningPattern[] {
  const shown: OpeningPattern[] = [];
  const seen = new Set<string>();
  for (const o of historical) {
    if (!isSkillOpening(o.pattern) || seen.has(o.pattern)) continue;
    shown.push(o);
    seen.add(o.pattern);
  }
  return shown;
}

/** Top 4 historical skill opens (the visible pills). */
export function featuredOpenings(historical: OpeningPattern[]): OpeningPattern[] {
  return uniqueSkill(historical).slice(0, 4);
}

/** Remaining skill opens for the Other dropdown, plus the live combo if it is not already listed. */
export function otherOpenings(
  historical: OpeningPattern[],
  current: string | null
): OpeningPattern[] {
  const featured = new Set(featuredOpenings(historical).map((o) => o.pattern));
  const rest: OpeningPattern[] = [];
  const seen = new Set<string>();
  for (const o of uniqueSkill(historical)) {
    if (featured.has(o.pattern) || seen.has(o.pattern)) continue;
    rest.push(o);
    seen.add(o.pattern);
  }
  if (current && isSkillOpening(current) && !featured.has(current) && !seen.has(current)) {
    const match = historical.find((o) => o.pattern === current);
    rest.push(match ?? { pattern: current, top3Count: 0, top3Pct: 0, leaguePct: 0 });
  }
  return rest;
}

export function preferredOpening(
  historical: OpeningPattern[],
  _current: string | null = null
): string | null {
  return featuredOpenings(historical)[0]?.pattern ?? null;
}

export function openingTooltip(o: OpeningPattern): string {
  const podium = `${Math.round(o.top3Pct * 100)}% podium`;
  const count = o.top3Count > 0 ? `${o.top3Count} top-3 finish${o.top3Count === 1 ? '' : 'es'}` : 'no top-3 finishes';
  const league = o.leaguePct > 0 ? `${Math.round(o.leaguePct * 100)}% of drafts from this seat` : undefined;
  return [o.pattern, podium, count, league].filter(Boolean).join(' · ');
}
