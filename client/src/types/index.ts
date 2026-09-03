export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'D/ST';
export type PickGrade = 'hit' | 'fair' | 'bust' | 'reach' | 'steal' | 'rookie' | 'unknown';

export interface DraftPick {
  season: number;
  round: number;
  pickInRound: number;
  overallPick: number;
  playerName: string;
  nflTeam: string;
  position: Position;
  fantasyTeamName: string;
  draftSlot?: number;
}

export interface DraftFile {
  season: number;
  leagueSize: number;
  rounds: number;
  picks: DraftPick[];
  fantasyTeamNames: string[];
  importedAt: string;
}

export interface SeasonConfig {
  userTeamName?: string;
  finalStanding?: number;
  notes?: string;
}

export interface LeagueConfig {
  leagueSize: number;
  scoring: string;
  draftType: string;
  rounds: number;
  goodEraEnd: number;
  badEraStart: number;
  seasons: Record<string, SeasonConfig>;
}

export interface GradedPick extends DraftPick {
  adp?: number;
  fantasyPoints?: number;
  expectedPoints?: number;
  eosRank?: number;
  valueScore?: number;
  grade: PickGrade;
  isUserPick: boolean;
  isRookie?: boolean;
}

export interface SeasonAnalysis {
  season: number;
  userTeamName?: string;
  finalStanding?: number;
  draftGrade: number;
  totalValue: number;
  hitRate: number;
  bustRate: number;
  reachRate: number;
  picks: GradedPick[];
  positionalTiming: Array<{
    position: Position;
    userRound: number | null;
    leagueAvgRound: number;
    top3AvgRound: number;
  }>;
  insights: string[];
}

export interface EraComparison {
  goodEra: EraStats;
  badEra: EraStats;
  insights: string[];
}

export interface EraStats {
  label: string;
  seasons: number[];
  avgDraftGrade: number;
  avgHitRate: number;
  avgBustRate: number;
  avgReachRate: number;
  positionalTiming: Record<Position, number | null>;
}

export interface StrategyRecommendation {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
  sotRefs?: string[];
  citations?: SotDocument[];
}

export interface SotDocument {
  slug: string;
  title: string;
  source: string;
  date: string;
  confidence: string;
  tags: string[];
  content: string;
}
