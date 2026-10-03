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
  scoring: string;
  draftType: string;
  rounds: number;
  goodEraEnd: number;
  badEraStart: number;
  upcomingDraftSlot?: number;
  roster?: RosterSettings;
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
  espnMinusEcr?: number;
  ecrMinusAdp?: number;
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
  confidence: string;
  tags: string[];
  content: string;
}

export interface SosPosStat {
  score?: number;
  rank?: number;
}

export interface SosWeekCell {
  week: number;
  opponent?: string;
  home?: boolean;
  bye?: boolean;
  overall?: number;
  qb?: number;
  rb?: number;
  wr?: number;
  te?: number;
  dst?: number;
}

export interface SosUnitChange {
  offense?: number;
  oline?: number;
}

export interface SosTeamRow {
  team: string;
  overall: SosPosStat;
  qb: SosPosStat;
  rb: SosPosStat;
  wr: SosPosStat;
  te: SosPosStat;
  dst?: SosPosStat;
  dline?: number;
  /** Through-week defense quality rank (1 = fewest points allowed). Defense chart Top ranked. */
  defense?: number;
  /** Consensus offense unit rank (1 = best). */
  offense?: number;
  unitChange?: SosUnitChange;
  games?: SosWeekCell[];
}

export interface SosBoard {
  season: number;
  weeks?: number;
  /** First week still in the remaining slate (`season-state` currentWeek). */
  currentWeek?: number;
  unitSeasons?: { latest: number; prior: number };
  sourceNote?: string;
  teams: SosTeamRow[];
}

export type CheatSheetScoring = 'ppr' | 'standard';

export interface CheatSheet {
  scoring: CheatSheetScoring;
  season: number;
  source: string;
  note?: string;
  leagueSize: number;
  suggestedSlot: number;
  rounds: number;
  roster?: RosterSettings;
  players: RankedPlayer[];
}

export type SurvivorMode = 'win' | 'lose';

export interface SurvivorWeekTeam {
  team: string;
  teamName: string;
  opponent: string;
  home: boolean;
  matchupLabel: string;
  pgWinPct: number | null;
  pgLosePct: number | null;
  marketWinPct: number | null;
  moneyline: string;
  spread: number | null;
  popularityPct: number | null;
  ev: number | null;
  futureValue: number | null;
  gameNotes: string[];
  contextNotes?: string[];
  contextAdj?: number | null;
  bye: boolean;
  pickRank: number | null;
  recommended: boolean;
  reason: string;
}

export interface SurvivorSeasonCell {
  week: number;
  winPct: number | null;
  losePct: number | null;
  opp: string;
  bye: boolean;
  result?: 'W' | 'L' | null;
  score?: string | null;
  locked?: boolean;
}

export interface SurvivorSeasonRow {
  team: string;
  teamName: string;
  futureValue: number | null;
  cells: SurvivorSeasonCell[];
}

export interface SurvivorBoard {
  mode: SurvivorMode;
  season: number;
  currentWeek: number;
  /** Selected week still has stored Mkt/ML/Pop/EV from when it was current. */
  weekHasLines?: boolean;
  lastUpdated: string | null;
  pulledAt: string | null;
  source: string;
  sourceNote: string;
  weeks: number[];
  week: SurvivorWeekTeam[];
  seasonRows: SurvivorSeasonRow[];
  picks: SurvivorWeekTeam[];
}

export interface TdCandidate {
  playerName: string;
  position: string;
  nflTeam?: string;
  posRank?: number;
  expectedPoints?: number;
  lastYearPts?: number;
  lastYearGames?: number;
  thisYearPts?: number;
  thisYearGames?: number;
  offenseRank?: number;
  sosRank?: number;
  status?: string;
  score: number;
  why: string;
  opp?: string;
  teamWinPct?: number | null;
  tdChance?: number;
  matchupRank?: number;
  oppYdsPg?: number;
  oppTdsPg?: number;
  oppYdsRank?: number;
  oppTdsRank?: number;
  lastGameYds?: number;
  lastGameTds?: number;
  lastGameWeek?: number;
  lastGameOpp?: string;
  posTdShare?: number;
  hitRate?: number;
  scoredTd?: boolean | null;
  matchupLine?: string;
  reason?: string;
  totalTds?: number;
  totalGames?: number;
  last5Tds?: number;
  last5Games?: number;
  sampleYears?: number;
  sampleYearsPlus?: boolean;
  vsOppTds?: number;
  vsOppGames?: number;
  vsOppHitPct?: number;
  vsOppLine?: string;
  vsOppHomeTds?: number;
  vsOppHomeGames?: number;
  vsOppAwayTds?: number;
  vsOppAwayGames?: number;
  kickoff?: string;
  thisWeekHome?: boolean;
  venueSplit?: string;
  matchupMeta?: string;
  weather?: { kind: string; label: string };
  olineRank?: number;
  oppPosRank?: number;
  mismatch?: string;
}

export interface TdWeekPick {
  week: number;
  primary: TdCandidate | null;
  primary2?: TdCandidate | null;
  alternate: TdCandidate | null;
  options?: TdCandidate[];
  teamWinPct?: number | null;
  opp?: string;
  teamWinPct2?: number | null;
  opp2?: string;
  note: string;
}

export interface TdStreakBoard {
  season: number;
  note: string;
  candidates: TdCandidate[];
  path: TdWeekPick[];
}
