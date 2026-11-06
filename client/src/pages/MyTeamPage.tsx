import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import BioRosterRail, { rosterOrder, type BioRailMode } from '../components/BioRosterRail';
import {
  BioPlayerLoadOverlay,
  BioPlayerLoadProvider,
} from '../components/BioPlayerLoadGate';
import PageLoading from '../components/PageLoading';
import PageTitle from '../components/PageTitle';
import PlayerCompareDialog from '../components/PlayerCompareDialog';
import PlayerNews from '../components/PlayerNews';
import PlayerSosWeekRow from '../components/PlayerSosWeekRow';
import WeatherGlyph from '../components/WeatherGlyph';
import { getFreeAgents, getMyTeam, refreshEspnTeam } from '../services/api';
import type {
  FantasyPlatform,
  FreeAgentPlayer,
  FreeAgentPosFilter,
  FreeAgentsView,
  LineupSlot,
  MyTeamRosterPlayer,
  MyTeamRosterView,
  MyTeamSeasonStats,
  Position,
  VsPosMatchup,
} from '../types';
import { oprkHeatClass } from '../utils/heatScale';
import { statusBadge } from '../utils/valueChips';

type OpenBioOpts = {
  from?: BioRailMode;
  position?: FreeAgentPosFilter;
  /** Seed the Available strip so the opened FA is present + centered. */
  faPlayer?: FreeAgentPlayer;
};

function faPosFromPlayer(position: Position): FreeAgentPosFilter {
  if (
    position === 'QB' ||
    position === 'RB' ||
    position === 'WR' ||
    position === 'TE' ||
    position === 'D/ST' ||
    position === 'K'
  ) {
    return position;
  }
  return 'ALL';
}

const STARTER_SLOTS: LineupSlot[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
/** Default ESPN starter counts (empty slots are omitted from mRoster). */
const DEFAULT_STARTER_COUNTS: Record<
  Exclude<LineupSlot, 'BE' | 'IR' | 'UNKNOWN'>,
  number
> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  'D/ST': 1,
  K: 1,
};
/** Placeholder ids — keep far from ESPN D/ST ids (≈ -16001…-16032). */
const EMPTY_SLOT_ESPN_BASE = -1_000_000;
const BENCH_SLOTS: LineupSlot[] = ['BE', 'UNKNOWN'];
const IR_SLOTS: LineupSlot[] = ['IR'];
const LINEUP_COL_COUNT = 12;
const FA_POS_FILTERS: FreeAgentPosFilter[] = [
  'ALL',
  'QB',
  'RB',
  'WR',
  'TE',
  'FLEX',
  'D/ST',
  'K',
];
const FA_COL_COUNT = 14;
const STATS_QB_COL_COUNT = 19;
const STATS_FLEX_COL_COUNT = 25;
const STATS_DST_COL_COUNT = 16;
const STATS_K_COL_COUNT = 13;

type TeamView = 'fantasy' | 'stats' | 'players';

function CalendarIcon() {
  return (
    <svg
      className="mt-sos-cal-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
    >
      <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 6h13" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 1v3M11 1v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Best-available free agents at this position. */
function FaPoolIcon() {
  return (
    <svg
      className="mt-sos-cal-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
    >
      <circle cx="6" cy="5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2.2 12.5c.6-2.2 2.2-3.3 3.8-3.3s3.2 1.1 3.8 3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M11.2 4.2v4.2M9.1 6.3h4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Opponent vs this player's position. */
function VsIcon() {
  return (
    <svg
      className="mt-sos-cal-icon mt-vs-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
    >
      <text
        x="8"
        y="11.6"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="9.25"
        fontWeight="800"
        fontFamily="system-ui, sans-serif"
      >
        VS
      </text>
    </svg>
  );
}

/** Roster position filter — three stacked pill bars (wide → narrow). */
function FilterIcon() {
  return (
    <svg
      className="mt-sos-cal-icon mt-filter-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
    >
      <path
        d="M2.5 3.75h11M4.5 8h7M6.5 12.25h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function posShortLabel(position: string | undefined): string {
  if (position === 'D/ST') return 'DST';
  return position ?? '—';
}

function faFilterFor(player: MyTeamRosterPlayer): FreeAgentPosFilter {
  if (player.lineupSlot === 'FLEX') return 'FLEX';
  if (
    player.position === 'QB' ||
    player.position === 'RB' ||
    player.position === 'WR' ||
    player.position === 'TE' ||
    player.position === 'D/ST' ||
    player.position === 'K'
  ) {
    return player.position;
  }
  return 'ALL';
}

/** Left-rail label for league-host OPRK aisle (ESPN / Sleeper / CBS). */
function leagueSosLabel(platform?: FantasyPlatform): string {
  if (platform === 'sleeper') return 'SLEEPER';
  if (platform === 'cbs') return 'CBS';
  return 'ESPN';
}

type ScheduleExpandSignal = { all: boolean; tick: number };

type RosterPosFilter = 'all' | 'QB' | 'RB' | 'WR' | 'FLEX' | 'D/ST' | 'K';

const ROSTER_FILTER_OPTIONS: Array<{ id: RosterPosFilter; label: string }> = [
  { id: 'all', label: 'View All' },
  { id: 'QB', label: 'QB Only' },
  { id: 'RB', label: 'RB Only' },
  { id: 'WR', label: 'WR Only' },
  { id: 'FLEX', label: 'Flex Only' },
  { id: 'D/ST', label: 'D Only' },
  { id: 'K', label: 'K Only' },
];

function matchesRosterFilter(
  player: MyTeamRosterPlayer,
  filter: RosterPosFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'FLEX') {
    // Flex-eligible skill positions in this league (RB / WR / TE), any slot.
    return player.position === 'RB' || player.position === 'WR' || player.position === 'TE';
  }
  if (filter === 'D/ST') return player.position === 'D/ST';
  // Empty FLEX placeholders are tagged position RB — keep them off RB-only lists.
  if (isEmptyLineupSlot(player) && player.lineupSlot === 'FLEX') return false;
  return player.position === filter;
}

function filterRosterPlayers(
  players: MyTeamRosterPlayer[],
  filter: RosterPosFilter
): MyTeamRosterPlayer[] {
  if (filter === 'all') return players;
  return players.filter((p) => matchesRosterFilter(p, filter));
}

function ShowAllExpandTools({
  schedulesChecked,
  onSchedulesChange,
  vsChecked,
  onVsChange,
  onApply,
  rosterFilter,
  onRosterFilterChange,
}: {
  schedulesChecked: boolean;
  onSchedulesChange: (next: boolean) => void;
  vsChecked: boolean;
  onVsChange: (next: boolean) => void;
  onApply: () => void;
  /** Lineup / Stats only — Players already has position pills. */
  rosterFilter?: RosterPosFilter;
  onRosterFilterChange?: (next: RosterPosFilter) => void;
}) {
  const showRosterFilter =
    rosterFilter != null && onRosterFilterChange != null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftFilter, setDraftFilter] = useState<RosterPosFilter>(
    rosterFilter ?? 'all'
  );
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menuOpen && rosterFilter != null) setDraftFilter(rosterFilter);
  }, [menuOpen, rosterFilter]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function applyFilter(next: RosterPosFilter) {
    onRosterFilterChange?.(next);
    setDraftFilter(next);
    setMenuOpen(false);
  }

  return (
    <div className="mt-lineup-schedule-tools">
      <div className="mt-show-all-box" role="group" aria-label="Show all strips">
        <span className="mt-show-all-label">Show All:</span>
        <label className="mt-lineup-schedule-check mt-show-all-icon-check" title="Show all schedules">
          <input
            type="checkbox"
            checked={schedulesChecked}
            onChange={(e) => onSchedulesChange(e.target.checked)}
            aria-label="Show all schedules"
          />
          <CalendarIcon />
        </label>
        <label className="mt-lineup-schedule-check mt-show-all-icon-check" title="Show all VS">
          <input
            type="checkbox"
            checked={vsChecked}
            onChange={(e) => onVsChange(e.target.checked)}
            aria-label="Show all VS"
          />
          <VsIcon />
        </label>
        <button type="button" className="mt-lineup-schedule-apply" onClick={onApply}>
          Apply
        </button>
      </div>
      {showRosterFilter && (
        <div className="mt-roster-filter" ref={filterRef}>
          <div className="mt-show-all-box mt-roster-filter-box">
            <button
              type="button"
              className={`mt-roster-filter-btn${menuOpen ? ' is-open' : ''}${
                rosterFilter !== 'all' ? ' is-active' : ''
              }`}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              aria-label={`Filter roster: ${
                ROSTER_FILTER_OPTIONS.find((o) => o.id === rosterFilter)?.label ??
                'View All'
              }`}
              title="Filter"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <FilterIcon />
              <span className="mt-roster-filter-current">
                {ROSTER_FILTER_OPTIONS.find((o) => o.id === rosterFilter)?.label ??
                  'View All'}
              </span>
            </button>
          </div>
          {menuOpen && (
            <div className="mt-roster-filter-menu" role="dialog" aria-label="Filter roster">
              <div
                className="mt-roster-filter-options"
                role="radiogroup"
                aria-label="Position filter"
              >
                {ROSTER_FILTER_OPTIONS.map((opt) => (
                  <label key={opt.id} className="mt-roster-filter-option">
                    <input
                      type="checkbox"
                      checked={draftFilter === opt.id}
                      onChange={() => setDraftFilter(opt.id)}
                      aria-checked={draftFilter === opt.id}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="mt-roster-filter-apply"
                onClick={() => applyFilter(draftFilter)}
              >
                Filter
              </button>
              <button
                type="button"
                className="mt-roster-filter-reset"
                onClick={() => applyFilter('all')}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function useExpandOpenState(
  keys: string[],
  expand?: ScheduleExpandSignal
) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const keysSig = keys.join('|');
  useEffect(() => {
    if (!expand || expand.tick <= 0) return;
    if (expand.all) {
      setOpenKeys(new Set(keysSig ? keysSig.split('|') : []));
    } else {
      setOpenKeys(new Set());
    }
  }, [expand?.tick, expand?.all, keysSig]);

  function toggleKey(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return { openKeys, toggleKey };
}

function useScheduleOpenState(
  keys: string[],
  scheduleExpand?: ScheduleExpandSignal
) {
  const { openKeys: openSos, toggleKey: toggleSos } = useExpandOpenState(
    keys,
    scheduleExpand
  );
  return { openSos, toggleSos };
}

function useVsOpenState(keys: string[], vsExpand?: ScheduleExpandSignal) {
  const { openKeys: openVs, toggleKey: toggleVs } = useExpandOpenState(
    keys,
    vsExpand
  );
  return { openVs, toggleVs };
}

function RemainingScheduleRow({
  open,
  colSpan,
  currentWeek,
  completedWeeks,
  platform,
  sosSlate,
  oprkSlate,
}: {
  open: boolean;
  colSpan: number;
  currentWeek: number;
  completedWeeks: number;
  platform?: FantasyPlatform;
  sosSlate?: MyTeamRosterPlayer['sosSlate'];
  oprkSlate?: MyTeamRosterPlayer['oprkSlate'];
}) {
  if (!sosSlate && !oprkSlate) return null;
  const showBlendedSos = completedWeeks < 4;
  const leagueLabel = leagueSosLabel(platform);
  return (
    <tr className={`mt-sos-row${open ? ' is-open' : ''}`}>
      <td colSpan={colSpan}>
        <div className="mt-sos-reveal">
          <div className="mt-sos-reveal-inner">
            <PlayerSosWeekRow
              currentWeek={currentWeek}
              active={open}
              tracks={[
                ...(oprkSlate
                  ? [
                      {
                        id: 'espn',
                        label: leagueLabel,
                        labelTitle: `${leagueLabel} league OPRK (1 = toughest)`,
                        weeks: oprkSlate.weeks,
                        scale: 'oprk' as const,
                      },
                    ]
                  : []),
                ...(showBlendedSos && sosSlate
                  ? [
                      {
                        id: 'blended',
                        label: 'BLENDED',
                        labelTitle:
                          'Blended SOS: Source B rates soft-anchored to ESPN OPRK, plus Off/OL (1 = toughest).',
                        weeks: sosSlate.weeks.map((w) => ({
                          ...w,
                          rank: w.rank == null || w.bye ? w.rank : 33 - w.rank,
                        })),
                        scale: 'oprk' as const,
                      },
                    ]
                  : []),
                ...(!showBlendedSos && !oprkSlate && sosSlate
                  ? [
                      {
                        id: 'blended',
                        label: leagueLabel,
                        labelTitle: `${leagueLabel} league OPRK fallback (1 = toughest)`,
                        weeks: sosSlate.weeks.map((w) => ({
                          ...w,
                          rank: w.rank == null || w.bye ? w.rank : 33 - w.rank,
                        })),
                        scale: 'oprk' as const,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
      </td>
    </tr>
  );
}

function VsExpandRow({
  open,
  colSpan,
  currentWeek,
  vsMatchup,
}: {
  open: boolean;
  colSpan: number;
  currentWeek: number;
  vsMatchup?: VsPosMatchup;
}) {
  return (
    <tr className={`mt-sos-row mt-vs-row${open ? ' is-open' : ''}`}>
      <td colSpan={colSpan}>
        <div className="mt-sos-reveal">
          <div className="mt-sos-reveal-inner">
            {open && <LineupVsStrip currentWeek={currentWeek} vsMatchup={vsMatchup} />}
          </div>
        </div>
      </td>
    </tr>
  );
}

type SortDir = 'desc' | 'asc';
type StatsSort = { key: string; dir: SortDir } | null;

function cycleStatsSort(current: StatsSort, key: string): StatsSort {
  if (!current || current.key !== key) return { key, dir: 'desc' };
  if (current.dir === 'desc') return { key, dir: 'asc' };
  return null;
}

/** Asc → desc → default (for PRK / OPRK / other lower-is-better). */
function cycleAscFirstSort(current: StatsSort, key: string): StatsSort {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

/** Keys where lower is better — first click ascending. */
const ASC_FIRST_SORT_KEYS = new Set(['prk', 'oprk', 'int', 'fuml', 'pa', 'ya']);

function cycleColumnSort(current: StatsSort, key: string): StatsSort {
  return ASC_FIRST_SORT_KEYS.has(key)
    ? cycleAscFirstSort(current, key)
    : cycleStatsSort(current, key);
}

/** Marks body cells in the active sort column (wash is CSS ::before — no layout shift). */
function sortColClass(sort: StatsSort, key: string): string {
  return sort?.key === key ? ' is-sorted' : '';
}

function sortByColumn<T>(
  players: T[],
  sort: StatsSort,
  valueOf: (p: T, key: string) => number | string | undefined
): T[] {
  if (!sort) return players;
  const indexed = players.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => {
    const av = valueOf(a.p, sort.key);
    const bv = valueOf(b.p, sort.key);
    const aMissing =
      av == null || av === '' || (typeof av === 'number' && Number.isNaN(av));
    const bMissing =
      bv == null || bv === '' || (typeof bv === 'number' && Number.isNaN(bv));
    if (aMissing && bMissing) return a.i - b.i;
    if (aMissing) return 1;
    if (bMissing) return -1;
    let cmp = 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      cmp = av.localeCompare(bv);
    } else {
      cmp = (av as number) - (bv as number);
    }
    if (cmp !== 0) return sort.dir === 'desc' ? -cmp : cmp;
    return a.i - b.i;
  });
  return indexed.map((x) => x.p);
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatKickoffTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatGameOutcome(
  gameStatus?: string,
  teamScore?: number,
  oppScore?: number,
): string | null {
  // Schedule CSV often stores 0-0 for games that haven't started — ignore those.
  if (gameStatus !== 'FINAL' && gameStatus !== 'IN_PROGRESS') return null;
  if (teamScore == null || oppScore == null || !Number.isFinite(teamScore) || !Number.isFinite(oppScore)) {
    if (gameStatus === 'FINAL') return 'Final';
    if (gameStatus === 'IN_PROGRESS') return 'Live';
    return null;
  }
  if (gameStatus !== 'FINAL' && teamScore === 0 && oppScore === 0) return 'Live';
  const result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T';
  return `${result} ${teamScore}-${oppScore}`;
}

function statusLines(
  iso?: string,
  bye?: boolean,
  gameStatus?: string,
  teamScore?: number,
  oppScore?: number,
): { primary: string; secondary?: string } {
  if (bye) return { primary: 'Bye' };
  if (!iso && gameStatus !== 'FINAL' && gameStatus !== 'IN_PROGRESS') return { primary: '—' };
  const when = iso ? formatKickoffTime(iso) : null;
  const outcome = formatGameOutcome(gameStatus, teamScore, oppScore);
  if (when && when !== '—' && outcome) return { primary: when, secondary: outcome };
  if (outcome) return { primary: outcome };
  if (gameStatus === 'IN_PROGRESS' && when && when !== '—') return { primary: when, secondary: 'Live' };
  if (gameStatus === 'IN_PROGRESS') return { primary: 'Live' };
  return { primary: when ?? '—' };
}

function formatOpp(p: {
  bye?: boolean;
  opponent?: string;
  home?: boolean;
}): string {
  if (p.bye) return 'BYE';
  if (!p.opponent) return '—';
  return p.home === false ? `@${p.opponent}` : p.opponent;
}

function signedDelta(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

function deltaClass(n?: number): string {
  if (n == null || Number.isNaN(n) || n === 0) return 'mt-muted';
  return n > 0 ? 'mt-delta-up' : 'mt-delta-down';
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** ESPN-style OPRK heat: low = tough (red), high = easy (green). Neutral 15–21. */
function oprkClass(rank?: number): string {
  return oprkHeatClass(rank);
}

function dash(n: number | undefined | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function ratio(made?: number, att?: number): string {
  if (made == null && att == null) return '—';
  if (made != null && att != null) return `${made}/${att}`;
  if (made != null) return String(made);
  return `—/${att}`;
}

function posRankTip(
  player: MyTeamRosterPlayer,
  field: string
): string | undefined {
  const r = player.statRanks?.[field];
  if (!r) return undefined;
  return `${ordinal(r.rank)} of ${r.of} ${player.position}`;
}

function StatTd({
  player,
  field,
  value,
  digits = 1,
  muted,
  children,
}: {
  player: MyTeamRosterPlayer;
  field: string;
  value?: number | null;
  digits?: number;
  muted?: boolean;
  children?: ReactNode;
}) {
  const tip = posRankTip(player, field);
  const empty = value == null || Number.isNaN(value);
  return (
    <td
      className={`mt-num${muted || empty ? ' mt-muted' : ''}`}
      title={tip}
    >
      {children ?? dash(value, digits)}
    </td>
  );
}

function sectionPlayers(
  players: MyTeamRosterPlayer[],
  slots: LineupSlot[]
): MyTeamRosterPlayer[] {
  const order = new Map(slots.map((s, i) => [s, i]));
  return players
    .filter((p) => order.has(p.lineupSlot))
    .sort((a, b) => {
      const slotDiff = (order.get(a.lineupSlot) ?? 99) - (order.get(b.lineupSlot) ?? 99);
      if (slotDiff !== 0) return slotDiff;
      return a.lineupSlotId - b.lineupSlotId;
    });
}

function isEmptyLineupSlot(player: MyTeamRosterPlayer): boolean {
  // Don't key off negative espnId alone — ESPN D/ST ids are negative (e.g. -16027).
  return player.name === 'Empty' && !player.nflTeam;
}

function emptySlotPosition(slot: LineupSlot): Position {
  if (slot === 'D/ST' || slot === 'K' || slot === 'QB' || slot === 'RB' || slot === 'WR' || slot === 'TE') {
    return slot;
  }
  // FLEX / unknown placeholders — position is unused in the Empty row.
  return 'RB';
}

function emptySlotLineupId(slot: LineupSlot): number {
  switch (slot) {
    case 'QB':
      return 0;
    case 'RB':
      return 2;
    case 'WR':
      return 4;
    case 'TE':
      return 6;
    case 'FLEX':
      return 23;
    case 'D/ST':
      return 16;
    case 'K':
      return 17;
    default:
      return 20;
  }
}

function emptyStarterPlaceholder(slot: LineupSlot, index: number): MyTeamRosterPlayer {
  const slotIndex = STARTER_SLOTS.indexOf(slot);
  return {
    espnId: EMPTY_SLOT_ESPN_BASE - slotIndex * 10 - index,
    name: 'Empty',
    nflTeam: '',
    position: emptySlotPosition(slot),
    lineupSlot: slot,
    lineupSlotId: emptySlotLineupId(slot),
  };
}

/** Ensure every default starter slot appears, even when ESPN omitted an empty one. */
function padStarterSlots(players: MyTeamRosterPlayer[]): MyTeamRosterPlayer[] {
  const filled = sectionPlayers(players, STARTER_SLOTS);
  const bySlot = new Map<LineupSlot, MyTeamRosterPlayer[]>();
  for (const p of filled) {
    const list = bySlot.get(p.lineupSlot) ?? [];
    list.push(p);
    bySlot.set(p.lineupSlot, list);
  }
  const out: MyTeamRosterPlayer[] = [];
  for (const slot of STARTER_SLOTS) {
    const have = bySlot.get(slot) ?? [];
    const need = DEFAULT_STARTER_COUNTS[slot] ?? 1;
    out.push(...have);
    for (let i = have.length; i < need; i++) {
      out.push(emptyStarterPlaceholder(slot, i));
    }
  }
  return out;
}

function byPositions(
  players: MyTeamRosterPlayer[],
  positions: Position[]
): MyTeamRosterPlayer[] {
  const posOrder = new Map(positions.map((p, i) => [p, i]));
  const slotRank = (slot: LineupSlot): number => {
    if (STARTER_SLOTS.includes(slot)) return 0;
    if (IR_SLOTS.includes(slot)) return 2;
    return 1;
  };
  return players
    .filter((p) => posOrder.has(p.position))
    .sort((a, b) => {
      const slotDiff = slotRank(a.lineupSlot) - slotRank(b.lineupSlot);
      if (slotDiff !== 0) return slotDiff;
      const posDiff = (posOrder.get(a.position) ?? 99) - (posOrder.get(b.position) ?? 99);
      if (posDiff !== 0) return posDiff;
      return a.lineupSlotId - b.lineupSlotId;
    });
}

function PlayerCell({
  player,
  sosOpen,
  faOpen,
  vsOpen,
  onToggleSos,
  onToggleFa,
  onToggleVs,
  onOpenBio,
}: {
  player: MyTeamRosterPlayer;
  sosOpen?: boolean;
  faOpen?: boolean;
  vsOpen?: boolean;
  onToggleSos?: () => void;
  onToggleFa?: () => void;
  onToggleVs?: () => void;
  onOpenBio?: (name: string) => void;
}) {
  const badge = statusBadge(player.status);
  const canSos = Boolean(
    onToggleSos && (player.sosSlate?.weeks?.length || player.oprkSlate?.weeks?.length)
  );
  const faPos = faFilterFor(player);
  const vsPos = posShortLabel(player.vsMatchup?.position ?? player.position);
  const vsOpp = player.vsMatchup?.opponent ?? player.opponent;
  return (
    <td className="mt-col-player">
      <div className="mt-player">
        {onOpenBio ? (
          <button
            type="button"
            className="mt-player-name mt-player-open"
            onClick={() => onOpenBio(player.name)}
          >
            {player.name}
          </button>
        ) : (
          <span className="mt-player-name">{player.name}</span>
        )}
        {badge && (
          <span className={`status-text status-text-${badge.tone}`} title={badge.title}>
            {badge.label}
          </span>
        )}
        {canSos && (
          <button
            type="button"
            className={`mt-sos-toggle${sosOpen ? ' is-open' : ''}`}
            onClick={onToggleSos}
            aria-expanded={sosOpen}
            aria-label={
              sosOpen
                ? `Hide upcoming schedule for ${player.name}`
                : `Show upcoming schedule for ${player.name}`
              }
            title="Upcoming Schedule"
          >
            <CalendarIcon />
          </button>
        )}
        {onToggleFa && (
          <button
            type="button"
            className={`mt-sos-toggle mt-fa-toggle${faOpen ? ' is-open' : ''}`}
            onClick={onToggleFa}
            aria-expanded={faOpen}
            aria-label={
              faOpen
                ? `Hide best available ${faPos} free agents`
                : `Show best available ${faPos} free agents`
            }
            title={`Best available ${faPos === 'ALL' ? 'players' : faPos}`}
          >
            <FaPoolIcon />
          </button>
        )}
        {onToggleVs && (
          <button
            type="button"
            className={`mt-sos-toggle mt-vs-toggle${vsOpen ? ' is-open' : ''}`}
            onClick={onToggleVs}
            aria-expanded={vsOpen}
            aria-label={
              vsOpen
                ? `Hide ${vsOpp} vs ${vsPos} matchup`
                : `Show ${vsOpp} vs ${vsPos} matchup`
            }
            title={vsOpp ? `${vsOpp} vs ${vsPos}` : 'Opponent vs position'}
          >
            <VsIcon />
          </button>
        )}
      </div>
      <div className="mt-player-meta">
        {player.nflTeam ? `${player.nflTeam} ` : ''}
        {player.position}
      </div>
    </td>
  );
}

type FaSortKey =
  | 'player'
  | 'type'
  | 'proj'
  | 'score'
  | 'oprk'
  | 'started'
  | 'rost'
  | 'delta'
  | 'prk'
  | 'fpts'
  | 'avg'
  | 'last';

function faSortValue(p: FreeAgentPlayer, key: string): number | string | undefined {
  switch (key as FaSortKey) {
    case 'player':
      return p.name.toLowerCase();
    case 'type':
      return p.typeLabel.toLowerCase();
    case 'proj':
      return p.projectedPoints;
    case 'score':
      return p.weekScore;
    case 'oprk':
      return p.oppRank;
    case 'started':
      return p.percentStarted;
    case 'rost':
      return p.percentOwned;
    case 'delta':
      return p.percentChange;
    case 'prk':
      return p.posRank;
    case 'fpts':
      return p.fantasyPoints;
    case 'avg':
      return p.avgPoints;
    case 'last':
      return p.lastWeekPoints;
    default:
      return undefined;
  }
}

function sortFaPlayers(
  players: FreeAgentPlayer[],
  sort: StatsSort
): FreeAgentPlayer[] {
  return sortByColumn(players, sort, faSortValue);
}

const FA_STRIP_COLS = 10;

/** Opponent vs position metrics under a lineup / stats / FA row. */
function withRank(value: string, rank?: number | null): string {
  if (value === '—') return value;
  if (rank == null) return value;
  return `${value} (#${rank})`;
}

type VsYardsMode = 'air' | 'rush';

function LineupVsStrip({
  currentWeek,
  vsMatchup: m,
}: {
  currentWeek: number;
  vsMatchup?: VsPosMatchup;
}) {
  const [yardsMode, setYardsMode] = useState<VsYardsMode>(() =>
    m?.position === 'RB' ? 'rush' : 'air'
  );
  if (!m) {
    return <p className="subtitle mt-lineup-fa-msg">No matchup this week.</p>;
  }
  const pos = posShortLabel(m.position);
  const skill = m.position === 'QB' || m.position === 'RB' || m.position === 'WR' || m.position === 'TE';
  const airLabel = m.position === 'QB' ? 'Passing' : 'Receiving';
  const airShort = m.position === 'QB' ? 'Pass' : 'Rec';
  const airTipNoun = m.position === 'QB' ? 'net passing' : 'receiving';

  const fixed: Array<{ label: string; tip: string; value: string; heat?: string }> = [
    {
      label: `Rank vs ${pos}`,
      tip: 'ESPN opponent rank vs this position (1 = toughest)',
      value: m.oprkRank != null ? `#${m.oprkRank}` : '—',
      heat: m.oprkRank != null ? oprkHeatClass(m.oprkRank) : '',
    },
    {
      label: `FPA to ${pos}`,
      tip: 'Fantasy points allowed per game to the whole position (rank 1 = fewest / toughest)',
      value: withRank(dash(m.fpAllowedPerGame, 1), m.fpAllowedRank),
      heat: m.fpAllowedRank != null ? oprkHeatClass(m.fpAllowedRank) : '',
    },
    {
      label: `L3 FPA to ${pos}`,
      tip: 'Avg fantasy points allowed over the last 3 completed weeks (rank 1 = fewest / toughest)',
      value: withRank(dash(m.last3FpAllowed, 1), m.last3FpAllowedRank),
      heat: m.last3FpAllowedRank != null ? oprkHeatClass(m.last3FpAllowedRank) : '',
    },
    {
      label: `TDs to ${pos}`,
      tip:
        m.position === 'QB'
          ? 'Season pass + rush TDs allowed (rank 1 = fewest / toughest)'
          : 'Season rush + receiving TDs allowed to this position (rank 1 = fewest / toughest)',
      value: withRank(
        m.tdsAllowed != null ? String(m.tdsAllowed) : '—',
        m.tdsAllowedRank
      ),
      heat: m.tdsAllowedRank != null ? oprkHeatClass(m.tdsAllowedRank) : '',
    },
  ];

  const split =
    yardsMode === 'air'
      ? {
          ypg: m.airYardsPerGame,
          ypgRank: m.airYardsRank,
          l3: m.last3AirYards,
          l3Rank: m.last3AirYardsRank,
          tds: m.airTds,
          tdsRank: m.airTdsRank,
          ydsTip: `${airTipNoun} yards allowed per game`,
          l3Tip: `Avg ${airTipNoun} yards allowed over the last 3 completed weeks`,
          tdsLabel: `${airShort} TDs`,
          tdsTip: `Season ${airTipNoun} TDs allowed (rank 1 = fewest / toughest)`,
        }
      : {
          ypg: m.rushYardsPerGame,
          ypgRank: m.rushYardsRank,
          l3: m.last3RushYards,
          l3Rank: m.last3RushYardsRank,
          tds: m.rushTds,
          tdsRank: m.rushTdsRank,
          ydsTip: 'Rushing yards allowed per game to this position',
          l3Tip: 'Avg rushing yards allowed over the last 3 completed weeks',
          tdsLabel: 'Rush TDs',
          tdsTip: 'Season rushing TDs allowed (rank 1 = fewest / toughest)',
        };

  const yardsMetrics: Array<{ label: string; tip: string; value: string; heat?: string }> = [
    {
      label: `Yds/g to ${pos}`,
      tip: `${split.ydsTip} (rank 1 = fewest / toughest)`,
      value: withRank(dash(split.ypg, 1), split.ypgRank),
      heat: split.ypgRank != null ? oprkHeatClass(split.ypgRank) : '',
    },
    {
      label: `L3 Yds/g to ${pos}`,
      tip: `${split.l3Tip} (rank 1 = fewest / toughest)`,
      value: withRank(dash(split.l3, 1), split.l3Rank),
      heat: split.l3Rank != null ? oprkHeatClass(split.l3Rank) : '',
    },
    {
      label: split.tdsLabel,
      tip: split.tdsTip,
      value: withRank(split.tds != null ? String(split.tds) : '—', split.tdsRank),
      heat: split.tdsRank != null ? oprkHeatClass(split.tdsRank) : '',
    },
  ];

  const renderMetric = (metric: {
    label: string;
    tip: string;
    value: string;
    heat?: string;
  }) => (
    <div key={metric.label} className="mt-vs-metric">
      <div className="mt-vs-metric-label" title={metric.tip}>
        {metric.label}
      </div>
      <div
        className={['mt-vs-metric-value', metric.value === '—' ? 'is-empty' : '', metric.heat]
          .filter(Boolean)
          .join(' ')}
      >
        {metric.value}
      </div>
    </div>
  );

  return (
    <div
      className={`mt-vs-strip${skill ? ' has-yards-toggle' : ''}`}
      aria-label={`Week ${currentWeek} matchup: ${m.opponent} vs ${pos}`}
    >
      <div className="mt-vs-strip-main">
        <span className="mt-vs-strip-title">
          <span className="mt-vs-strip-kicker">Week {currentWeek} Matchup:</span>
          <span className="mt-vs-strip-matchup">
            {m.opponent} vs {pos}
          </span>
        </span>
        <div className="mt-vs-strip-fixed">{fixed.map(renderMetric)}</div>
      </div>
      <div className="mt-vs-strip-yards">
        {skill ? (
          <div className="mt-vs-yards-toggle" role="group" aria-label="Yards and TDs split">
            <button
              type="button"
              className={`mt-vs-yards-btn${yardsMode === 'air' ? ' is-active' : ''}`}
              aria-pressed={yardsMode === 'air'}
              onClick={() => setYardsMode('air')}
            >
              {airLabel}
            </button>
            <button
              type="button"
              className={`mt-vs-yards-btn${yardsMode === 'rush' ? ' is-active' : ''}`}
              aria-pressed={yardsMode === 'rush'}
              onClick={() => setYardsMode('rush')}
            >
              Rushing
            </button>
          </div>
        ) : (
          <div className="mt-vs-yards-toggle-slot" aria-hidden />
        )}
        <div className="mt-vs-yards-metrics">{yardsMetrics.map(renderMetric)}</div>
      </div>
    </div>
  );
}

/** Compact best-available FA strip under a lineup row. */
function LineupFaStrip({
  season,
  position,
  platform,
  onOpenBio,
}: {
  season: number;
  position: FreeAgentPosFilter;
  platform?: FantasyPlatform;
  onOpenBio: (name: string, opts?: OpenBioOpts) => void;
}) {
  const [rows, setRows] = useState<FreeAgentPlayer[] | null>(null);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [completedWeeks, setCompletedWeeks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<StatsSort>({ key: 'proj', dir: 'desc' });
  const [openSos, setOpenSos] = useState<Set<number>>(() => new Set());
  // D/ST / K ownership is flatter — pull a wider page so deep units aren't clipped.
  const displayLimit = position === 'D/ST' || position === 'K' ? 20 : 8;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSort({ key: 'proj', dir: 'desc' });
    setOpenSos(new Set());
    // ESPN ranks the wire by %Rost; fetch a wider page, then keep top N by projection.
    const fetchLimit = position === 'D/ST' || position === 'K' ? 80 : 50;
    void getFreeAgents(season, { position, limit: fetchLimit })
      .then((view) => {
        if (cancelled) return;
        setRows(view.players);
        setCurrentWeek(view.currentWeek);
        setCompletedWeeks(view.completedWeeks ?? 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRows(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, position]);

  const label = position === 'ALL' ? 'players' : position;
  // Null sort (after cycling a column off) falls back to week projection.
  const effectiveSort: StatsSort = sort ?? { key: 'proj', dir: 'desc' };
  const sorted = rows
    ? sortFaPlayers(rows, effectiveSort).slice(0, displayLimit)
    : [];
  const showBlendedSos = completedWeeks < 4;
  const leagueLabel = leagueSosLabel(platform);

  function toggleSos(espnId: number) {
    setOpenSos((prev) => {
      const next = new Set(prev);
      if (next.has(espnId)) next.delete(espnId);
      else next.add(espnId);
      return next;
    });
  }

  const onSort = (key: string) => setSort((prev) => cycleColumnSort(prev, key));
  const sc = (key: string) => sortColClass(effectiveSort, key);

  return (
    <div className="mt-lineup-fa">
      <div className="mt-lineup-fa-head">Best available {label}</div>
      {error && <p className="error mt-lineup-fa-msg">{error}</p>}
      {loading && !rows ? (
        <p className="subtitle mt-lineup-fa-msg">Loading free agents…</p>
      ) : !loading && (!rows || rows.length === 0) ? (
        <p className="subtitle mt-lineup-fa-msg">No free agents at {label}.</p>
      ) : (
        <table className="mt-table mt-fa-table mt-lineup-fa-table">
          <thead>
            <tr className="mt-col-row">
              <SortableStatTh
                label="Player"
                tip="Player name"
                sortKey="player"
                sort={effectiveSort}
                onSort={onSort}
                align="left"
              />
              <SortableStatTh
                label="Type"
                tip="FA or waiver day"
                sortKey="type"
                sort={effectiveSort}
                onSort={onSort}
                align="left"
              />
              <th className="mt-col-opp" title="Opponent">
                Opp
              </th>
              <SortableStatTh
                label="Proj"
                tip="Week projection"
                sortKey="proj"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableStatTh
                label="OPRK"
                tip="Opponent rank (1 = toughest)"
                sortKey="oprk"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableStatTh
                label="%Rost"
                tip="% rostered"
                sortKey="rost"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableStatTh
                label="+/-"
                tip="Roster % change"
                sortKey="delta"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableStatTh
                label="PRK"
                tip="Positional rank"
                sortKey="prk"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableStatTh
                label="FPTS"
                tip="Season fantasy points"
                sortKey="fpts"
                sort={effectiveSort}
                onSort={onSort}
              />
              <SortableStatTh
                label="Avg"
                tip="Fantasy pts / game"
                sortKey="avg"
                sort={effectiveSort}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const badge = statusBadge(p.status);
              const canSos = Boolean(p.sosSlate?.weeks?.length || p.oprkSlate?.weeks?.length);
              const sosOpen = openSos.has(p.espnId);
              return (
                <Fragment key={p.espnId}>
                  <tr>
                    <td className={`mt-col-player${sc('player')}`}>
                      <div className="mt-lineup-fa-player">
                        <button
                          type="button"
                          className="mt-player-name mt-player-open"
                          onClick={() =>
                            onOpenBio(p.name, {
                              from: 'available',
                              position,
                              faPlayer: p,
                            })
                          }
                        >
                          {p.name}
                        </button>
                        {badge && (
                          <span
                            className={`status-text status-text-${badge.tone}`}
                            title={badge.title}
                          >
                            {badge.label}
                          </span>
                        )}
                        {canSos && (
                          <button
                            type="button"
                            className={`mt-sos-toggle${sosOpen ? ' is-open' : ''}`}
                            onClick={() => toggleSos(p.espnId)}
                            aria-expanded={sosOpen}
                            aria-label={
                              sosOpen
                                ? `Hide upcoming schedule for ${p.name}`
                                : `Show upcoming schedule for ${p.name}`
                              }
                            title="Upcoming Schedule"
                          >
                            <CalendarIcon />
                          </button>
                        )}
                        <span className="mt-lineup-fa-meta">
                          {p.nflTeam ? `${p.nflTeam} ` : ''}
                          {p.position}
                        </span>
                      </div>
                    </td>
                    <td className={`mt-col-type${sc('type')}`}>{p.typeLabel}</td>
                    <td className="mt-col-opp">{formatOpp(p)}</td>
                    <td className={`mt-num${p.projectedPoints == null ? ' mt-muted' : ''}${sc('proj')}`}>
                      {dash(p.projectedPoints, 1)}
                    </td>
                    <td className={`mt-num mt-oprk ${oprkClass(p.oppRank)}${sc('oprk')}`}>
                      {p.oppRank != null ? ordinal(p.oppRank) : '—'}
                    </td>
                    <td className={`mt-num${p.percentOwned == null ? ' mt-muted' : ''}${sc('rost')}`}>
                      {p.percentOwned != null ? Math.round(p.percentOwned) : '—'}
                    </td>
                    <td className={`mt-num ${deltaClass(p.percentChange)}${sc('delta')}`}>
                      {signedDelta(p.percentChange)}
                    </td>
                    <td className={`mt-num${p.posRank == null ? ' mt-muted' : ''}${sc('prk')}`}>
                      {p.posRank != null ? p.posRank : '—'}
                    </td>
                    <td className={`mt-num${p.fantasyPoints == null ? ' mt-muted' : ''}${sc('fpts')}`}>
                      {dash(p.fantasyPoints, 1)}
                    </td>
                    <td className={`mt-num${p.avgPoints == null ? ' mt-muted' : ''}${sc('avg')}`}>
                      {dash(p.avgPoints, 1)}
                    </td>
                  </tr>
                  {canSos && sosOpen && (
                    <tr className="mt-sos-row mt-fa-inner-sos is-open">
                      <td colSpan={FA_STRIP_COLS}>
                        <div className="mt-sos-reveal">
                          <div className="mt-sos-reveal-inner">
                            <PlayerSosWeekRow
                              currentWeek={currentWeek}
                              active
                              tracks={[
                                ...(p.oprkSlate
                                  ? [
                                      {
                                        id: 'espn',
                                        label: leagueLabel,
                                        labelTitle: `${leagueLabel} league OPRK (1 = toughest)`,
                                        weeks: p.oprkSlate.weeks,
                                        scale: 'oprk' as const,
                                      },
                                    ]
                                  : []),
                                ...(showBlendedSos && p.sosSlate
                                  ? [
                                      {
                                        id: 'blended',
                                        label: 'BLENDED',
                                        labelTitle:
                                          'Blended SOS: Source B rates soft-anchored to ESPN OPRK, plus Off/OL (1 = toughest).',
                                        weeks: p.sosSlate.weeks.map((w) => ({
                                          ...w,
                                          rank:
                                            w.rank == null || w.bye
                                              ? w.rank
                                              : 33 - w.rank,
                                        })),
                                        scale: 'oprk' as const,
                                      },
                                    ]
                                  : []),
                                ...(!showBlendedSos && !p.oprkSlate && p.sosSlate
                                  ? [
                                      {
                                        id: 'blended',
                                        label: leagueLabel,
                                        labelTitle: `${leagueLabel} league OPRK fallback (1 = toughest)`,
                                        weeks: p.sosSlate.weeks.map((w) => ({
                                          ...w,
                                          rank:
                                            w.rank == null || w.bye
                                              ? w.rank
                                              : 33 - w.rank,
                                        })),
                                        scale: 'oprk' as const,
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ResearchPtsCells({ player }: { player: MyTeamRosterPlayer }) {
  return (
    <>
      <td className="mt-num">
        {player.percentOwned != null ? `${Math.round(player.percentOwned)}` : '—'}
      </td>
      <td className="mt-num mt-muted">—</td>
      <StatTd player={player} field="fpts" value={player.fantasyPoints} digits={2} />
      <StatTd player={player} field="avg" value={player.avgPoints} digits={2} />
    </>
  );
}

function StatusText({
  kickoff,
  bye,
  gameStatus,
  teamScore,
  oppScore,
}: {
  kickoff?: string;
  bye?: boolean;
  gameStatus?: string;
  teamScore?: number;
  oppScore?: number;
}) {
  const { primary, secondary } = statusLines(kickoff, bye, gameStatus, teamScore, oppScore);
  return (
    <span className="mt-status-text">
      <span className="mt-status-primary">{primary}</span>
      {secondary ? <span className="mt-status-secondary">{secondary}</span> : null}
    </span>
  );
}

function StatusCell({ player }: { player: MyTeamRosterPlayer }) {
  const weather = player.weather;
  return (
    <td className="mt-status mt-col-status">
      <span className="mt-status-inner">
        <StatusText
          kickoff={player.kickoff}
          bye={player.bye}
          gameStatus={player.gameStatus}
          teamScore={player.teamScore}
          oppScore={player.oppScore}
        />
        {weather && !player.bye && (
          <span className="mt-weather" title={weather.label} aria-label={weather.label}>
            <WeatherGlyph kind={weather.kind} />
          </span>
        )}
      </span>
    </td>
  );
}

function WeekOppCells({ player }: { player: MyTeamRosterPlayer }) {
  return (
    <>
      <td className="mt-col-opp">{formatOpp(player)}</td>
      <StatusCell player={player} />
    </>
  );
}

/** Shared left column widths so QB Passing / FLEX Rushing start on the same X. */
function StatsColGroup() {
  return (
    <colgroup>
      <col className="mt-stats-col-slot" />
      <col className="mt-stats-col-player" />
      <col className="mt-stats-col-opp" />
      <col className="mt-stats-col-status" />
    </colgroup>
  );
}

/** Shared Slot→Last widths so Starters / Bench / IR columns stay on the same X. */
function LineupColGroup() {
  return (
    <colgroup>
      <col className="mt-lineup-col-slot" />
      <col className="mt-lineup-col-player" />
      <col className="mt-lineup-col-opp" />
      <col className="mt-lineup-col-status" />
      <col className="mt-lineup-col-num" />
      <col className="mt-lineup-col-num" />
      <col className="mt-lineup-col-num" />
      <col className="mt-lineup-col-num" />
      <col className="mt-lineup-col-num" />
      <col className="mt-lineup-col-num" />
      <col className="mt-lineup-col-num" />
      <col className="mt-lineup-col-num" />
    </colgroup>
  );
}

function FantasyRosterTable({
  title,
  weekLabel,
  seasonLabel,
  season,
  currentWeek,
  completedWeeks,
  platform,
  players,
  showTotals,
  onOpenBio,
  scheduleExpand,
  vsExpand,
}: {
  title: string;
  weekLabel: string;
  seasonLabel: string;
  season: number;
  currentWeek: number;
  /** Off/OL + early prior fade out by week 4 — hide BLENDED aisle after that. */
  completedWeeks: number;
  platform?: FantasyPlatform;
  players: MyTeamRosterPlayer[];
  showTotals?: boolean;
  onOpenBio: (name: string, opts?: OpenBioOpts) => void;
  /** Bumped by Lineup “Show all schedules” Apply — opens or clears all SOS strips. */
  scheduleExpand?: ScheduleExpandSignal;
  /** Bumped by “Show all VS” Apply — opens or clears VS strips (rows with matchups). */
  vsExpand?: ScheduleExpandSignal;
}) {
  const showBlendedSos = completedWeeks < 4;
  const leagueLabel = leagueSosLabel(platform);
  const [openSos, setOpenSos] = useState<Set<string>>(() => new Set());
  const [openFa, setOpenFa] = useState<Set<string>>(() => new Set());
  const [openVs, setOpenVs] = useState<Set<string>>(() => new Set());
  // Stable key signature — do not depend on `players` identity. Draft Show All
  // checkbox toggles re-render the parent with a new array every time; tying the
  // Apply effects to that array cleared open SOS/VS strips before Apply.
  const playerKeysSig = players.map((p) => `${p.espnId}-${p.lineupSlotId}`).join('|');
  const vsKeysSig = players
    .filter((p) => p.vsMatchup)
    .map((p) => `${p.espnId}-${p.lineupSlotId}`)
    .join('|');

  useEffect(() => {
    if (!scheduleExpand || scheduleExpand.tick <= 0) return;
    if (scheduleExpand.all) {
      setOpenSos(new Set(playerKeysSig ? playerKeysSig.split('|') : []));
    } else {
      setOpenSos(new Set());
    }
  }, [scheduleExpand?.tick, scheduleExpand?.all, playerKeysSig]);

  useEffect(() => {
    if (!vsExpand || vsExpand.tick <= 0) return;
    if (vsExpand.all) {
      setOpenVs(new Set(vsKeysSig ? vsKeysSig.split('|') : []));
    } else {
      setOpenVs(new Set());
    }
  }, [vsExpand?.tick, vsExpand?.all, vsKeysSig]);

  if (players.length === 0) return null;

  const totalFpts = players.reduce((s, p) => s + (p.fantasyPoints ?? 0), 0);
  const totalAvg = players.reduce((s, p) => s + (p.avgPoints ?? 0), 0);
  const totalScore = players.reduce((s, p) => s + (p.weekScore ?? 0), 0);
  const totalProj = players.reduce((s, p) => s + (p.projectedPoints ?? 0), 0);
  const hasFpts = players.some((p) => p.fantasyPoints != null);
  const hasScore = players.some((p) => p.weekScore != null);
  const hasProj = players.some((p) => p.projectedPoints != null);
  const showTotalsRow = Boolean(showTotals && (hasFpts || hasScore || hasProj));

  function rowKey(p: MyTeamRosterPlayer): string {
    return `${p.espnId}-${p.lineupSlotId}`;
  }

  /** SOS, FA, and vs can stay open together for side-by-side comparison. */
  function toggleSos(key: string) {
    setOpenSos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleFa(key: string) {
    setOpenFa((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleVs(key: string) {
    setOpenVs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mt-table-wrap">
      <table className="mt-table mt-lineup-table">
        <LineupColGroup />
        <thead>
          <tr className="mt-group-row">
            <th colSpan={2} className="mt-group-starters">
              {title}
            </th>
            <th colSpan={6} className="mt-group-week">
              {weekLabel}
            </th>
            <th colSpan={4} className="mt-group-season">
              {seasonLabel}
            </th>
          </tr>
          <tr className="mt-col-row">
            <th className="mt-col-slot">Slot</th>
            <th className="mt-col-player">Player</th>
            <th className="mt-col-opp">Opp</th>
            <th className="mt-col-status">Status</th>
            <th className="mt-num-col" title="Week projection">
              Proj
            </th>
            <th className="mt-num-col" title="Week score">
              Score
            </th>
            <th className="mt-num-col" title="Opponent rank (1 = toughest)">
              OPRK
            </th>
            <th className="mt-num-col" title="% rostered">
              %Rost
            </th>
            <th className="mt-num-col" title="Positional rank">
              PRK
            </th>
            <th className="mt-num-col" title="Season fantasy points">
              FPTS
            </th>
            <th className="mt-num-col" title="Fantasy pts / game">
              Avg
            </th>
            <th className="mt-num-col" title="Prior week fantasy points">
              Last
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, index) => {
            const key = rowKey(p);
            const empty = isEmptyLineupSlot(p);
            const sosOpen = openSos.has(key);
            const faOpen = openFa.has(key);
            const vsOpen = openVs.has(key);
            // Expand rows trail every player, so :last-child never hits this tr —
            // mark the final Bench/IR data row so its divider doesn’t double the wrap edge.
            const isTableEdgeRow =
              index === players.length - 1 && !showTotalsRow;
            if (empty) {
              return (
                <tr
                  key={key}
                  className={`mt-empty-slot${isTableEdgeRow ? ' mt-row-edge' : ''}`}
                >
                  <td className="mt-col-slot">{p.lineupSlot}</td>
                  <td className="mt-col-player">
                    <div className="mt-player">
                      <span className="mt-player-name mt-muted">Empty</span>
                    </div>
                  </td>
                  <td className="mt-col-opp mt-muted">—</td>
                  <td className="mt-status mt-col-status mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                </tr>
              );
            }
            return (
              <Fragment key={key}>
                <tr className={isTableEdgeRow ? 'mt-row-edge' : undefined}>
                  <td className="mt-col-slot">{p.lineupSlot}</td>
                  <PlayerCell
                    player={p}
                    sosOpen={sosOpen}
                    faOpen={faOpen}
                    vsOpen={vsOpen}
                    onOpenBio={onOpenBio}
                    onToggleSos={
                      p.sosSlate?.weeks?.length || p.oprkSlate?.weeks?.length
                        ? () => toggleSos(key)
                        : undefined
                    }
                    onToggleFa={() => toggleFa(key)}
                    onToggleVs={p.vsMatchup ? () => toggleVs(key) : undefined}
                  />
                  <td className="mt-col-opp">{formatOpp(p)}</td>
                  <StatusCell player={p} />
                  <td className={`mt-num${p.projectedPoints == null ? ' mt-muted' : ''}`}>
                    {dash(p.projectedPoints, 1)}
                  </td>
                  <td className={`mt-num${p.weekScore == null ? ' mt-muted' : ''}`}>
                    {dash(p.weekScore, 1)}
                  </td>
                  <td className={`mt-num mt-oprk ${oprkClass(p.oppRank)}`}>
                    {p.oppRank != null ? ordinal(p.oppRank) : '—'}
                  </td>
                  <td className="mt-num">
                    {p.percentOwned != null ? `${Math.round(p.percentOwned)}` : '—'}
                  </td>
                  <td className="mt-num">{p.posRank != null ? p.posRank : '—'}</td>
                  <td className="mt-num">{dash(p.fantasyPoints, 2)}</td>
                  <td className="mt-num">{dash(p.avgPoints, 2)}</td>
                  <td className={`mt-num${p.lastWeekPoints == null ? ' mt-muted' : ''}`}>
                    {dash(p.lastWeekPoints, 1)}
                  </td>
                </tr>
                {(p.sosSlate || p.oprkSlate) && (
                  <tr className={`mt-sos-row${sosOpen ? ' is-open' : ''}`}>
                    <td colSpan={LINEUP_COL_COUNT}>
                      <div className="mt-sos-reveal">
                        <div className="mt-sos-reveal-inner">
                          <PlayerSosWeekRow
                            currentWeek={currentWeek}
                            active={sosOpen}
                            tracks={[
                              ...(p.oprkSlate
                                ? [
                                    {
                                      id: 'espn',
                                      label: leagueLabel,
                                      labelTitle: `${leagueLabel} league OPRK (1 = toughest)`,
                                      weeks: p.oprkSlate.weeks,
                                      scale: 'oprk' as const,
                                    },
                                  ]
                                : []),
                              ...(showBlendedSos && p.sosSlate
                                ? [
                                    {
                                      id: 'blended',
                                      label: 'BLENDED',
                                      labelTitle:
                                        'Blended SOS: Source B rates soft-anchored to ESPN OPRK, plus Off/OL (1 = toughest).',
                                      // Source B is 1 = easiest; invert so both rows share OPRK style.
                                      weeks: p.sosSlate.weeks.map((w) => ({
                                        ...w,
                                        rank:
                                          w.rank == null || w.bye
                                            ? w.rank
                                            : 33 - w.rank,
                                      })),
                                      scale: 'oprk' as const,
                                    },
                                  ]
                                : []),
                              // Past week 4 with no league matrix: still show Source B alone.
                              ...(!showBlendedSos && !p.oprkSlate && p.sosSlate
                                ? [
                                    {
                                      id: 'blended',
                                      label: leagueLabel,
                                      labelTitle: `${leagueLabel} league OPRK fallback (1 = toughest)`,
                                      weeks: p.sosSlate.weeks.map((w) => ({
                                        ...w,
                                        rank:
                                          w.rank == null || w.bye
                                            ? w.rank
                                            : 33 - w.rank,
                                      })),
                                      scale: 'oprk' as const,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                <VsExpandRow
                  open={vsOpen}
                  colSpan={LINEUP_COL_COUNT}
                  currentWeek={currentWeek}
                  vsMatchup={p.vsMatchup}
                />
                <tr className={`mt-sos-row mt-fa-row${faOpen ? ' is-open' : ''}`}>
                  <td colSpan={LINEUP_COL_COUNT}>
                    <div className="mt-sos-reveal">
                      <div className="mt-sos-reveal-inner">
                        {faOpen && (
                          <LineupFaStrip
                            season={season}
                            position={faFilterFor(p)}
                            platform={platform}
                            onOpenBio={onOpenBio}
                          />
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
          {showTotalsRow && (
            <tr className="mt-totals">
              <td colSpan={2}>Totals</td>
              <td />
              <td />
              <td className={`mt-num${hasProj ? '' : ' mt-muted'}`}>
                {hasProj ? totalProj.toFixed(1) : '—'}
              </td>
              <td className={`mt-num${hasScore ? '' : ' mt-muted'}`}>
                {hasScore ? totalScore.toFixed(1) : '—'}
              </td>
              <td />
              <td />
              <td />
              <td className={`mt-num${hasFpts ? '' : ' mt-muted'}`}>
                {hasFpts ? totalFpts.toFixed(2) : '—'}
              </td>
              <td className={`mt-num${hasFpts ? '' : ' mt-muted'}`}>
                {hasFpts ? totalAvg.toFixed(2) : '—'}
              </td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function qbStats(s?: MyTeamSeasonStats) {
  return s?.kind === 'QB' ? s : undefined;
}
function flexStats(s?: MyTeamSeasonStats) {
  return s?.kind === 'FLEX' ? s : undefined;
}
function kStats(s?: MyTeamSeasonStats) {
  return s?.kind === 'K' ? s : undefined;
}
function dstStats(s?: MyTeamSeasonStats) {
  return s?.kind === 'DST' ? s : undefined;
}

function sortStatsPlayers(
  players: MyTeamRosterPlayer[],
  sort: StatsSort,
  valueOf: (p: MyTeamRosterPlayer, key: string) => number | string | undefined
): MyTeamRosterPlayer[] {
  return sortByColumn(players, sort, valueOf);
}

function SortableStatTh({
  label,
  tip,
  sortKey,
  sort,
  onSort,
  align = 'num',
  className,
}: {
  label: string;
  tip?: string;
  sortKey: string;
  sort: StatsSort;
  onSort: (key: string) => void;
  align?: 'left' | 'num';
  className?: string;
}) {
  const active = sort?.key === sortKey;
  const arrow = active ? (sort.dir === 'asc' ? '↑' : '↓') : '';
  const orderHint = ASC_FIRST_SORT_KEYS.has(sortKey)
    ? 'click for asc, again desc, again default'
    : 'click for desc, again asc, again default';
  return (
    <th
      className={`mt-sort-th${align === 'num' ? ' mt-num-col' : ''}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      title={tip}
    >
      <button
        type="button"
        className={`mt-sort${align === 'left' ? ' is-start' : ''}${active ? ' active' : ''}`}
        onClick={() => onSort(sortKey)}
        aria-label={tip ? `Sort by ${label}: ${tip}` : `Sort by ${label}`}
        title={`${tip ?? label} · ${orderHint}`}
      >
        <span>{label}</span>
        {/* Always render a glyph so the flex slot keeps width; opacity hides when idle. */}
        <span className="mt-sort-arrow" aria-hidden={!active}>
          {arrow || '↓'}
        </span>
      </button>
    </th>
  );
}

function MutedStatTh({ label, tip }: { label: string; tip: string }) {
  return (
    <th className="mt-muted" title={tip}>
      {label}
    </th>
  );
}

function useTableSort() {
  const [sort, setSort] = useState<StatsSort>(null);
  return {
    sort,
    onSort: (key: string) => setSort((prev) => cycleColumnSort(prev, key)),
  };
}

function sharedStatValue(
  p: MyTeamRosterPlayer,
  key: string
): number | string | undefined {
  if (key === 'player') return p.name.toLowerCase();
  if (key === 'slot') return p.lineupSlot.toLowerCase();
  if (key === 'rost') return p.percentOwned;
  if (key === 'fpts') return p.fantasyPoints;
  if (key === 'avg') return p.avgPoints;
  if (key === 'proj') return p.projectedPoints;
  if (key === 'score') return p.weekScore;
  if (key === 'oprk') return p.oppRank;
  if (key === 'prk') return p.posRank;
  if (key === 'last') return p.lastWeekPoints;
  return undefined;
}

function StatsQbTable({
  weekLabel,
  players,
  onOpenBio,
  currentWeek,
  completedWeeks,
  platform,
  scheduleExpand,
  vsExpand,
}: {
  weekLabel: string;
  players: MyTeamRosterPlayer[];
  onOpenBio: (name: string) => void;
  currentWeek: number;
  completedWeeks: number;
  platform?: FantasyPlatform;
  scheduleExpand?: ScheduleExpandSignal;
  vsExpand?: ScheduleExpandSignal;
}) {
  const { sort, onSort } = useTableSort();
  const rowKeys = players.map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const vsKeys = players
    .filter((p) => p.vsMatchup)
    .map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const { openSos, toggleSos } = useScheduleOpenState(rowKeys, scheduleExpand);
  const { openVs, toggleVs } = useVsOpenState(vsKeys, vsExpand);
  if (players.length === 0) return null;

  const valueOf = (p: MyTeamRosterPlayer, key: string): number | string | undefined => {
    const shared = sharedStatValue(p, key);
    if (
      shared != null ||
      key === 'player' ||
      key === 'slot' ||
      key === 'rost' ||
      key === 'fpts' ||
      key === 'avg'
    ) {
      return shared;
    }
    const s = qbStats(p.seasonStats);
    switch (key) {
      case 'cmp':
        return s?.cmp ?? s?.att;
      case 'pct':
        return s?.pct;
      case 'passYds':
        return s?.passYds;
      case 'passTd':
        return s?.passTd;
      case 'int':
        return s?.int;
      case 'fuml':
        return s?.fuml;
      case 'rushCar':
        return s?.rushCar;
      case 'rushYds':
        return s?.rushYds;
      case 'rushTd':
        return s?.rushTd;
      case 'snapPct':
        return s?.snapPct;
      case 'rate':
        return s?.passerRating;
      default:
        return undefined;
    }
  };
  const rows = sortStatsPlayers(players, sort, valueOf);
  const th = (label: string, key: string, tip: string) => (
    <SortableStatTh
      label={label}
      tip={tip}
      sortKey={key}
      sort={sort}
      onSort={onSort}
      align={key === 'player' ? 'left' : 'num'}
    />
  );

  return (
    <div className="mt-table-wrap">
      <table className="mt-table mt-stats-table">
        <StatsColGroup />
        <thead>
          <tr className="mt-group-row">
            <th colSpan={2} className="mt-group-starters">
              Quarterbacks
            </th>
            <th colSpan={2} className="mt-group-week">
              {weekLabel}
            </th>
            <th colSpan={6} className="mt-group-week">
              Passing
            </th>
            <th colSpan={3} className="mt-group-week">
              Rushing
            </th>
            <th colSpan={1} className="mt-group-week">
              Usage
            </th>
            <th colSpan={2} className="mt-group-week">
              Research
            </th>
            <th colSpan={3} className="mt-group-season">
              Season
            </th>
          </tr>
          <tr className="mt-col-row">
            <th className="mt-col-slot" title="Lineup slot">
              Slot
            </th>
            {th('Player', 'player', 'Player name')}
            <th className="mt-col-opp" title="Opponent">
              Opp
            </th>
            <th className="mt-col-status" title="Kickoff / status">
              Status
            </th>
            {th('C / A', 'cmp', 'Completions / attempts')}
            {th('PCT', 'pct', 'Completion %')}
            {th('YDS', 'passYds', 'Passing yards')}
            {th('TD', 'passTd', 'Passing TDs')}
            {th('INT', 'int', 'Interceptions')}
            {th('FUML', 'fuml', 'Fumbles lost')}
            {th('CAR', 'rushCar', 'Rush attempts')}
            {th('YDS', 'rushYds', 'Rushing yards')}
            {th('TD', 'rushTd', 'Rushing TDs')}
            {th('SNAP%', 'snapPct', 'Offense snap %')}
            {th('%Rost', 'rost', '% rostered')}
            <MutedStatTh label="+/-" tip="Roster % change" />
            {th('RATE', 'rate', 'NFL passer rating')}
            {th('TOT', 'fpts', 'Fantasy points')}
            {th('AVG', 'avg', 'Fantasy pts / game')}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const s = qbStats(p.seasonStats);
            const key = `${p.espnId}-${p.lineupSlotId}`;
            const sosOpen = openSos.has(key);
            const vsOpen = openVs.has(key);
            const canSos = Boolean(p.sosSlate?.weeks?.length || p.oprkSlate?.weeks?.length);
            return (
              <Fragment key={key}>
                <tr>
                  <td className="mt-col-slot">{p.lineupSlot}</td>
                  <PlayerCell
                    player={p}
                    onOpenBio={onOpenBio}
                    sosOpen={sosOpen}
                    vsOpen={vsOpen}
                    onToggleSos={canSos ? () => toggleSos(key) : undefined}
                    onToggleVs={p.vsMatchup ? () => toggleVs(key) : undefined}
                  />
                  <WeekOppCells player={p} />
                  <StatTd player={p} field="cmp" value={s?.cmp} digits={0}>
                    {ratio(s?.cmp, s?.att)}
                  </StatTd>
                  <StatTd player={p} field="pct" value={s?.pct} digits={1} />
                  <StatTd player={p} field="passYds" value={s?.passYds} digits={0} />
                  <StatTd player={p} field="passTd" value={s?.passTd} digits={0} />
                  <StatTd player={p} field="int" value={s?.int} digits={0} />
                  <StatTd player={p} field="fuml" value={s?.fuml} digits={0} />
                  <StatTd player={p} field="rushCar" value={s?.rushCar} digits={0} />
                  <StatTd player={p} field="rushYds" value={s?.rushYds} digits={0} />
                  <StatTd player={p} field="rushTd" value={s?.rushTd} digits={0} />
                  <StatTd player={p} field="snapPct" value={s?.snapPct} digits={1} />
                  <td className="mt-num">{p.percentOwned != null ? `${Math.round(p.percentOwned)}` : '—'}</td>
                  <td className="mt-num mt-muted">—</td>
                  <StatTd player={p} field="passerRating" value={s?.passerRating} digits={1} />
                  <StatTd player={p} field="fpts" value={p.fantasyPoints} digits={2} />
                  <StatTd player={p} field="avg" value={p.avgPoints} digits={2} />
                </tr>
                <RemainingScheduleRow
                  open={sosOpen}
                  colSpan={STATS_QB_COL_COUNT}
                  currentWeek={currentWeek}
                  completedWeeks={completedWeeks}
                  platform={platform}
                  sosSlate={p.sosSlate}
                  oprkSlate={p.oprkSlate}
                />
                <VsExpandRow
                  open={vsOpen}
                  colSpan={STATS_QB_COL_COUNT}
                  currentWeek={currentWeek}
                  vsMatchup={p.vsMatchup}
                />
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsFlexTable({
  weekLabel,
  players,
  onOpenBio,
  currentWeek,
  completedWeeks,
  platform,
  scheduleExpand,
  vsExpand,
}: {
  weekLabel: string;
  players: MyTeamRosterPlayer[];
  onOpenBio: (name: string) => void;
  currentWeek: number;
  completedWeeks: number;
  platform?: FantasyPlatform;
  scheduleExpand?: ScheduleExpandSignal;
  vsExpand?: ScheduleExpandSignal;
}) {
  const { sort, onSort } = useTableSort();
  const rowKeys = players.map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const vsKeys = players
    .filter((p) => p.vsMatchup)
    .map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const { openSos, toggleSos } = useScheduleOpenState(rowKeys, scheduleExpand);
  const { openVs, toggleVs } = useVsOpenState(vsKeys, vsExpand);
  if (players.length === 0) return null;

  const valueOf = (p: MyTeamRosterPlayer, key: string): number | string | undefined => {
    const shared = sharedStatValue(p, key);
    if (
      shared != null ||
      key === 'player' ||
      key === 'slot' ||
      key === 'rost' ||
      key === 'fpts' ||
      key === 'avg'
    ) {
      return shared;
    }
    const s = flexStats(p.seasonStats);
    switch (key) {
      case 'rushCar':
        return s?.rushCar;
      case 'rushYds':
        return s?.rushYds;
      case 'rushAvg':
        return s?.rushAvg;
      case 'rushTd':
        return s?.rushTd;
      case 'rec':
        return s?.rec;
      case 'recYds':
        return s?.recYds;
      case 'recAvg':
        return s?.recAvg;
      case 'recTd':
        return s?.recTd;
      case 'targets':
        return s?.targets;
      case 'tgtPg':
        return s?.tgtPg;
      case 'totalTd':
        return s?.totalTd;
      case 'snapPct':
        return s?.snapPct;
      case 'routePct':
        return s?.routePct;
      case 'airYards':
        return s?.airYards;
      case 'yac':
        return s?.yac;
      case 'adot':
        return s?.adot;
      case 'carryShare':
        return s?.carryShare;
      default:
        return undefined;
    }
  };
  const rows = sortStatsPlayers(players, sort, valueOf);
  const th = (label: string, key: string, tip: string) => (
    <SortableStatTh
      label={label}
      tip={tip}
      sortKey={key}
      sort={sort}
      onSort={onSort}
      align={key === 'player' ? 'left' : 'num'}
    />
  );

  return (
    <div className="mt-table-wrap">
      <table className="mt-table mt-stats-table">
        <StatsColGroup />
        <thead>
          <tr className="mt-group-row">
            <th colSpan={2} className="mt-group-starters">
              Backs and Receivers
            </th>
            <th colSpan={2} className="mt-group-week">
              {weekLabel}
            </th>
            <th colSpan={4} className="mt-group-week">
              Rushing
            </th>
            <th colSpan={7} className="mt-group-week">
              Receiving
            </th>
            <th colSpan={6} className="mt-group-week">
              Usage
            </th>
            <th colSpan={2} className="mt-group-week">
              Research
            </th>
            <th colSpan={2} className="mt-group-season">
              Fantasy Pts
            </th>
          </tr>
          <tr className="mt-col-row">
            <th className="mt-col-slot" title="Lineup slot">
              Slot
            </th>
            {th('Player', 'player', 'Player name')}
            <th className="mt-col-opp" title="Opponent">
              Opp
            </th>
            <th className="mt-col-status" title="Kickoff / status">
              Status
            </th>
            {th('CAR', 'rushCar', 'Rush attempts')}
            {th('YDS', 'rushYds', 'Rushing yards')}
            {th('AVG', 'rushAvg', 'Yards per carry')}
            {th('TD', 'rushTd', 'Rushing TDs')}
            {th('REC', 'rec', 'Receptions')}
            {th('YDS', 'recYds', 'Receiving yards')}
            {th('AVG', 'recAvg', 'Yards per reception')}
            {th('TD', 'recTd', 'Receiving TDs')}
            {th('TAR', 'targets', 'Targets')}
            {th('TAR/G', 'tgtPg', 'Targets per game')}
            {th('TOT TD', 'totalTd', 'Rush + rec TDs')}
            {th('SNAP%', 'snapPct', 'Offense snap %')}
            {th('RTE%', 'routePct', 'Routes ÷ team dropbacks')}
            {th('AIR', 'airYards', 'Air yards')}
            {th('YAC', 'yac', 'Yards after catch')}
            {th('aDOT', 'adot', 'Avg depth of target')}
            {th('CARY%', 'carryShare', 'Share of team carries')}
            {th('%Rost', 'rost', '% rostered')}
            <MutedStatTh label="+/-" tip="Roster % change" />
            {th('TOT', 'fpts', 'Fantasy points')}
            {th('AVG', 'avg', 'Fantasy pts / game')}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const s = flexStats(p.seasonStats);
            const key = `${p.espnId}-${p.lineupSlotId}`;
            const sosOpen = openSos.has(key);
            const vsOpen = openVs.has(key);
            const canSos = Boolean(p.sosSlate?.weeks?.length || p.oprkSlate?.weeks?.length);
            return (
              <Fragment key={key}>
                <tr>
                  <td className="mt-col-slot">{p.lineupSlot}</td>
                  <PlayerCell
                    player={p}
                    onOpenBio={onOpenBio}
                    sosOpen={sosOpen}
                    vsOpen={vsOpen}
                    onToggleSos={canSos ? () => toggleSos(key) : undefined}
                    onToggleVs={p.vsMatchup ? () => toggleVs(key) : undefined}
                  />
                  <WeekOppCells player={p} />
                  <StatTd player={p} field="rushCar" value={s?.rushCar} digits={0} />
                  <StatTd player={p} field="rushYds" value={s?.rushYds} digits={0} />
                  <StatTd player={p} field="rushAvg" value={s?.rushAvg} digits={1} />
                  <StatTd player={p} field="rushTd" value={s?.rushTd} digits={0} />
                  <StatTd player={p} field="rec" value={s?.rec} digits={0} />
                  <StatTd player={p} field="recYds" value={s?.recYds} digits={0} />
                  <StatTd player={p} field="recAvg" value={s?.recAvg} digits={1} />
                  <StatTd player={p} field="recTd" value={s?.recTd} digits={0} />
                  <StatTd player={p} field="targets" value={s?.targets} digits={0} />
                  <StatTd player={p} field="tgtPg" value={s?.tgtPg} digits={1} />
                  <StatTd player={p} field="totalTd" value={s?.totalTd} digits={0} />
                  <StatTd player={p} field="snapPct" value={s?.snapPct} digits={1} />
                  <StatTd player={p} field="routePct" value={s?.routePct} digits={1} muted={s?.routePct == null} />
                  <StatTd player={p} field="airYards" value={s?.airYards} digits={0} />
                  <StatTd player={p} field="yac" value={s?.yac} digits={0} />
                  <StatTd player={p} field="adot" value={s?.adot} digits={1} />
                  <StatTd player={p} field="carryShare" value={s?.carryShare} digits={1} />
                  <ResearchPtsCells player={p} />
                </tr>
                <RemainingScheduleRow
                  open={sosOpen}
                  colSpan={STATS_FLEX_COL_COUNT}
                  currentWeek={currentWeek}
                  completedWeeks={completedWeeks}
                  platform={platform}
                  sosSlate={p.sosSlate}
                  oprkSlate={p.oprkSlate}
                />
                <VsExpandRow
                  open={vsOpen}
                  colSpan={STATS_FLEX_COL_COUNT}
                  currentWeek={currentWeek}
                  vsMatchup={p.vsMatchup}
                />
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsDstTable({
  weekLabel,
  players,
  onOpenBio,
  currentWeek,
  completedWeeks,
  platform,
  scheduleExpand,
  vsExpand,
}: {
  weekLabel: string;
  players: MyTeamRosterPlayer[];
  onOpenBio: (name: string) => void;
  currentWeek: number;
  completedWeeks: number;
  platform?: FantasyPlatform;
  scheduleExpand?: ScheduleExpandSignal;
  vsExpand?: ScheduleExpandSignal;
}) {
  const { sort, onSort } = useTableSort();
  const rowKeys = players.map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const vsKeys = players
    .filter((p) => p.vsMatchup)
    .map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const { openSos, toggleSos } = useScheduleOpenState(rowKeys, scheduleExpand);
  const { openVs, toggleVs } = useVsOpenState(vsKeys, vsExpand);
  if (players.length === 0) return null;

  const valueOf = (p: MyTeamRosterPlayer, key: string): number | string | undefined => {
    const shared = sharedStatValue(p, key);
    if (
      shared != null ||
      key === 'player' ||
      key === 'slot' ||
      key === 'rost' ||
      key === 'fpts' ||
      key === 'avg'
    ) {
      return shared;
    }
    const s = dstStats(p.seasonStats);
    switch (key) {
      case 'td':
        return s?.td;
      case 'int':
        return s?.int;
      case 'fr':
        return s?.fr;
      case 'sck':
        return s?.sck;
      case 'sfty':
        return s?.sfty;
      case 'blk':
        return s?.blk;
      case 'pa':
        return s?.pa;
      case 'ya':
        return s?.ya;
      default:
        return undefined;
    }
  };
  const rows = sortStatsPlayers(players, sort, valueOf);
  const th = (label: string, key: string, tip: string) => (
    <SortableStatTh
      label={label}
      tip={tip}
      sortKey={key}
      sort={sort}
      onSort={onSort}
      align={key === 'player' ? 'left' : 'num'}
    />
  );

  return (
    <div className="mt-table-wrap">
      <table className="mt-table mt-stats-table">
        <StatsColGroup />
        <thead>
          <tr className="mt-group-row">
            <th colSpan={2} className="mt-group-starters">
              Team D/ST
            </th>
            <th colSpan={2} className="mt-group-week">
              {weekLabel}
            </th>
            <th colSpan={8} className="mt-group-week">
              Team Defense / Special Teams
            </th>
            <th colSpan={2} className="mt-group-week">
              Research
            </th>
            <th colSpan={2} className="mt-group-season">
              Fantasy Pts
            </th>
          </tr>
          <tr className="mt-col-row">
            <th className="mt-col-slot" title="Lineup slot">
              Slot
            </th>
            {th('Player', 'player', 'Player name')}
            <th className="mt-col-opp" title="Opponent">
              Opp
            </th>
            <th className="mt-col-status" title="Kickoff / status">
              Status
            </th>
            {th('TD', 'td', 'Defensive / ST TDs')}
            {th('INT', 'int', 'Interceptions')}
            {th('FR', 'fr', 'Fumble recoveries')}
            {th('SCK', 'sck', 'Sacks')}
            {th('SFTY', 'sfty', 'Safeties')}
            {th('BLK', 'blk', 'Blocked kicks')}
            {th('PA', 'pa', 'Points allowed')}
            {th('YA', 'ya', 'Yards allowed')}
            {th('%Rost', 'rost', '% rostered')}
            <MutedStatTh label="+/-" tip="Roster % change" />
            {th('TOT', 'fpts', 'Fantasy points')}
            {th('AVG', 'avg', 'Fantasy pts / game')}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const s = dstStats(p.seasonStats);
            const key = `${p.espnId}-${p.lineupSlotId}`;
            const sosOpen = openSos.has(key);
            const vsOpen = openVs.has(key);
            const canSos = Boolean(p.sosSlate?.weeks?.length || p.oprkSlate?.weeks?.length);
            return (
              <Fragment key={key}>
                <tr>
                  <td className="mt-col-slot">{p.lineupSlot}</td>
                  <PlayerCell
                    player={p}
                    onOpenBio={onOpenBio}
                    sosOpen={sosOpen}
                    vsOpen={vsOpen}
                    onToggleSos={canSos ? () => toggleSos(key) : undefined}
                    onToggleVs={p.vsMatchup ? () => toggleVs(key) : undefined}
                  />
                  <WeekOppCells player={p} />
                  <StatTd player={p} field="td" value={s?.td} digits={0} />
                  <StatTd player={p} field="int" value={s?.int} digits={0} />
                  <StatTd player={p} field="fr" value={s?.fr} digits={0} />
                  <StatTd player={p} field="sck" value={s?.sck} digits={0} />
                  <StatTd player={p} field="sfty" value={s?.sfty} digits={0} />
                  <StatTd player={p} field="blk" value={s?.blk} digits={0} />
                  <StatTd player={p} field="pa" value={s?.pa} digits={0} />
                  <StatTd player={p} field="ya" value={s?.ya} digits={0} />
                  <ResearchPtsCells player={p} />
                </tr>
                <RemainingScheduleRow
                  open={sosOpen}
                  colSpan={STATS_DST_COL_COUNT}
                  currentWeek={currentWeek}
                  completedWeeks={completedWeeks}
                  platform={platform}
                  sosSlate={p.sosSlate}
                  oprkSlate={p.oprkSlate}
                />
                <VsExpandRow
                  open={vsOpen}
                  colSpan={STATS_DST_COL_COUNT}
                  currentWeek={currentWeek}
                  vsMatchup={p.vsMatchup}
                />
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsKickerTable({
  weekLabel,
  players,
  onOpenBio,
  currentWeek,
  completedWeeks,
  platform,
  scheduleExpand,
  vsExpand,
}: {
  weekLabel: string;
  players: MyTeamRosterPlayer[];
  onOpenBio: (name: string) => void;
  currentWeek: number;
  completedWeeks: number;
  platform?: FantasyPlatform;
  scheduleExpand?: ScheduleExpandSignal;
  vsExpand?: ScheduleExpandSignal;
}) {
  const { sort, onSort } = useTableSort();
  const rowKeys = players.map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const vsKeys = players
    .filter((p) => p.vsMatchup)
    .map((p) => `${p.espnId}-${p.lineupSlotId}`);
  const { openSos, toggleSos } = useScheduleOpenState(rowKeys, scheduleExpand);
  const { openVs, toggleVs } = useVsOpenState(vsKeys, vsExpand);
  if (players.length === 0) return null;

  const valueOf = (p: MyTeamRosterPlayer, key: string): number | string | undefined => {
    const shared = sharedStatValue(p, key);
    if (
      shared != null ||
      key === 'player' ||
      key === 'slot' ||
      key === 'rost' ||
      key === 'fpts' ||
      key === 'avg'
    ) {
      return shared;
    }
    const s = kStats(p.seasonStats);
    switch (key) {
      case 'fg':
        return s?.fg ?? s?.fga;
      case 'xp':
        return s?.xp ?? s?.xpa;
      default:
        return undefined;
    }
  };
  const rows = sortStatsPlayers(players, sort, valueOf);
  const th = (label: string, key: string, tip: string) => (
    <SortableStatTh
      label={label}
      tip={tip}
      sortKey={key}
      sort={sort}
      onSort={onSort}
      align={key === 'player' ? 'left' : 'num'}
    />
  );

  return (
    <div className="mt-table-wrap">
      <table className="mt-table mt-stats-table">
        <StatsColGroup />
        <thead>
          <tr className="mt-group-row">
            <th colSpan={2} className="mt-group-starters">
              Kickers
            </th>
            <th colSpan={2} className="mt-group-week">
              {weekLabel}
            </th>
            <th colSpan={5} className="mt-group-week">
              Kicking
            </th>
            <th colSpan={2} className="mt-group-week">
              Research
            </th>
            <th colSpan={2} className="mt-group-season">
              Fantasy Pts
            </th>
          </tr>
          <tr className="mt-col-row">
            <th className="mt-col-slot" title="Lineup slot">
              Slot
            </th>
            {th('Player', 'player', 'Player name')}
            <th className="mt-col-opp" title="Opponent">
              Opp
            </th>
            <th className="mt-col-status" title="Kickoff / status">
              Status
            </th>
            <MutedStatTh label="1-39" tip="FG made 1–39" />
            <MutedStatTh label="40-49" tip="FG made 40–49" />
            <MutedStatTh label="50+" tip="FG made 50+" />
            {th('TOT', 'fg', 'FG made / attempts')}
            {th('XP', 'xp', 'XP made / attempts')}
            {th('%Rost', 'rost', '% rostered')}
            <MutedStatTh label="+/-" tip="Roster % change" />
            {th('TOT', 'fpts', 'Fantasy points')}
            {th('AVG', 'avg', 'Fantasy pts / game')}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const s = kStats(p.seasonStats);
            const key = `${p.espnId}-${p.lineupSlotId}`;
            const sosOpen = openSos.has(key);
            const vsOpen = openVs.has(key);
            const canSos = Boolean(p.sosSlate?.weeks?.length || p.oprkSlate?.weeks?.length);
            return (
              <Fragment key={key}>
                <tr>
                  <td className="mt-col-slot">{p.lineupSlot}</td>
                  <PlayerCell
                    player={p}
                    onOpenBio={onOpenBio}
                    sosOpen={sosOpen}
                    vsOpen={vsOpen}
                    onToggleSos={canSos ? () => toggleSos(key) : undefined}
                    onToggleVs={p.vsMatchup ? () => toggleVs(key) : undefined}
                  />
                  <WeekOppCells player={p} />
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num mt-muted">—</td>
                  <td className="mt-num">{ratio(s?.fg, s?.fga)}</td>
                  <td className="mt-num">{ratio(s?.xp, s?.xpa)}</td>
                  <ResearchPtsCells player={p} />
                </tr>
                <RemainingScheduleRow
                  open={sosOpen}
                  colSpan={STATS_K_COL_COUNT}
                  currentWeek={currentWeek}
                  completedWeeks={completedWeeks}
                  platform={platform}
                  sosSlate={p.sosSlate}
                  oprkSlate={p.oprkSlate}
                />
                <VsExpandRow
                  open={vsOpen}
                  colSpan={STATS_K_COL_COUNT}
                  currentWeek={currentWeek}
                  vsMatchup={p.vsMatchup}
                />
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FreeAgentsPanel({
  season,
  weekLabel,
  seasonLabel,
  onOpenBio,
  platform,
  scheduleExpand,
  vsExpand,
  showAllSchedulesDraft,
  onShowAllSchedulesDraftChange,
  showAllVsDraft,
  onShowAllVsDraftChange,
  onApplyShowAll,
}: {
  season: number;
  weekLabel: string;
  seasonLabel: string;
  onOpenBio: (name: string, opts?: OpenBioOpts) => void;
  platform?: FantasyPlatform;
  scheduleExpand?: ScheduleExpandSignal;
  vsExpand?: ScheduleExpandSignal;
  showAllSchedulesDraft: boolean;
  onShowAllSchedulesDraftChange: (next: boolean) => void;
  showAllVsDraft: boolean;
  onShowAllVsDraftChange: (next: boolean) => void;
  onApplyShowAll: () => void;
}) {
  const [pos, setPos] = useState<FreeAgentPosFilter>('ALL');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<FreeAgentsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** null = default Proj desc ordering without header/column highlight. */
  const [sort, setSort] = useState<StatsSort>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSort(null);
    // Deep enough that low-%Rost / high-Last waiver hits still appear; includeSos
    // for remaining-schedule expand on the Players tab.
    void getFreeAgents(season, { position: pos, limit: 150, includeSos: true })
      .then((view) => {
        if (cancelled) return;
        setData(view);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, pos]);

  const q = query.trim().toLowerCase();
  const filtered =
    data?.players.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.nflTeam.toLowerCase().includes(q) ||
        p.position.toLowerCase().includes(q)
      );
    }) ?? [];
  // ESPN returns %Rost order; default / cycle-off sorts by week Proj desc (no UI highlight until clicked).
  const effectiveSort: StatsSort = sort ?? { key: 'proj', dir: 'desc' };
  const rows = sortFaPlayers(filtered, effectiveSort);
  const rowKeys = rows.map((p) => String(p.espnId));
  const vsKeys = rows.filter((p) => p.vsMatchup).map((p) => String(p.espnId));
  const { openSos, toggleSos } = useScheduleOpenState(rowKeys, scheduleExpand);
  const { openVs, toggleVs } = useVsOpenState(vsKeys, vsExpand);
  const currentWeek = data?.currentWeek ?? 1;
  const completedWeeks = data?.completedWeeks ?? 0;

  function th(
    label: string,
    key: FaSortKey,
    tip: string,
    align: 'left' | 'num' = 'num',
    className?: string
  ) {
    return (
      <SortableStatTh
        label={label}
        tip={tip}
        sortKey={key}
        sort={sort}
        onSort={(k) => setSort((prev) => cycleColumnSort(prev, k))}
        align={align}
        className={className}
      />
    );
  }

  return (
    <div className="mt-fa">
      <div className="mt-fa-toolbar">
        <div className="mt-fa-pos" role="tablist" aria-label="Free agent position">
          {FA_POS_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pos === id}
              className={`mt-fa-pos-btn${pos === id ? ' is-active' : ''}`}
              onClick={() => setPos(id)}
            >
              {id === 'ALL' ? 'All' : id}
            </button>
          ))}
        </div>
        <div className="mt-fa-toolbar-right">
          <ShowAllExpandTools
            schedulesChecked={showAllSchedulesDraft}
            onSchedulesChange={onShowAllSchedulesDraftChange}
            vsChecked={showAllVsDraft}
            onVsChange={onShowAllVsDraftChange}
            onApply={onApplyShowAll}
          />
          <label className="mt-fa-search">
            <span className="visually-hidden">Search free agents</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Player name"
              autoComplete="off"
            />
          </label>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !data ? (
        <PageLoading label="Scouting the wire…" />
      ) : !loading && rows.length === 0 ? (
        <p className="subtitle">No free agents match this filter.</p>
      ) : (
        <div className="mt-table-wrap">
          <table className="mt-table mt-fa-table">
            {/*
              Group header is row 1 — without colgroup, fixed layout sizes col 1
              from the short “Players” label and crushes names.
            */}
            <colgroup>
              <col className="mt-fa-col-player" />
              <col className="mt-fa-col-type" />
              <col className="mt-fa-col-opp" />
              <col className="mt-fa-col-status" />
              {Array.from({ length: 10 }, (_, i) => (
                <col key={i} className="mt-fa-col-num" />
              ))}
            </colgroup>
            <thead>
              <tr className="mt-group-row">
                <th colSpan={1} className="mt-group-starters">
                  Players
                </th>
                <th colSpan={9} className="mt-group-week">
                  {weekLabel}
                </th>
                <th colSpan={4} className="mt-group-season">
                  {seasonLabel}
                </th>
              </tr>
              <tr className="mt-col-row">
                {th('Player', 'player', 'Player name', 'left', 'mt-col-player')}
                {th('Type', 'type', 'FA or waiver day', 'left', 'mt-col-type')}
                <th className="mt-col-opp" title="Opponent">
                  Opp
                </th>
                <th className="mt-col-status" title="Kickoff / status">
                  Status
                </th>
                {th('Proj', 'proj', 'Week projection')}
                {th('Score', 'score', 'Week score')}
                {th('OPRK', 'oprk', 'Opponent rank (1 = toughest)')}
                {th('%ST', 'started', '% started')}
                {th('%Rost', 'rost', '% rostered')}
                {th('+/-', 'delta', 'Roster % change')}
                {th('PRK', 'prk', 'Positional rank')}
                {th('FPTS', 'fpts', 'Season fantasy points')}
                {th('Avg', 'avg', 'Fantasy pts / game')}
                {th('Last', 'last', 'Prior week fantasy points')}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const key = String(p.espnId);
                return (
                  <FreeAgentRow
                    key={p.espnId}
                    player={p}
                    sort={sort}
                    faPos={pos}
                    onOpenBio={onOpenBio}
                    sosOpen={openSos.has(key)}
                    onToggleSos={
                      p.sosSlate?.weeks?.length || p.oprkSlate?.weeks?.length
                        ? () => toggleSos(key)
                        : undefined
                    }
                    vsOpen={openVs.has(key)}
                    onToggleVs={p.vsMatchup ? () => toggleVs(key) : undefined}
                    currentWeek={currentWeek}
                    completedWeeks={completedWeeks}
                    platform={platform}
                  />
                );
              })}
              {loading && data && (
                <tr>
                  <td colSpan={FA_COL_COUNT} className="mt-muted">
                    Refreshing…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FreeAgentRow({
  player: p,
  sort,
  onOpenBio,
  faPos,
  sosOpen,
  onToggleSos,
  vsOpen,
  onToggleVs,
  currentWeek,
  completedWeeks,
  platform,
}: {
  player: FreeAgentPlayer;
  sort: StatsSort;
  onOpenBio: (name: string, opts?: OpenBioOpts) => void;
  faPos: FreeAgentPosFilter;
  sosOpen?: boolean;
  onToggleSos?: () => void;
  vsOpen?: boolean;
  onToggleVs?: () => void;
  currentWeek: number;
  completedWeeks: number;
  platform?: FantasyPlatform;
}) {
  const badge = statusBadge(p.status);
  const sc = (key: string) => sortColClass(sort, key);
  const vsPos = posShortLabel(p.vsMatchup?.position ?? p.position);
  const vsOpp = p.vsMatchup?.opponent ?? p.opponent;
  return (
    <Fragment>
    <tr>
      <td className={`mt-col-player${sc('player')}`}>
        <div className="mt-player">
          <button
            type="button"
            className="mt-player-name mt-player-open"
            onClick={() =>
              onOpenBio(p.name, {
                from: 'available',
                position: faPos === 'ALL' ? faPosFromPlayer(p.position) : faPos,
                faPlayer: p,
              })
            }
          >
            {p.name}
          </button>
          {badge && (
            <span className={`status-text status-text-${badge.tone}`} title={badge.title}>
              {badge.label}
            </span>
          )}
          {onToggleSos && (
            <button
              type="button"
              className={`mt-sos-toggle${sosOpen ? ' is-open' : ''}`}
              onClick={onToggleSos}
              aria-expanded={sosOpen}
              aria-label={
                sosOpen
                  ? `Hide upcoming schedule for ${p.name}`
                  : `Show upcoming schedule for ${p.name}`
              }
              title="Upcoming Schedule"
            >
              <CalendarIcon />
            </button>
          )}
          {onToggleVs && (
            <button
              type="button"
              className={`mt-sos-toggle mt-vs-toggle${vsOpen ? ' is-open' : ''}`}
              onClick={onToggleVs}
              aria-expanded={vsOpen}
              aria-label={
                vsOpen
                  ? `Hide ${vsOpp} vs ${vsPos} matchup`
                  : `Show ${vsOpp} vs ${vsPos} matchup`
              }
              title={vsOpp ? `${vsOpp} vs ${vsPos}` : 'Opponent vs position'}
            >
              <VsIcon />
            </button>
          )}
        </div>
        <div className="mt-player-meta">
          {p.nflTeam ? `${p.nflTeam} ` : ''}
          {p.position}
        </div>
      </td>
      <td
        className={`mt-col-type${sc('type')}`}
        title={p.availability === 'WAIVERS' ? 'On waivers' : 'Free agent'}
      >
        {p.typeLabel}
      </td>
      <td className="mt-col-opp">{formatOpp(p)}</td>
      <td className="mt-status mt-col-status">
        <StatusText
          kickoff={p.kickoff}
          bye={p.bye}
          gameStatus={p.gameStatus}
          teamScore={p.teamScore}
          oppScore={p.oppScore}
        />
      </td>
      <td className={`mt-num${p.projectedPoints == null ? ' mt-muted' : ''}${sc('proj')}`}>
        {dash(p.projectedPoints, 1)}
      </td>
      <td className={`mt-num${p.weekScore == null ? ' mt-muted' : ''}${sc('score')}`}>
        {dash(p.weekScore, 1)}
      </td>
      <td className={`mt-num mt-oprk ${oprkClass(p.oppRank)}${sc('oprk')}`}>
        {p.oppRank != null ? ordinal(p.oppRank) : '—'}
      </td>
      <td className={`mt-num${p.percentStarted == null ? ' mt-muted' : ''}${sc('started')}`}>
        {p.percentStarted != null ? Math.round(p.percentStarted) : '—'}
      </td>
      <td className={`mt-num${p.percentOwned == null ? ' mt-muted' : ''}${sc('rost')}`}>
        {p.percentOwned != null ? Math.round(p.percentOwned) : '—'}
      </td>
      <td className={`mt-num ${deltaClass(p.percentChange)}${sc('delta')}`}>
        {signedDelta(p.percentChange)}
      </td>
      <td className={`mt-num${p.posRank == null ? ' mt-muted' : ''}${sc('prk')}`}>
        {p.posRank != null ? p.posRank : '—'}
      </td>
      <td className={`mt-num${p.fantasyPoints == null ? ' mt-muted' : ''}${sc('fpts')}`}>
        {dash(p.fantasyPoints, 1)}
      </td>
      <td className={`mt-num${p.avgPoints == null ? ' mt-muted' : ''}${sc('avg')}`}>
        {dash(p.avgPoints, 1)}
      </td>
      <td className={`mt-num${p.lastWeekPoints == null ? ' mt-muted' : ''}${sc('last')}`}>
        {dash(p.lastWeekPoints, 1)}
      </td>
    </tr>
    <RemainingScheduleRow
      open={Boolean(sosOpen)}
      colSpan={FA_COL_COUNT}
      currentWeek={currentWeek}
      completedWeeks={completedWeeks}
      platform={platform}
      sosSlate={p.sosSlate}
      oprkSlate={p.oprkSlate}
    />
    <VsExpandRow
      open={Boolean(vsOpen)}
      colSpan={FA_COL_COUNT}
      currentWeek={currentWeek}
      vsMatchup={p.vsMatchup}
    />
    </Fragment>
  );
}

export default function MyTeamPage() {
  const [team, setTeam] = useState<MyTeamRosterView | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<TeamView>('fantasy');
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [inspectName, setInspectName] = useState<string | null>(null);
  const [inspectArticle, setInspectArticle] = useState<string | null>(null);
  const [bioRailMode, setBioRailMode] = useState<BioRailMode>('roster');
  const [bioRailPos, setBioRailPos] = useState<FreeAgentPosFilter>('ALL');
  const [bioStripNames, setBioStripNames] = useState<string[]>([]);
  const [bioAvailablePlayers, setBioAvailablePlayers] = useState<FreeAgentPlayer[]>([]);
  const [bioSeedFa, setBioSeedFa] = useState<FreeAgentPlayer | null>(null);
  /** Bumped only by ‹ / › so the strip can nudge if the new tile is off-screen. */
  const [bioNavScrollSignal, setBioNavScrollSignal] = useState(0);
  /** Lineup / Stats position filter (View All default). */
  const [rosterFilter, setRosterFilter] = useState<RosterPosFilter>('all');
  /** Keep filtered views from shrinking so the filter menu doesn't force page scroll. */
  const rosterBodyRef = useRef<HTMLDivElement>(null);
  const rosterMinHeightRef = useRef<{ fantasy: number; stats: number }>({
    fantasy: 0,
    stats: 0,
  });
  const [rosterBodyMinHeight, setRosterBodyMinHeight] = useState(0);
  /** Per-tab: draft checkboxes; Apply opens/closes all schedule and/or VS strips. */
  const [lineupSchedDraft, setLineupSchedDraft] = useState(false);
  const [lineupVsDraft, setLineupVsDraft] = useState(false);
  const [lineupSchedExpand, setLineupSchedExpand] = useState<ScheduleExpandSignal>({
    all: false,
    tick: 0,
  });
  const [lineupVsExpand, setLineupVsExpand] = useState<ScheduleExpandSignal>({
    all: false,
    tick: 0,
  });
  const [statsSchedDraft, setStatsSchedDraft] = useState(false);
  const [statsVsDraft, setStatsVsDraft] = useState(false);
  const [statsSchedExpand, setStatsSchedExpand] = useState<ScheduleExpandSignal>({
    all: false,
    tick: 0,
  });
  const [statsVsExpand, setStatsVsExpand] = useState<ScheduleExpandSignal>({
    all: false,
    tick: 0,
  });
  const [playersSchedDraft, setPlayersSchedDraft] = useState(false);
  const [playersVsDraft, setPlayersVsDraft] = useState(false);
  const [playersSchedExpand, setPlayersSchedExpand] = useState<ScheduleExpandSignal>({
    all: false,
    tick: 0,
  });
  const [playersVsExpand, setPlayersVsExpand] = useState<ScheduleExpandSignal>({
    all: false,
    tick: 0,
  });

  function applyExpandSignal(
    draft: boolean,
    setExpand: (updater: (prev: ScheduleExpandSignal) => ScheduleExpandSignal) => void
  ) {
    setExpand((prev) => ({ all: draft, tick: prev.tick + 1 }));
  }

  function applyShowAllForTab(tab: 'fantasy' | 'stats' | 'players') {
    if (tab === 'fantasy') {
      applyExpandSignal(lineupSchedDraft, setLineupSchedExpand);
      applyExpandSignal(lineupVsDraft, setLineupVsExpand);
    } else if (tab === 'stats') {
      applyExpandSignal(statsSchedDraft, setStatsSchedExpand);
      applyExpandSignal(statsVsDraft, setStatsVsExpand);
    } else {
      applyExpandSignal(playersSchedDraft, setPlayersSchedExpand);
      applyExpandSignal(playersVsDraft, setPlayersVsExpand);
    }
  }

  const handleStripNamesChange = useCallback((names: string[]) => {
    setBioStripNames((prev) =>
      prev.length === names.length && prev.every((n, i) => n === names[i]) ? prev : names
    );
  }, []);

  const handleAvailablePlayersChange = useCallback((list: FreeAgentPlayer[]) => {
    setBioAvailablePlayers((prev) => (prev === list ? prev : list));
  }, []);

  function closeBio() {
    setInspectName(null);
    setInspectArticle(null);
    setBioSeedFa(null);
  }

  function openBio(name: string, opts?: OpenBioOpts) {
    setInspectArticle(null);
    setInspectName(name);
    const from =
      opts?.from ?? (view === 'players' ? 'available' : 'roster');
    setBioRailMode(from);
    if (from === 'available') {
      setBioRailPos(opts?.position ?? 'ALL');
      setBioSeedFa(opts?.faPlayer ?? null);
    } else {
      setBioSeedFa(null);
    }
  }

  function shiftBio(delta: number) {
    if (!inspectName) return;
    const names =
      bioStripNames.length > 0
        ? bioStripNames
        : team
          ? rosterOrder(team.players).map((p) => p.name)
          : [];
    const idx = names.indexOf(inspectName);
    if (idx < 0) return;
    const next = names[idx + delta];
    if (next) {
      openBio(next, { from: bioRailMode, position: bioRailPos });
      setBioNavScrollSignal((n) => n + 1);
    }
  }

  const rosterPlayers = useMemo(
    () => (team ? rosterOrder(team.players) : []),
    [team]
  );

  async function load() {
    setLoading(true);
    setError(null);
    setMissing(false);
    setStatsLoaded(false);
    try {
      const data = await getMyTeam();
      setTeam(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no imported team/i.test(msg) || /404/.test(msg)) {
        setMissing(true);
        setTeam(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const season = team?.season;
  useEffect(() => {
    if (view !== 'stats' || season == null || statsLoaded) return;
    let cancelled = false;
    setStatsLoading(true);
    setError(null);
    void getMyTeam(season, { stats: true })
      .then((data) => {
        if (cancelled) return;
        setTeam(data);
        setStatsLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, season, statsLoaded]);

  useLayoutEffect(() => {
    if (view !== 'fantasy' && view !== 'stats') {
      setRosterBodyMinHeight(0);
      return;
    }
    if (rosterFilter !== 'all') {
      setRosterBodyMinHeight(
        view === 'fantasy'
          ? rosterMinHeightRef.current.fantasy
          : rosterMinHeightRef.current.stats
      );
      return;
    }
    const el = rosterBodyRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (view === 'fantasy') rosterMinHeightRef.current.fantasy = h;
    else rosterMinHeightRef.current.stats = h;
    setRosterBodyMinHeight(h);
  }, [
    view,
    rosterFilter,
    team?.players,
    statsLoaded,
    lineupSchedExpand,
    lineupVsExpand,
    statsSchedExpand,
    statsVsExpand,
  ]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const data = await refreshEspnTeam({ season: team?.season });
      setTeam(data);
      setMissing(false);
      setStatsLoaded(false);
      if (view === 'stats') {
        const withStats = await getMyTeam(data.season, { stats: true });
        setTeam(withStats);
        setStatsLoaded(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <PageLoading label="Checking the locker room…" />;

  if (missing || !team) {
    return (
      <section className="panel">
        <PageTitle>My Team</PageTitle>
        <p className="subtitle">
          No league roster yet. Connect your ESPN league under Import → Import League.
        </p>
        {error && <p className="error">{error}</p>}
        <Link to="/import#import-league" className="button">
          Import League
        </Link>
      </section>
    );
  }

  const starters = filterRosterPlayers(
    padStarterSlots(team.players),
    rosterFilter
  );
  const bench = filterRosterPlayers(
    sectionPlayers(team.players, BENCH_SLOTS),
    rosterFilter
  );
  const ir = filterRosterPlayers(sectionPlayers(team.players, IR_SLOTS), rosterFilter);
  const weekLabel = `NFL Week ${team.currentWeek}`;
  const seasonLabel = `${team.season} Season`;
  const qbs = filterRosterPlayers(byPositions(team.players, ['QB']), rosterFilter);
  const flex = filterRosterPlayers(
    byPositions(team.players, ['RB', 'WR', 'TE']),
    rosterFilter
  );
  const dst = filterRosterPlayers(byPositions(team.players, ['D/ST']), rosterFilter);
  const kickers = filterRosterPlayers(byPositions(team.players, ['K']), rosterFilter);

  return (
    <section className="panel mt-page">
      <div className="panel-header">
        <div>
          <PageTitle className="mt-team-name">{team.teamName}</PageTitle>
          <p className="subtitle">
            {team.season} · League {team.leagueId} · Week {team.currentWeek}
            · Synced {formatWhen(team.refreshedAt)}
          </p>
        </div>
        <div className="my-team-actions">
          <button
            type="button"
            className="button"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Sync roster'}
          </button>
          <Link to="/import#import-league" className="button secondary">
            Update connection
          </Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="mt-roster">
        <div className="mt-view-pills-row">
          <div className="mt-view-pills" role="tablist" aria-label="My Team view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'fantasy'}
              className={`page-tab${view === 'fantasy' ? ' active' : ''}`}
              onClick={() => setView('fantasy')}
            >
              Lineup
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'stats'}
              className={`page-tab${view === 'stats' ? ' active' : ''}`}
              onClick={() => setView('stats')}
            >
              Stats
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'players'}
              className={`page-tab${view === 'players' ? ' active' : ''}`}
              onClick={() => setView('players')}
            >
              Players
            </button>
          </div>
          {(view === 'fantasy' || view === 'stats') && (
            <ShowAllExpandTools
              schedulesChecked={view === 'fantasy' ? lineupSchedDraft : statsSchedDraft}
              onSchedulesChange={
                view === 'fantasy' ? setLineupSchedDraft : setStatsSchedDraft
              }
              vsChecked={view === 'fantasy' ? lineupVsDraft : statsVsDraft}
              onVsChange={view === 'fantasy' ? setLineupVsDraft : setStatsVsDraft}
              onApply={() => applyShowAllForTab(view)}
              rosterFilter={rosterFilter}
              onRosterFilterChange={setRosterFilter}
            />
          )}
        </div>

        {view === 'players' ? (
          <FreeAgentsPanel
            season={team.season}
            weekLabel={weekLabel}
            seasonLabel={seasonLabel}
            onOpenBio={openBio}
            platform={team.platform}
            scheduleExpand={playersSchedExpand}
            vsExpand={playersVsExpand}
            showAllSchedulesDraft={playersSchedDraft}
            onShowAllSchedulesDraftChange={setPlayersSchedDraft}
            showAllVsDraft={playersVsDraft}
            onShowAllVsDraftChange={setPlayersVsDraft}
            onApplyShowAll={() => applyShowAllForTab('players')}
          />
        ) : view === 'fantasy' ? (
          <div
            ref={rosterBodyRef}
            className="mt-roster-body"
            style={
              rosterBodyMinHeight > 0
                ? { minHeight: rosterBodyMinHeight }
                : undefined
            }
          >
            <FantasyRosterTable
              title="Starters"
              weekLabel={weekLabel}
              seasonLabel={seasonLabel}
              season={team.season}
              currentWeek={team.currentWeek}
              completedWeeks={team.completedWeeks}
              platform={team.platform}
              players={starters}
              showTotals
              onOpenBio={openBio}
              scheduleExpand={lineupSchedExpand}
              vsExpand={lineupVsExpand}
            />
            <FantasyRosterTable
              title="Bench"
              weekLabel={weekLabel}
              seasonLabel={seasonLabel}
              season={team.season}
              currentWeek={team.currentWeek}
              completedWeeks={team.completedWeeks}
              platform={team.platform}
              players={bench}
              onOpenBio={openBio}
              scheduleExpand={lineupSchedExpand}
              vsExpand={lineupVsExpand}
            />
            <FantasyRosterTable
              title="IR"
              weekLabel={weekLabel}
              seasonLabel={seasonLabel}
              season={team.season}
              currentWeek={team.currentWeek}
              completedWeeks={team.completedWeeks}
              platform={team.platform}
              players={ir}
              onOpenBio={openBio}
              scheduleExpand={lineupSchedExpand}
              vsExpand={lineupVsExpand}
            />
          </div>
        ) : statsLoading && !statsLoaded ? (
          <PageLoading label="Pulling the box score…" />
        ) : (
          <div
            ref={rosterBodyRef}
            className="mt-roster-body"
            style={
              rosterBodyMinHeight > 0
                ? { minHeight: rosterBodyMinHeight }
                : undefined
            }
          >
            <StatsQbTable
              weekLabel={weekLabel}
              players={qbs}
              onOpenBio={openBio}
              currentWeek={team.currentWeek}
              completedWeeks={team.completedWeeks}
              platform={team.platform}
              scheduleExpand={statsSchedExpand}
              vsExpand={statsVsExpand}
            />
            <StatsFlexTable
              weekLabel={weekLabel}
              players={flex}
              onOpenBio={openBio}
              currentWeek={team.currentWeek}
              completedWeeks={team.completedWeeks}
              platform={team.platform}
              scheduleExpand={statsSchedExpand}
              vsExpand={statsVsExpand}
            />
            <StatsDstTable
              weekLabel={weekLabel}
              players={dst}
              onOpenBio={openBio}
              currentWeek={team.currentWeek}
              completedWeeks={team.completedWeeks}
              platform={team.platform}
              scheduleExpand={statsSchedExpand}
              vsExpand={statsVsExpand}
            />
            <StatsKickerTable
              weekLabel={weekLabel}
              players={kickers}
              onOpenBio={openBio}
              currentWeek={team.currentWeek}
              completedWeeks={team.completedWeeks}
              platform={team.platform}
              scheduleExpand={statsSchedExpand}
              vsExpand={statsVsExpand}
            />
          </div>
        )}
      </div>

      {inspectName && (() => {
        const stripNames =
          bioStripNames.length > 0
            ? bioStripNames
            : rosterPlayers.map((p) => p.name);
        const stripIdx = stripNames.indexOf(inspectName);
        const onStrip = stripIdx >= 0;
        const inspectRoster = team?.players.find((p) => p.name === inspectName);
        const inspectFa = bioAvailablePlayers.find((p) => p.name === inspectName);
        return (
          <div
            className="dialog-backdrop"
            onClick={closeBio}
            role="presentation"
          >
            <div
              className="mt-player-bio-shell"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mt-player-bio-row">
                <button
                  type="button"
                  className="mt-player-bio-nav"
                  onClick={() => shiftBio(-1)}
                  disabled={!onStrip || stripIdx <= 0}
                  aria-label="Previous player"
                >
                  ‹
                </button>
                <div
                  className="dialog mt-player-bio"
                  role="dialog"
                  aria-modal="true"
                  aria-label={`${inspectName} player bio`}
                >
                  <BioPlayerLoadProvider name={inspectName}>
                    <PlayerCompareDialog
                      solo
                      variant="roster"
                      leftName={inspectName}
                      onClose={closeBio}
                      ratingsPlatform={team?.platform ?? 'espn'}
                      currentWeek={team?.currentWeek}
                      weekProjectedPoints={
                        inspectRoster?.projectedPoints ?? inspectFa?.projectedPoints
                      }
                      playerPosition={inspectRoster?.position ?? inspectFa?.position}
                      playerStatus={inspectRoster?.status ?? inspectFa?.status}
                      rosterStatusByName={Object.fromEntries(
                        (team?.players ?? []).map((p) => [p.name, p.status])
                      )}
                      availabilitySeason={team?.season}
                      onSelectPlayer={(name) => {
                        // Depth-chart mates may be outside the top-80 Available
                        // page — seed them so the strip keeps the selection
                        // instead of snapping to the first WR by proj.
                        const knownFa = bioAvailablePlayers.find((p) => p.name === name);
                        const rosterHit = team?.players.find((p) => p.name === name);
                        const pos =
                          knownFa?.position ??
                          rosterHit?.position ??
                          inspectFa?.position ??
                          inspectRoster?.position;
                        const faPlayer =
                          bioRailMode === 'available'
                            ? knownFa ??
                              (pos
                                ? {
                                    espnId: rosterHit?.espnId ?? knownFa?.espnId ?? 0,
                                    name,
                                    nflTeam:
                                      rosterHit?.nflTeam ??
                                      knownFa?.nflTeam ??
                                      '',
                                    position: pos,
                                    status: rosterHit?.status ?? knownFa?.status,
                                    availability: 'FREEAGENT' as const,
                                    typeLabel: 'FA',
                                    projectedPoints:
                                      rosterHit?.projectedPoints ??
                                      knownFa?.projectedPoints,
                                  }
                                : undefined)
                            : undefined;
                        openBio(name, {
                          from: bioRailMode,
                          position: bioRailPos,
                          faPlayer,
                        });
                      }}
                      news={
                        <PlayerNews
                          name={inspectName}
                          articleUrl={inspectArticle}
                          onOpenArticle={(item) => setInspectArticle(item.url)}
                          onBackToResults={() => setInspectArticle(null)}
                        />
                      }
                    />
                    <BioPlayerLoadOverlay />
                  </BioPlayerLoadProvider>
                </div>
                <div className="mt-player-bio-actions">
                  <button
                    type="button"
                    className="mt-player-bio-nav"
                    onClick={() => shiftBio(1)}
                    disabled={!onStrip || stripIdx >= stripNames.length - 1}
                    aria-label="Next player"
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    className="mt-player-bio-close"
                    onClick={closeBio}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>
              <BioRosterRail
                players={rosterPlayers}
                activeName={inspectName}
                onSelect={(name) =>
                  openBio(name, {
                    from: bioRailMode,
                    position: bioRailPos,
                    faPlayer:
                      bioRailMode === 'available'
                        ? bioAvailablePlayers.find((p) => p.name === name) ??
                          (bioSeedFa?.name === name ? bioSeedFa : null)
                        : null,
                  })
                }
                mode={bioRailMode}
                onModeChange={setBioRailMode}
                availablePos={bioRailPos}
                onAvailablePosChange={(pos) => {
                  setBioRailPos(pos);
                  // Drop ALL/other-pos seed so a TE doesn’t stay pinned in a WR strip.
                  setBioSeedFa(null);
                }}
                season={team?.season}
                currentWeek={team?.currentWeek}
                seedAvailable={bioSeedFa}
                onStripNamesChange={handleStripNamesChange}
                onAvailablePlayersChange={handleAvailablePlayersChange}
                navScrollSignal={bioNavScrollSignal}
              />
            </div>
          </div>
        );
      })()}
    </section>
  );
}
