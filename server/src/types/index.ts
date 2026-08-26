export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'D/ST';

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
  teamStandings?: Record<string, number>;
}

export interface LeagueConfig {
  leagueSize: number;
  scoring: 'ppr' | 'half-ppr' | 'standard';
  draftType: 'snake';
  rounds: number;
  goodEraEnd: number;
  badEraStart: number;
  seasons: Record<string, SeasonConfig>;
}

export interface PlayerEnrichment {
  playerName: string;
  season: number;
  position: Position;
  nflTeam: string;
  fantasyPoints: number;
  gamesPlayed?: number;
}

export interface AdpEntry {
  playerName: string;
  season: number;
  position: Position;
  adp: number;
  expectedPoints?: number;
}

export type PickGrade = 'hit' | 'fair' | 'bust' | 'reach' | 'steal' | 'unknown';

export interface GradedPick extends DraftPick {
  adp?: number;
  fantasyPoints?: number;
  expectedPoints?: number;
  valueScore?: number;
  grade: PickGrade;
  isUserPick: boolean;
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
  positionalTiming: PositionalTimingEntry[];
  insights: string[];
}

export interface PositionalTimingEntry {
  position: Position;
  userRound: number | null;
  leagueAvgRound: number;
  top3AvgRound: number;
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
}

export interface SotDocument {
  slug: string;
  title: string;
  source: string;
  date: string;
  confidence: 'high' | 'medium' | 'low';
  tags: string[];
  content: string;
}
