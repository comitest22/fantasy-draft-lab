import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getLeaguePlayerAvailability, getPlayerCompare } from '../services/api';
import type {
  LeaguePlayerAvailability,
  PlayerCompare,
  PlatformRatingCell,
  PlayerPlatformRatings,
  PlayerWeekMatchup,
  Position,
  RouteBoardPlayer,
} from '../types';
import { oprkHeatClass, positionalRankHeat } from '../utils/heatScale';
import { useBioPlayerLoad } from './BioPlayerLoadGate';
import PlayerGameLog from './PlayerGameLog';
import { statusBadge } from '../utils/valueChips';

const EMPTY_PLATFORM_RATINGS: PlayerPlatformRatings = {
  currentWeek: 0,
  week: {},
  ros: {},
};

const POS_ORDER: Position[] = ['WR', 'RB', 'TE', 'QB', 'D/ST', 'K'];

function groupedBoard(players: RouteBoardPlayer[]) {
  return POS_ORDER.map((pos) => ({
    pos,
    players: players.filter((p) => p.position === pos).sort((a, b) => a.rank - b.rank),
  })).filter((group) => group.players.length > 0);
}

function fmtNum(n: number | undefined, digits = 1): string {
  if (n == null) return '—';
  return n.toFixed(digits);
}

function fmtRank(n: number | undefined): string {
  return n != null ? `#${n}` : '—';
}

interface CellVal {
  main: string;
  prior?: string;
  hint?: string;
}

function cell(main: string): CellVal {
  return { main };
}

function withPrior(main: string, prior: string | undefined, hint: string): CellVal {
  if (!prior) return { main };
  return { main, prior, hint };
}

function fmtPos(pos: Position | undefined, n: number | undefined): string {
  if (n == null) return '—';
  return `${pos ?? ''}${n}`;
}

type Tone = 'better' | 'mid' | 'worse' | 'same';
type MetricKey =
  | 'rank'
  | 'pos'
  | 'proj'
  | 'sos'
  | 'ecr'
  | 'espnMinusEcr'
  | 'sleeperGap'
  | 'landmine'
  | 'adpGap'
  | 'qb'
  | 'yearsQb'
  | 'offense'
  | 'oline'
  | 'lyPts'
  | 'lyRank'
  | 'lyPos'
  | 'lyAvg'
  | 'tyPts'
  | 'tyAvg'
  | 'defRush'
  | 'defPass'
  | 'sacks'
  | 'turnovers';

const QUALITY: Record<MetricKey, { prefer: 'high' | 'low'; good: number; bad: number }> = {
  rank: { prefer: 'low', good: 12, bad: 48 },
  pos: { prefer: 'low', good: 12, bad: 24 },
  proj: { prefer: 'high', good: 240, bad: 160 },
  sos: { prefer: 'low', good: 8, bad: 33 },
  ecr: { prefer: 'low', good: 12, bad: 48 },
  espnMinusEcr: { prefer: 'high', good: 8, bad: -8 },
  sleeperGap: { prefer: 'low', good: -8, bad: 8 },
  landmine: { prefer: 'low', good: 4.6, bad: 6.5 },
  adpGap: { prefer: 'high', good: 3, bad: -3 },
  qb: { prefer: 'low', good: 8, bad: 18 },
  yearsQb: { prefer: 'high', good: 2, bad: 0 },
  offense: { prefer: 'low', good: 10, bad: 23 },
  oline: { prefer: 'low', good: 10, bad: 23 },
  lyPts: { prefer: 'high', good: 200, bad: 120 },
  lyRank: { prefer: 'low', good: 24, bad: 60 },
  lyPos: { prefer: 'low', good: 12, bad: 24 },
  lyAvg: { prefer: 'high', good: 16, bad: 11 },
  tyPts: { prefer: 'high', good: 18, bad: 6 },
  tyAvg: { prefer: 'high', good: 16, bad: 11 },
  defRush: { prefer: 'low', good: 10, bad: 23 },
  defPass: { prefer: 'low', good: 10, bad: 23 },
  // Color by NFL rank among 32 (1 = most), same band as vs Run/Pass — not raw counts.
  sacks: { prefer: 'low', good: 10, bad: 23 },
  turnovers: { prefer: 'low', good: 10, bad: 23 },
};

function tone(left?: number, right?: number, prefer: 'high' | 'low' = 'high'): Tone {
  if (left == null || right == null) return 'same';
  if (left === right) return 'same';
  const leftWins = prefer === 'high' ? left > right : left < right;
  return leftWins ? 'better' : 'worse';
}

function other(t: Tone): Tone {
  if (t === 'better') return 'worse';
  if (t === 'worse') return 'better';
  return 'same';
}

function quality(key: MetricKey, n: number | undefined, pos?: Position): Tone {
  if (n == null || !Number.isFinite(n)) return 'same';
  if ((pos === 'K' || pos === 'D/ST') && (key === 'proj' || key === 'rank' || key === 'lyPts' || key === 'lyAvg')) {
    return 'same';
  }
  const { prefer, good, bad } = QUALITY[key];
  if (prefer === 'low') {
    if (n <= good) return 'better';
    if (n >= bad) return 'worse';
    return 'mid';
  }
  if (n >= good) return 'better';
  if (n <= bad) return 'worse';
  return 'mid';
}

interface Row {
  label: string;
  tab: 'draft' | 'season';
  left: CellVal;
  right: CellVal;
  leftTone: Tone;
  rightTone: Tone;
}

function ValueCell({ val, tone }: { val: CellVal; tone: Tone }) {
  return (
    <td>
      <span className={`compare-val ${tone}`}>{val.main}</span>
      {val.prior && (
        <span className="compare-prior" data-hint={val.hint}>
          {' '}
          ({val.prior})
        </span>
      )}
    </td>
  );
}

function StatValue({ val, tone }: { val: CellVal; tone: Tone }) {
  return (
    <span className={`compare-val ${tone}`}>
      {val.main}
      {val.prior && (
        <span className="compare-prior" data-hint={val.hint}>
          {' '}
          ({val.prior})
        </span>
      )}
    </span>
  );
}

function fmtCountRank(count?: number, rank?: number): string {
  if (count == null || !Number.isFinite(count)) return '—';
  const n = Number.isInteger(count) ? String(count) : count.toFixed(1);
  return rank != null ? `${n} (#${rank})` : n;
}

function rowsFor(left: PlayerCompare, right: PlayerCompare | null): Row[] {
  const p = left.player;
  const q = right?.player;
  // Season Pos rank is YTD at the position (same idea as My Team / FA PRK).
  const leftSeasonPos = left.posRank;
  const rightSeasonPos = right?.posRank;
  const lastY = left.lastSeason ?? right?.lastSeason;
  const priorY = left.priorSeason ?? right?.priorSeason;
  const lastHint = lastY != null ? String(lastY) : 'Last year';
  const twoBackHint = priorY != null ? String(priorY) : 'Two years back';
  const dstSeason = p.position === 'D/ST';
  const pair = (
    label: string,
    key: MetricKey,
    tab: 'draft' | 'season',
    lv: CellVal,
    rv: CellVal,
    ln?: number,
    rn?: number,
    prefer: 'high' | 'low' = 'high'
  ): Row => {
    if (right) {
      const leftTone = tone(ln, rn, prefer);
      return { label, tab, left: lv, right: rv, leftTone, rightTone: other(leftTone) };
    }
    return {
      label,
      tab,
      left: lv,
      right: rv,
      leftTone: quality(key, ln, p.position),
      rightTone: quality(key, rn, q?.position),
    };
  };

  const seasonTail: Row[] = dstSeason
    ? [
        pair(
          'SOS',
          'sos',
          'season',
          cell(p.sosRank != null ? `#${p.sosRank}` : '—'),
          cell(q?.sosRank != null ? `#${q.sosRank}` : '—'),
          p.sosRank,
          q?.sosRank,
          'low'
        ),
        pair(
          'vs Run',
          'defRush',
          'season',
          cell(fmtCountRank(left.defRushYdsAvg, left.defRushStopRank)),
          cell(fmtCountRank(right?.defRushYdsAvg, right?.defRushStopRank)),
          left.defRushStopRank,
          right?.defRushStopRank,
          'low'
        ),
        pair(
          'vs Pass',
          'defPass',
          'season',
          cell(fmtCountRank(left.defPassYdsAvg, left.defPassStopRank)),
          cell(fmtCountRank(right?.defPassYdsAvg, right?.defPassStopRank)),
          left.defPassStopRank,
          right?.defPassStopRank,
          'low'
        ),
        pair(
          'Sacks',
          'sacks',
          'season',
          cell(fmtCountRank(left.dstSacks, left.dstSacksRank)),
          cell(fmtCountRank(right?.dstSacks, right?.dstSacksRank)),
          left.dstSacksRank,
          right?.dstSacksRank,
          'low'
        ),
        pair(
          'Turnovers',
          'turnovers',
          'season',
          cell(fmtCountRank(left.dstTurnovers, left.dstTurnoversRank)),
          cell(fmtCountRank(right?.dstTurnovers, right?.dstTurnoversRank)),
          left.dstTurnoversRank,
          right?.dstTurnoversRank,
          'low'
        ),
      ]
    : [
        pair(
          'SOS',
          'sos',
          'season',
          cell(p.sosRank != null ? `#${p.sosRank}` : '—'),
          cell(q?.sosRank != null ? `#${q.sosRank}` : '—'),
          p.sosRank,
          q?.sosRank,
          'low'
        ),
        pair(
          'QB',
          'qb',
          'season',
          cell(left.qbName ? `${left.qbName}${left.qbRank != null ? ` · QB${left.qbRank}` : ''}` : '—'),
          cell(right?.qbName ? `${right.qbName}${right.qbRank != null ? ` · QB${right.qbRank}` : ''}` : '—'),
          left.qbRank,
          right?.qbRank,
          'low'
        ),
        pair(
          'Offense (YTD PF)',
          'offense',
          'season',
          cell(fmtRank(left.offenseRankSeason)),
          cell(fmtRank(right?.offenseRankSeason)),
          left.offenseRankSeason,
          right?.offenseRankSeason,
          'low'
        ),
        pair(
          'O-line (sack %)',
          'oline',
          'season',
          cell(fmtRank(left.olineRankSeason)),
          cell(fmtRank(right?.olineRankSeason)),
          left.olineRankSeason,
          right?.olineRankSeason,
          'low'
        ),
        pair(
          left.thisSeason ? `${left.thisSeason} YTD PPR` : 'This year PPR',
          'tyPts',
          'season',
          cell(fmtNum(left.thisYearPoints, 1)),
          cell(fmtNum(right?.thisYearPoints, 1)),
          left.thisYearPoints,
          right?.thisYearPoints,
          'high'
        ),
        pair(
          left.thisSeason ? `${left.thisSeason} YTD PPR avg/g` : 'This year PPR avg/g',
          'tyAvg',
          'season',
          cell(fmtNum(left.thisYearAvg, 1)),
          cell(fmtNum(right?.thisYearAvg, 1)),
          left.thisYearAvg,
          right?.thisYearAvg,
          'high'
        ),
      ];

  return [
    pair(
      'ESPN Current Rank',
      'rank',
      'season',
      cell(fmtRank(p.rank)),
      cell(fmtRank(q?.rank)),
      p.rank,
      q?.rank,
      'low'
    ),
    pair(
      'Current Pos. Rank',
      'pos',
      'season',
      cell(fmtPos(p.position, leftSeasonPos)),
      cell(fmtPos(q?.position, rightSeasonPos)),
      leftSeasonPos,
      rightSeasonPos,
      'low'
    ),
    pair(
      'Proj',
      'proj',
      'draft',
      cell(p.expectedPoints != null ? String(Math.round(p.expectedPoints)) : '—'),
      cell(q?.expectedPoints != null ? String(Math.round(q.expectedPoints)) : '—'),
      p.expectedPoints,
      q?.expectedPoints,
      'high'
    ),
    ...seasonTail,
    pair(
      'ECR',
      'ecr',
      'draft',
      cell(p.ecr != null ? String(p.ecr) : '—'),
      cell(q?.ecr != null ? String(q.ecr) : '—'),
      p.ecr,
      q?.ecr,
      'low'
    ),
    pair(
      'ESPN − ECR',
      'espnMinusEcr',
      'draft',
      cell(p.espnMinusEcr == null ? '—' : `${p.espnMinusEcr > 0 ? '+' : ''}${p.espnMinusEcr.toFixed(1)}`),
      cell(q?.espnMinusEcr == null ? '—' : `${q.espnMinusEcr > 0 ? '+' : ''}${q.espnMinusEcr.toFixed(1)}`),
      p.espnMinusEcr,
      q?.espnMinusEcr,
      'high'
    ),
    pair(
      'Sleeper gap',
      'sleeperGap',
      'draft',
      cell(p.ecrMinusAdp == null ? '—' : `${p.ecrMinusAdp > 0 ? '+' : ''}${p.ecrMinusAdp.toFixed(1)}`),
      cell(q?.ecrMinusAdp == null ? '—' : `${q.ecrMinusAdp > 0 ? '+' : ''}${q.ecrMinusAdp.toFixed(1)}`),
      p.ecrMinusAdp,
      q?.ecrMinusAdp,
      'low'
    ),
    pair(
      'Landmine',
      'landmine',
      'draft',
      cell(fmtNum(p.landmine)),
      cell(fmtNum(q?.landmine)),
      p.landmine,
      q?.landmine,
      'low'
    ),
    pair(
      'ESPN ADP vs Sleeper',
      'adpGap',
      'draft',
      cell(p.espnMinusSleeper == null ? '—' : `${p.espnMinusSleeper > 0 ? '+' : ''}${p.espnMinusSleeper.toFixed(0)}`),
      cell(q?.espnMinusSleeper == null ? '—' : `${q.espnMinusSleeper > 0 ? '+' : ''}${q.espnMinusSleeper.toFixed(0)}`),
      p.espnMinusSleeper,
      q?.espnMinusSleeper,
      'high'
    ),
    pair(
      'Years with QB',
      'yearsQb',
      'draft',
      cell(left.yearsWithQb != null ? `${left.yearsWithQb}` : '—'),
      cell(right?.yearsWithQb != null ? `${right.yearsWithQb}` : '—'),
      left.yearsWithQb,
      right?.yearsWithQb,
      'high'
    ),
    pair(
      'Offense rank',
      'offense',
      'draft',
      withPrior(
        fmtRank(left.offenseRank),
        left.offenseRankPrev != null ? `#${left.offenseRankPrev}` : undefined,
        `${lastHint} offense rank`
      ),
      withPrior(
        fmtRank(right?.offenseRank),
        right?.offenseRankPrev != null ? `#${right.offenseRankPrev}` : undefined,
        `${lastHint} offense rank`
      ),
      left.offenseRank,
      right?.offenseRank,
      'low'
    ),
    pair(
      'O-line rank',
      'oline',
      'draft',
      withPrior(
        fmtRank(left.olineRank),
        left.olineRankPrev != null ? `#${left.olineRankPrev}` : undefined,
        `${lastHint} O-line rank`
      ),
      withPrior(
        fmtRank(right?.olineRank),
        right?.olineRankPrev != null ? `#${right.olineRankPrev}` : undefined,
        `${lastHint} O-line rank`
      ),
      left.olineRank,
      right?.olineRank,
      'low'
    ),
    pair(
      left.lastSeason ? `${left.lastSeason} PPR pts` : 'Last year PPR',
      'lyPts',
      'draft',
      withPrior(
        fmtNum(left.lastYearPoints, 1),
        left.priorYearPoints != null ? fmtNum(left.priorYearPoints, 1) : undefined,
        `${twoBackHint} PPR points`
      ),
      withPrior(
        fmtNum(right?.lastYearPoints, 1),
        right?.priorYearPoints != null ? fmtNum(right.priorYearPoints, 1) : undefined,
        `${twoBackHint} PPR points`
      ),
      left.lastYearPoints,
      right?.lastYearPoints,
      'high'
    ),
    pair(
      left.lastSeason ? `${left.lastSeason} avg/g` : 'Last year avg/g',
      'lyAvg',
      'draft',
      withPrior(
        fmtNum(left.lastYearAvg, 1),
        left.priorYearAvg != null ? fmtNum(left.priorYearAvg, 1) : undefined,
        `${twoBackHint} avg per game`
      ),
      withPrior(
        fmtNum(right?.lastYearAvg, 1),
        right?.priorYearAvg != null ? fmtNum(right.priorYearAvg, 1) : undefined,
        `${twoBackHint} avg per game`
      ),
      left.lastYearAvg,
      right?.lastYearAvg,
      'high'
    ),
  ];
}

interface Props {
  leftName: string;
  round?: number;
  onClose: () => void;
  closeLabel?: string;
  solo?: boolean;
  board?: RouteBoardPlayer[];
  boardLoading?: boolean;
  variant?: 'dialog' | 'page' | 'roster';
  /** News column for `roster` layout (My Team bio modal). */
  news?: ReactNode;
  /** When set (My Team), head ranks use only this import host. */
  ratingsPlatform?: 'espn' | 'sleeper' | 'cbs';
  /**
   * Optional override for WEEK PROJECTION (e.g. roster mRoster proj).
   * When omitted, uses compare payload `weekProjectedPoints` (any player).
   */
  weekProjectedPoints?: number;
  /** NFL week for WK{#} PROJ label (My Team). */
  currentWeek?: number;
  /** Depth-chart name click (My Team bio) — swap the open player. */
  onSelectPlayer?: (name: string) => void;
  /** Roster position hint so game-log pills can render before compare/log load. */
  playerPosition?: Position;
  /** Roster injury status override (My Team); falls back to compare `player.status`. */
  playerStatus?: string;
  /** Roster name → injury status (My Team) so depth-chart mates use live import status. */
  rosterStatusByName?: Record<string, string | undefined>;
  /** Season for league FA/waiver/owned lookup (My Team bio). */
  availabilitySeason?: number;
}

function RatingsValue({
  cell,
  posLabel,
  scopeLabel,
}: {
  cell?: PlatformRatingCell;
  posLabel: string;
  scopeLabel: string;
}) {
  const rank = cell?.rank;
  if (rank == null) {
    return <span className="roster-bio-ratings-value is-empty">—</span>;
  }
  const shown = posLabel !== '—' ? `${posLabel}${rank}` : String(rank);
  return (
    <span
      className="roster-bio-ratings-value is-heat"
      style={positionalRankHeat(rank, posLabel !== '—' ? posLabel : undefined)}
      title={`${scopeLabel} · ${shown} (1 = best at position)`}
    >
      {shown}
    </span>
  );
}

function platformCells(
  ratings: PlayerPlatformRatings,
  platform?: 'espn' | 'sleeper' | 'cbs'
): { week?: PlatformRatingCell; ros?: PlatformRatingCell } {
  const id = platform ?? 'espn';
  return { week: ratings.week[id], ros: ratings.ros[id] };
}

/** Week / ROS positional ranks — right side of the name card. */
function RosterBioHeadRanks({
  ratings,
  position,
  platform,
  onBye,
}: {
  ratings: PlayerPlatformRatings;
  position?: Position;
  platform?: 'espn' | 'sleeper' | 'cbs';
  /** Current NFL week is this player's bye — show BYE instead of week rank. */
  onBye?: boolean;
}) {
  const posLabel =
    position === 'QB' ||
    position === 'RB' ||
    position === 'WR' ||
    position === 'TE' ||
    position === 'K'
      ? position
      : position === 'D/ST'
        ? 'DST'
        : '—';
  const { week, ros } = platformCells(ratings, platform);

  return (
    <div className="roster-bio-head-ranks" aria-label="Positional rankings">
      <div className="roster-bio-head-rank-col">
        {onBye ? (
          <span
            className="roster-bio-ratings-value is-bye"
            title={`Week ${ratings.currentWeek} · bye`}
          >
            BYE
          </span>
        ) : (
          <RatingsValue
            cell={week}
            posLabel={posLabel}
            scopeLabel={`Week ${ratings.currentWeek}`}
          />
        )}
        <span className="roster-bio-head-rank-label">WEEK {ratings.currentWeek}</span>
      </div>
      <div className="roster-bio-head-rank-col">
        <RatingsValue cell={ros} posLabel={posLabel} scopeLabel="ROS rank" />
        <span className="roster-bio-head-rank-label roster-bio-head-rank-label-stack">
          <span>ROS</span>
          <span>RANK</span>
        </span>
      </div>
    </div>
  );
}

function posShort(position: Position | undefined): string {
  if (position === 'D/ST') return 'DST';
  return position ?? '—';
}

/** Former ratings slot — current-week projected points + opp matchup. */
function RosterBioWeekProj({
  week,
  points,
  onBye,
  matchup,
}: {
  week: number;
  points?: number;
  onBye?: boolean;
  matchup?: PlayerWeekMatchup;
}) {
  const shown = onBye
    ? 'BYE'
    : points != null && Number.isFinite(points)
      ? points.toFixed(1)
      : '—';
  const opp = matchup?.opponent;
  const pos = posShort(matchup?.position);
  const vsLabel = opp ? `${opp} vs ${pos}:` : `Opp vs ${pos}:`;
  const fpLabel = opp ? `${opp} FPA to ${pos}:` : `Opp FPA to ${pos}:`;
  const vsValue = onBye
    ? 'BYE'
    : matchup?.oprkRank != null
      ? `#${matchup.oprkRank}`
      : '—';
  const fpValue = onBye
    ? 'BYE'
    : matchup?.fpAllowedPerGame != null
      ? matchup.fpAllowedPerGame.toFixed(1)
      : '—';
  return (
    <div className="roster-bio-week-proj" aria-label={`Week ${week} projection`}>
      <div className="roster-bio-week-proj-metric">
        <div
          className="roster-bio-week-proj-label"
          title="ESPN PPR projection for this week"
        >
          WEEK {week} PROJECTION:
        </div>
        <div
          className={`roster-bio-week-proj-value${onBye || points == null ? ' is-empty' : ''}${onBye ? ' is-bye' : ''}`}
        >
          {shown}
        </div>
      </div>
      <div className="roster-bio-week-proj-metric">
        <div
          className="roster-bio-week-proj-label"
          title="ESPN opponent rank vs this position (1 = toughest)"
        >
          {vsLabel}
        </div>
        <div
          className={[
            'roster-bio-week-proj-value',
            'is-matchup',
            onBye || matchup?.oprkRank == null ? 'is-empty' : '',
            onBye ? 'is-bye' : '',
            onBye ? '' : oprkHeatClass(matchup?.oprkRank),
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {vsValue}
        </div>
      </div>
      <div className="roster-bio-week-proj-metric">
        <div
          className="roster-bio-week-proj-label"
          title="Fantasy points allowed per game to this position"
        >
          {fpLabel}
        </div>
        <div
          className={`roster-bio-week-proj-value is-matchup${onBye || matchup?.fpAllowedPerGame == null ? ' is-empty' : ''}${onBye ? ' is-bye' : ''}`}
        >
          {fpValue}
        </div>
      </div>
    </div>
  );
}

function RosterBioStats({
  rows,
  takeaways,
}: {
  rows: Row[];
  takeaways?: PlayerCompare['takeaways'];
}) {
  const [tab, setTab] = useState<'draft' | 'season'>('season');
  const shown = rows.filter((row) => row.tab === tab);
  return (
    <div className={`roster-bio-stats-panel is-${tab}`}>
      <div className="roster-bio-stats-head">
        <div className="player-gamelog-pills" role="tablist" aria-label="Player stats">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'draft'}
            className={`player-gamelog-pill${tab === 'draft' ? ' active' : ''}`}
            onClick={() => setTab('draft')}
          >
            Draft
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'season'}
            className={`player-gamelog-pill${tab === 'season' ? ' active' : ''}`}
            onClick={() => setTab('season')}
          >
            Season
          </button>
        </div>
      </div>
      <div
        className={`roster-bio-stats-grid is-${tab}`}
        role="tabpanel"
      >
        {shown.map((row) => (
          <div key={row.label} className="roster-bio-stat">
            <span className="roster-bio-stat-label">{row.label}</span>
            <StatValue val={row.left} tone={row.leftTone} />
          </div>
        ))}
      </div>
      {tab === 'draft' && takeaways && takeaways.length > 0 && (
        <div className="player-takeaways">
          <h3>Expert takeaways</h3>
          {takeaways.map((t) => (
            <p key={t.id}>
              {t.claim}
              {t.sources.length > 0 && (
                <span className="player-takeaway-src">{t.sources.join(', ')}</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Season-tab labels — same copy/geometry as loaded stats so the shell doesn’t grow. */
const STATS_PLACEHOLDER_LABELS = [
  'ESPN Current Rank',
  'Current Pos. Rank',
  'SOS',
  'QB',
  'Offense (YTD PF)',
  'O-line (sack %)',
  'YTD PPR',
  'YTD PPR avg/g',
] as const;

/** Keeps the stats panel grid ratio while the gated player load is in flight. */
function RosterBioStatsPlaceholder() {
  return (
    <div className="roster-bio-stats-panel is-season" aria-hidden>
      <div className="roster-bio-stats-head">
        <div className="player-gamelog-pills" role="presentation">
          <button type="button" className="player-gamelog-pill" tabIndex={-1} disabled>
            Draft
          </button>
          <button type="button" className="player-gamelog-pill active" tabIndex={-1} disabled>
            Season
          </button>
        </div>
      </div>
      <div className="roster-bio-stats-grid is-season">
        {STATS_PLACEHOLDER_LABELS.map((label) => (
          <div key={label} className="roster-bio-stat">
            <span className="roster-bio-stat-label">{label}</span>
            <span className="compare-val">—</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function depthPillLabel(pos: string, depth: number, solo: boolean): string {
  const base = pos === 'D/ST' || pos === 'DST' ? 'DST' : pos;
  return solo ? base : `${base}${depth}`;
}

function DepthChartRow({
  entry,
  card,
  pos,
  posClass,
  solo,
  onSelect,
  statusOverride,
}: {
  entry: NonNullable<PlayerCompare['depthChart']>[number];
  card: PlayerCompare;
  pos: string;
  posClass: string;
  /** One name at the position → pill is `K` / `DST` with no depth digit. */
  solo: boolean;
  onSelect?: (name: string) => void;
  statusOverride?: string;
}) {
  const badge = statusBadge(statusOverride ?? entry.status);
  const self = entry.playerName === card.player.playerName;
  const pillLabel = depthPillLabel(pos, entry.depth, solo);
  const body = (
    <>
      <span className={`pos-pill ${posClass}`}>{pillLabel}</span>
      <span className="depth-chart-who">
        <span className="depth-chart-name">{entry.playerName}</span>
        {badge && (
          <span className={`status-badge status-badge-${badge.tone}`} title={badge.title}>
            {badge.label}
          </span>
        )}
      </span>
      <span className="depth-chart-meta">
        <span className="depth-chart-rank">#{entry.rank}</span>
      </span>
    </>
  );
  return (
    <li>
      {onSelect ? (
        <button
          type="button"
          className={`depth-chart-row${self ? ' is-self' : ''} is-clickable`}
          onClick={() => onSelect(entry.playerName)}
        >
          {body}
        </button>
      ) : (
        <div className={`depth-chart-row${self ? ' is-self' : ''}`}>{body}</div>
      )}
    </li>
  );
}

function DepthChart({
  card,
  split = false,
  onSelectPlayer,
  statusByName,
}: {
  card: PlayerCompare;
  /**
   * When true (My Team bio), chunk into columns that fit the stretched box height;
   * more than two columns scroll horizontally.
   */
  split?: boolean;
  onSelectPlayer?: (name: string) => void;
  statusByName?: Record<string, string | undefined>;
}) {
  const chart = card.depthChart ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [perColumn, setPerColumn] = useState(4);

  useEffect(() => {
    if (!split || chart.length === 0) return;
    const root = rootRef.current;
    const cols = colsRef.current;
    if (!root || !cols) return;

    const measure = () => {
      const row = cols.querySelector('.depth-chart-row') as HTMLElement | null;
      if (!row) return;
      const rowH = row.getBoundingClientRect().height;
      const available = cols.clientHeight;
      if (rowH <= 0 || available <= 0) return;
      const next = Math.max(1, Math.floor(available / rowH));
      setPerColumn((prev) => (prev === next ? prev : next));
    };

    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(root);
    ro.observe(cols);
    measure();
    return () => ro.disconnect();
  }, [split, chart.length]);

  if (chart.length === 0) return null;
  const team = card.depthChartTeam ?? card.player.nflTeam ?? '';
  const pos = card.player.position;
  const posClass = `pos-${pos.replace('/', '')}`;
  const solo = chart.length === 1;
  const columns: Array<NonNullable<PlayerCompare['depthChart']>> = [];
  if (split) {
    const size = Math.max(1, perColumn);
    for (let i = 0; i < chart.length; i += size) {
      columns.push(chart.slice(i, i + size));
    }
  } else {
    columns.push(chart);
  }
  const useSplit = split && columns.length > 1;
  return (
    <div
      ref={rootRef}
      className={`depth-chart${split ? ' depth-chart-inline' : ''}${useSplit ? ' is-split' : ''}`}
    >
      <h3>
        {team} {pos} Depth Chart
      </h3>
      <div ref={colsRef} className="depth-chart-cols">
        {columns.map((col, colIdx) => (
          <ol key={colIdx}>
            {col.map((entry) => (
              <DepthChartRow
                key={entry.playerName}
                entry={entry}
                card={card}
                pos={pos}
                posClass={posClass}
                solo={solo}
                onSelect={onSelectPlayer}
                statusOverride={statusByName?.[entry.playerName]}
              />
            ))}
          </ol>
        ))}
      </div>
    </div>
  );
}

export default function PlayerCompareDialog({
  leftName,
  round,
  onClose,
  closeLabel,
  solo = false,
  board = [],
  boardLoading = false,
  variant = 'dialog',
  news,
  ratingsPlatform,
  weekProjectedPoints,
  currentWeek,
  onSelectPlayer,
  playerPosition,
  playerStatus,
  rosterStatusByName,
  availabilitySeason,
}: Props) {
  const gate = useBioPlayerLoad();
  const gated = gate != null;
  const [leftOwn, setLeftOwn] = useState<PlayerCompare | null>(null);
  const [right, setRight] = useState<PlayerCompare | null>(null);
  const [query, setQuery] = useState('');
  const [pickName, setPickName] = useState('');
  const [busyOwn, setBusyOwn] = useState(false);
  const [errorOwn, setErrorOwn] = useState<string | null>(null);
  const [leagueAvail, setLeagueAvail] = useState<LeaguePlayerAvailability | null>(null);

  const left = gated ? gate.compare : leftOwn;
  const busy = gated ? gate.loading : busyOwn;
  const error = gated ? gate.compareError : errorOwn;

  useEffect(() => {
    // Roster bio uses BioPlayerLoadProvider (compare + log + news, atomic reveal).
    if (gated) return;
    let cancelled = false;
    setBusyOwn(true);
    setErrorOwn(null);
    setLeftOwn(null);
    getPlayerCompare(leftName)
      .then((data) => {
        if (cancelled) return;
        setLeftOwn(data.card);
        setErrorOwn(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLeftOwn(null);
        setErrorOwn(err instanceof Error ? err.message : 'Could not load that player.');
      })
      .finally(() => {
        if (!cancelled) setBusyOwn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leftName, gated]);

  useEffect(() => {
    if (variant !== 'roster') {
      setLeagueAvail(null);
      return;
    }
    let cancelled = false;
    setLeagueAvail(null);
    getLeaguePlayerAvailability(leftName, availabilitySeason)
      .then((row) => {
        if (!cancelled) setLeagueAvail(row);
      })
      .catch(() => {
        if (!cancelled) setLeagueAvail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [variant, leftName, availabilitySeason]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupedBoard(
      board.filter((p) => {
        if (p.playerName === leftName) return false;
        if (!q) return true;
        return (
          p.playerName.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q) ||
          String(p.rank).includes(q)
        );
      })
    );
  }, [board, leftName, query]);

  useEffect(() => {
    const names = options.flatMap((g) => g.players.map((p) => p.playerName));
    if (names.length > 0 && !names.includes(pickName)) setPickName(names[0]);
  }, [options, pickName]);

  async function confirmRight() {
    if (!pickName) return;
    setBusyOwn(true);
    setErrorOwn(null);
    try {
      const data = await getPlayerCompare(pickName);
      setRight(data.card);
    } catch (err) {
      setErrorOwn(err instanceof Error ? err.message : 'Could not load that player.');
    } finally {
      setBusyOwn(false);
    }
  }

  function changePlayer() {
    setRight(null);
    setQuery('');
    setErrorOwn(null);
  }

  const rows = left ? rowsFor(left, right) : [];
  const page = variant === 'page';
  const roster = variant === 'roster';
  const dismiss = closeLabel ?? (page || roster ? 'Back to search' : 'Close');
  const title = solo ? (left?.player.playerName ?? leftName) : `Compare R${round} pick`;
  const subtitle = solo
    ? round != null
      ? `R${round} pick.`
      : ''
    : `${leftName} on the left. Search anyone on the board for the right side.`;

  const statsTable = left && (
    <div className="compare-split-stats">
      <table className="compare-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <ValueCell val={row.left} tone={row.leftTone} />
              {!solo && <ValueCell val={row.right} tone={row.rightTone} />}
            </tr>
          ))}
        </tbody>
      </table>
      {!roster && (
        <div className={`depth-charts${right ? ' pair' : ''}`}>
          <DepthChart card={left} />
          {right && <DepthChart card={right} />}
        </div>
      )}
      {left.takeaways && left.takeaways.length > 0 && (
        <div className="player-takeaways">
          <h3>Expert takeaways</h3>
          {left.takeaways.map((t) => (
            <p key={t.id}>
              {t.claim}
              {t.sources.length > 0 && (
                <span className="player-takeaway-src">{t.sources.join(', ')}</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );

  if (roster) {
    const gateLoading = Boolean(gate?.loading);
    const weekNum =
      currentWeek ?? left?.platformRatings?.currentWeek ?? EMPTY_PLATFORM_RATINGS.currentWeek;
    const onBye =
      !gateLoading &&
      left != null &&
      weekNum > 0 &&
      ((left.player.byeWeek != null && left.player.byeWeek === weekNum) ||
        Boolean(left.weekMatchup?.bye));
    const injury = !gateLoading
      ? statusBadge(playerStatus ?? left?.player.status)
      : null;
    const headRatings = left?.platformRatings
      ? left.platformRatings
      : { ...EMPTY_PLATFORM_RATINGS, currentWeek: weekNum || currentWeek || 0 };
    return (
      <section
        className="compare-dialog solo compare-page roster-bio"
        aria-label={title}
        aria-busy={gateLoading || busy}
      >
        <div className="roster-bio-top">
          <div className="compare-head roster-bio-head">
            <div className="roster-bio-head-id">
              <strong>
                {leftName}
                {injury && (
                  <span
                    className={`status-badge status-badge-${injury.tone} roster-bio-injury`}
                    title={injury.title}
                  >
                    {injury.label}
                  </span>
                )}
                {leagueAvail && leagueAvail.pool !== 'UNKNOWN' && (
                  <span
                    className={`roster-bio-pool roster-bio-pool-${
                      leagueAvail.mine ? 'mine' : leagueAvail.pool.toLowerCase()
                    }`}
                    title={
                      leagueAvail.mine
                        ? 'On your imported team'
                        : leagueAvail.pool === 'FREEAGENT'
                          ? 'Free agent in your league'
                          : leagueAvail.pool === 'WAIVERS'
                            ? 'On waivers in your league'
                            : 'Rostered by another team in your league'
                    }
                  >
                    {leagueAvail.mine ? 'Owned by you' : leagueAvail.poolLabel}
                  </span>
                )}
              </strong>
              <span>
                {gateLoading || !left
                  ? '\u00a0'
                  : `${left.player.position} · ${left.player.nflTeam ?? 'FA'} · ESPN #${left.player.rank}`}
              </span>
            </div>
            <RosterBioHeadRanks
              ratings={headRatings}
              position={gateLoading ? playerPosition : left?.player.position}
              platform={ratingsPlatform}
              onBye={onBye}
            />
          </div>
        </div>
        {weekNum > 0 && (
          <RosterBioWeekProj
            week={weekNum}
            points={
              gateLoading
                ? undefined
                : (weekProjectedPoints ?? left?.weekProjectedPoints)
            }
            onBye={onBye}
            matchup={
              gateLoading
                ? playerPosition
                  ? { week: weekNum, position: playerPosition }
                  : undefined
                : left?.weekMatchup
            }
          />
        )}
        <div className="roster-bio-depth">
          {left && !gateLoading ? (
            <DepthChart
              card={left}
              split
              onSelectPlayer={onSelectPlayer}
              statusByName={rosterStatusByName}
            />
          ) : (
            <div className="depth-chart is-split" aria-hidden>
              <h3>Depth Chart</h3>
              <div className="depth-chart-cols" />
            </div>
          )}
        </div>
        {news && <div className="roster-bio-news">{news}</div>}
        <PlayerGameLog
          name={leftName}
          layout="roster"
          position={playerPosition ?? left?.player.position}
        />
        <div className="roster-bio-stats">
          {left && !gateLoading ? (
            <RosterBioStats rows={rows} takeaways={left.takeaways} />
          ) : (
            <RosterBioStatsPlaceholder />
          )}
        </div>
        {error && !left && !gateLoading && (
          <p className="swap-error roster-bio-error">{error}</p>
        )}
      </section>
    );
  }

  const body = (
    <>
        <h2 id="compare-dialog-title">{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        <div className={`compare-heads${solo ? ' solo' : ''}`}>
          <div className="compare-head">
            <strong>{left?.player.playerName ?? leftName}</strong>
            <span>
              {left
                ? `${left.player.position} · ${left.player.nflTeam ?? 'FA'} · ESPN #${left.player.rank}`
                : busy
                  ? 'Loading…'
                  : ''}
            </span>
          </div>
          {!solo && (
          <div className="compare-head compare-head-pick">
            {right ? (
              <>
                <div className="compare-head-id">
                  <strong>{right.player.playerName}</strong>
                  <span>
                    {`${right.player.position} · ${right.player.nflTeam ?? 'FA'} · ESPN #${right.player.rank}`}
                  </span>
                </div>
                <button
                  type="button"
                  className="button secondary small compare-change"
                  onClick={changePlayer}
                  disabled={busy}
                >
                  Change player
                </button>
              </>
            ) : (
              <>
                <strong>Compare to</strong>
                <span>Search and confirm a player</span>
                <div className="compare-pick-tools">
                  <label className="swap-field">
                    Search
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Name, position, or rank"
                      autoFocus
                      disabled={busy || boardLoading}
                    />
                  </label>
                  <label className="swap-field">
                    Available players
                    <select
                      value={pickName}
                      onChange={(e) => setPickName(e.target.value)}
                      disabled={busy || boardLoading || board.length === 0}
                    >
                      {options.map((group) => (
                        <optgroup key={group.pos} label={group.pos}>
                          {group.players.map((p) => (
                            <option key={p.playerName} value={p.playerName}>
                              #{p.rank} {p.position} {p.playerName}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  {error && <p className="swap-error">{error}</p>}
                  <button
                    type="button"
                    className="button"
                    onClick={() => void confirmRight()}
                    disabled={busy || boardLoading || !pickName || board.length === 0}
                  >
                    {busy ? 'Loading…' : 'Confirm'}
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>

        {left && (
          <div className={`compare-split${solo ? ' solo' : ''}`}>
            {statsTable}
            {solo && <PlayerGameLog name={leftName} />}
          </div>
        )}

        {(solo || right) && error && !left && <p className="swap-error">{error}</p>}
        {!page && (
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
              {dismiss}
            </button>
          </div>
        )}
    </>
  );

  if (page) {
    return (
      <section className="compare-dialog solo compare-page" aria-labelledby="compare-dialog-title">
        {body}
      </section>
    );
  }

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onClose()} role="presentation">
      <div
        className={`dialog compare-dialog${solo ? ' solo' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
