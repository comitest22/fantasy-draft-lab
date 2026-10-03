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

export interface RosterSettings {
  qb: number;
  rb: number;
  wr: number;
  te: number;
  flex: number;
  superflex?: number;
  dst: number;
  k: number;
  bench?: number;
}

export interface LeagueConfig {
  leagueSize: number;
  scoring: 'ppr' | 'half-ppr' | 'standard';
  draftType: 'snake';
  rounds: number;
  goodEraEnd: number;
  badEraStart: number;
  upcomingDraftSlot?: number;
  roster?: RosterSettings;
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

/** ESPN roster players past the published PPR board — used for header search / bio lookup. */
export interface DepthRosterEntry {
  playerName: string;
  season: number;
  position: Position;
  nflTeam?: string;
  espnRank?: number;
  /** Fantasy ESPN / athlete id for live game-log fetches. */
  espnId?: number;
  status?: string;
  percentOwned?: number;
}

export type PickGrade = 'hit' | 'fair' | 'bust' | 'reach' | 'steal' | 'rookie' | 'unknown';

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

export interface OpeningPick {
  round: number;
  overallPick: number;
  position: Position;
  playerName: string;
}

export interface PodiumTeamSnapshot {
  teamName: string;
  standing: number;
  draftSlot?: number;
  firstThree: OpeningPick[];
  firstThreePos: string;
  draftGrade: number;
}

export interface SeasonAnalysis {
  season: number;
  userTeamName?: string;
  finalStanding?: number;
  userDraftSlot?: number;
  userFirstThree?: OpeningPick[];
  podium: PodiumTeamSnapshot[];
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
  sources?: string[];
}

export interface SlotOutcome {
  slot: number;
  seasons: number;
  avgFinish: number;
  titles: number;
  top3Count: number;
  top3Rate: number;
}

export interface TimingProfile {
  rb1: number;
  wr1: number;
  rb2: number;
  wr2: number;
  qb1: number;
  te1: number;
  hitRate: number;
  bustRate: number;
  reachRate: number;
  avgSlot: number;
}

export interface TimingAdvice {
  id: string;
  title: string;
  detail: string;
}

export interface ChampionOpener {
  season: number;
  teamName: string;
  draftSlot?: number;
  firstThree: OpeningPick[];
  firstThreePos: string;
}

export interface OpeningPattern {
  pattern: string;
  top3Count: number;
  top3Pct: number;
  leaguePct: number;
}

export interface FranchiseRecord {
  displayName: string;
  names: string[];
  titles: number;
  top3: number;
  avgFinish: number;
  isUser: boolean;
}

export interface ContenderPlaybook {
  seasons: number;
  leagueSize: number;
  slotOutcomes: SlotOutcome[];
  timing: {
    top3: TimingProfile;
    user: TimingProfile;
    league: TimingProfile;
  };
  timingAdvice: TimingAdvice[];
  champions: ChampionOpener[];
  openingPatterns: OpeningPattern[];
  franchises: FranchiseRecord[];
  learnings: StrategyRecommendation[];
}

export type SeatLabel = 'edge' | 'trap' | 'turn' | 'early' | 'middle';

export interface RankedPlayer {
  rank: number;
  playerName: string;
  position: Position;
  nflTeam?: string;
  expectedPoints?: number;
  fantasyPros?: number;
  espnVsFp?: number;
  landmine?: number;
  espnAdp?: number;
  sleeperAdp?: number;
  yahooAdp?: number;
  underdogAdp?: number;
  espnMinusSleeper?: number;
  espnMinusUnderdog?: number;
  sos?: number;
  /** NFL SOS rank, 1 = easiest schedule, 32 = toughest. */
  sosRank?: number;
  /** Site / consensus ADP. */
  adp?: number;
  /** ESPN positional rank (1 = first at pos). */
  posRank?: number;
  /** NFL bye week (1–18). */
  byeWeek?: number;
  /** ESPN injury / roster status (ACTIVE, SUSPENSION, IR, EXEMPT, …). */
  status?: string;
  ecr?: number;
  ecrPos?: number;
  /** ESPN rank − ECR. Positive = steal in this ESPN room. */
  espnMinusEcr?: number;
  /** ECR − mean multi-site ADP. Negative = industry sleeper. */
  ecrMinusAdp?: number;
  /** ECR stdev (or best−worst). High = volatile. */
  expertSpread?: number;
  consensusSos?: number;
  consensusOline?: number;
  consensusDline?: number;
  consensusPower?: number;
}

export interface ExpertTakeaway {
  id: string;
  topic: string;
  claim: string;
  sources: string[];
  players: string[];
  positions: string[];
  rounds: number[];
}

export interface PlayerGameLogColumn {
  key: string;
  label: string;
  /** Which Game Log pill shows this column; `common` (FPTS) stays on both. */
  group?: 'receiving' | 'rushing' | 'passing' | 'common';
}

export interface PlayerGameLogRow {
  week: number | string;
  opp: string;
  bye?: boolean;
  cells: Record<string, number | null>;
  fpts?: number;
}

export interface PlayerSosWeek {
  week: number;
  opponent?: string;
  home?: boolean;
  bye?: boolean;
  rank?: number;
}

export interface PlayerSosSlate {
  team: string;
  position: Position;
  /** Remaining-slate Source A rank (1 = easiest). Weeks after completedWeeks. */
  rank?: number;
  /** First week still in the remaining slate (`season-state` currentWeek). */
  currentWeek: number;
  weeks: PlayerSosWeek[];
}

export interface PlayerGameLog {
  playerName: string;
  season: number;
  /** Years the dropdown can request (current draft season through draftSeason − 4). */
  seasons?: number[];
  position: Position;
  columns: PlayerGameLogColumn[];
  rows: PlayerGameLogRow[];
  previewRows: number;
  note?: string;
  sosSlate?: PlayerSosSlate;
}

export interface DepthChartPlayer {
  playerName: string;
  /** 1-based order on this NFL team at this position, by ESPN rank. */
  depth: number;
  rank: number;
  posRank?: number;
  status?: string;
}

export interface PlayerCompare {
  player: RankedPlayer;
  posRank?: number;
  qbName?: string;
  qbRank?: number;
  yearsWithQb?: number;
  offenseRank?: number;
  offenseRankPrev?: number;
  olineRank?: number;
  olineRankPrev?: number;
  lastSeason?: number;
  lastYearPoints?: number;
  lastYearRank?: number;
  lastYearPosRank?: number;
  lastYearGames?: number;
  lastYearAvg?: number;
  thisSeason?: number;
  thisYearPoints?: number;
  thisYearGames?: number;
  thisYearAvg?: number;
  priorSeason?: number;
  priorYearPoints?: number;
  priorYearAvg?: number;
  takeaways?: ExpertTakeaway[];
  /** Same-team, same-position board mates ordered by ESPN rank. */
  depthChart?: DepthChartPlayer[];
  /** Canonical team used for depthChart (same resolved team as the player card). */
  depthChartTeam?: string;
}

export interface PlayerNewsItem {
  title: string;
  url: string;
  source?: string;
  published?: string;
  canonicalUrl?: string;
  excerpt?: string;
  truncated?: boolean;
  /** Known subscription host — open on publisher, skip in-app extract. */
  paywalled?: boolean;
}

export interface PlayerNewsArticle {
  title?: string;
  canonicalUrl: string;
  excerpt: string;
  truncated: boolean;
  error?: string;
}

export interface RouteBoardPlayer {
  playerName: string;
  position: Position;
  rank: number;
}

export interface RoutePickAlt {
  player: RankedPlayer;
  reason: string;
}

export interface RoutePick {
  round: number;
  overallPick: number;
  player: RankedPlayer;
  reason: string;
  alternates?: RoutePickAlt[];
}

export interface DraftRoute {
  id: string;
  name: string;
  thesis: string;
  shape: string;
  picks: RoutePick[];
  projectedPoints: number;
}

export interface SlotRoutePlan {
  slot: number;
  snakePicks: number[];
  seatLabel: SeatLabel;
  seatDetail: string;
  historical: {
    avgFinish: number;
    titles: number;
    top3Rate: number;
    commonPodiumShape?: string;
    podiumSample: number;
  };
  routes: DraftRoute[];
  openings?: OpeningPattern[];
}

export interface DraftRouteBook {
  season: number;
  source: string;
  leagueSize: number;
  boardSize: number;
  suggestedSlot: number;
  slots: SlotRoutePlan[];
  market?: MarketBoard;
  rosterLabel?: string;
  valueNote?: string;
  openings?: OpeningPattern[];
  board?: RouteBoardPlayer[];
}

export interface MarketValueRow {
  playerName: string;
  position: Position;
  espnRank?: number;
  fantasyPros?: number;
  adp?: number;
  espnVsFp?: number;
  landmine?: number;
  espnAdp?: number;
  sleeperAdp?: number;
  yahooAdp?: number;
  underdogAdp?: number;
  espnMinusSleeper?: number;
  espnMinusUnderdog?: number;
  ecr?: number;
  espnMinusEcr?: number;
  ecrMinusAdp?: number;
  expertSpread?: number;
}

export interface MarketBoard {
  ranksSource: string;
  ranksCount: number;
  adpSource: string;
  adpCount: number;
  draftDepth?: number;
  values: MarketValueRow[];
  sleepers: MarketValueRow[];
  landmines: MarketValueRow[];
  adpValues: MarketValueRow[];
  adpLandmines: MarketValueRow[];
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
