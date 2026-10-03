export const TEAM_SIZES = [8, 10, 12, 14] as const;
export const DEFAULT_TEAM_SIZE = 10;
export const DEFAULT_FORMAT_ID = '2wr-1flex';

export const LEAGUE_FORMATS = [
  { id: '2wr-1flex', label: '2 WR / 1 FLEX' },
  { id: '2wr-2flex', label: '2 WR / 2 FLEX' },
  { id: '3wr-1flex', label: '3 WR / 1 FLEX' },
  { id: '3wr-2flex', label: '3 WR / 2 FLEX' },
  { id: '2flex-sf', label: '2 FLEX / 1 SUPERFLEX' },
  { id: '2wr-1flex-sf', label: '2 WR / 1 FLEX / 1 SUPERFLEX' },
  { id: '3wr-2flex-sf', label: '3 WR / 2 FLEX / 1 SUPERFLEX' },
] as const;

export type LeagueFormatId = (typeof LEAGUE_FORMATS)[number]['id'];
