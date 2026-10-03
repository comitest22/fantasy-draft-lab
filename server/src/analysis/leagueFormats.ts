import type { LeagueConfig, RosterSettings, StrategyRecommendation } from '../types';

export const TEAM_SIZES = [8, 10, 12, 14] as const;
export const DEFAULT_TEAM_SIZE = 10;
export const DEFAULT_FORMAT_ID = '2wr-1flex';

export interface LeagueFormatPreset {
  id: string;
  label: string;
  wr: number;
  flex: number;
  superflex: number;
}

export const LEAGUE_FORMATS: LeagueFormatPreset[] = [
  { id: '2wr-1flex', label: '2 WR / 1 FLEX', wr: 2, flex: 1, superflex: 0 },
  { id: '2wr-2flex', label: '2 WR / 2 FLEX', wr: 2, flex: 2, superflex: 0 },
  { id: '3wr-1flex', label: '3 WR / 1 FLEX', wr: 3, flex: 1, superflex: 0 },
  { id: '3wr-2flex', label: '3 WR / 2 FLEX', wr: 3, flex: 2, superflex: 0 },
  { id: '2flex-sf', label: '2 FLEX / 1 SUPERFLEX', wr: 2, flex: 2, superflex: 1 },
  { id: '2wr-1flex-sf', label: '2 WR / 1 FLEX / 1 SUPERFLEX', wr: 2, flex: 1, superflex: 1 },
  { id: '3wr-2flex-sf', label: '3 WR / 2 FLEX / 1 SUPERFLEX', wr: 3, flex: 2, superflex: 1 },
];

export function formatById(id: string | undefined): LeagueFormatPreset {
  return LEAGUE_FORMATS.find((f) => f.id === id) ?? LEAGUE_FORMATS[0];
}

export function parseTeamSize(value: unknown): number {
  const n = Number(value);
  return (TEAM_SIZES as readonly number[]).includes(n) ? n : DEFAULT_TEAM_SIZE;
}

export function rosterFromFormat(preset: LeagueFormatPreset): RosterSettings {
  return {
    qb: 1,
    rb: 2,
    wr: preset.wr,
    te: 1,
    flex: preset.flex,
    superflex: preset.superflex || undefined,
    dst: 1,
    k: 1,
    bench: 5,
  };
}

export function applyLeagueFormat(
  config: LeagueConfig,
  teams: number,
  formatId: string
): LeagueConfig {
  const preset = formatById(formatId);
  const roster = rosterFromFormat(preset);
  const size = parseTeamSize(teams);
  const slot = config.upcomingDraftSlot;
  return {
    ...config,
    leagueSize: size,
    roster,
    upcomingDraftSlot: slot != null ? Math.min(Math.max(1, slot), size) : slot,
  };
}

export function isDefaultLeagueFormat(teams: number, formatId: string): boolean {
  return parseTeamSize(teams) === DEFAULT_TEAM_SIZE && formatById(formatId).id === DEFAULT_FORMAT_ID;
}

export function hasSuperflex(roster: RosterSettings): boolean {
  return (roster.superflex ?? 0) > 0;
}

export function formatLearnings(
  teams: number,
  roster: RosterSettings,
  label: string
): StrategyRecommendation[] {
  const recs: StrategyRecommendation[] = [
    {
      id: 'format-setup',
      title: `${teams}-team PPR · ${label}`,
      detail: `Paths and learnings below are for this setup (${roster.rb} RB, ${roster.wr} WR, ${roster.te} TE, ${roster.flex} FLEX${hasSuperflex(roster) ? ', 1 SUPERFLEX' : ''}). Podium and Era still use this league’s real history.`,
      severity: 'info',
    },
  ];
  if (roster.wr >= 3) {
    recs.push({
      id: 'format-3wr',
      title: 'Take WRs earlier',
      detail: `Locked WR starters jump to ${roster.wr}. WR-WR at the turn is the default floor. A third WR in rounds 3–5 is often correct. Don’t let WR3s slide the way they do in a 2-WR league.`,
      severity: 'info',
      sotRefs: ['ppr-10-team-draft-strategy', 'positional-scarcity-and-runs'],
    });
  } else if (roster.flex >= 2 && !hasSuperflex(roster)) {
    recs.push({
      id: 'format-2flex',
      title: 'One extra flex starter',
      detail: 'You still lock only two WRs. Spend the extra flex on a WR3 or a third RB, whichever is better on the board. Hero RB in the first three still holds.',
      severity: 'info',
      sotRefs: ['ppr-10-team-draft-strategy'],
    });
  }
  if (hasSuperflex(roster)) {
    recs.push({
      id: 'format-superflex',
      title: 'QB is a starter, not a stream',
      detail: 'Superflex means you start two passers. Take QB1 in the middle rounds (often 3–7), not the 5–8 wait from 1-QB. A second QB is a real starter, not a luxury.',
      severity: 'warning',
    });
  }
  return recs;
}
