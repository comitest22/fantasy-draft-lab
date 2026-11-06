import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { getPlayerGameLog, getSosBoard } from '../services/api';
import type {
  PlayerGameLog as GameLog,
  PlayerGameLogColumn,
  PlayerSosWeek,
  Position,
  SosBoard,
} from '../types';
import { rankHeat } from '../utils/heatScale';
import {
  buildOprkWindowRanks,
  buildWindowRosRanks,
  clampWeekRange,
  type SosChartPos,
} from '../utils/sosWindow';
import { useBioPlayerLoad } from './BioPlayerLoadGate';

type LogMode = 'receiving' | 'rushing' | 'passing';

function fmtCell(key: string, value: number | null | undefined, bye: boolean): string {
  if (bye || value == null) return '—';
  if (key === 'rushAvg' || key === 'recAvg' || key === 'fpts') return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function rosQuality(rank: number): string {
  if (rank <= 8) return 'Favorable';
  if (rank <= 16) return 'Slightly favorable';
  if (rank <= 24) return 'Average';
  return 'Tough';
}

function chartPosFor(position: Position): SosChartPos {
  if (position === 'QB') return 'qb';
  if (position === 'RB') return 'rb';
  if (position === 'WR') return 'wr';
  if (position === 'TE') return 'te';
  if (position === 'D/ST') return 'dst';
  return 'overall';
}

function defaultMode(position: Position | undefined): LogMode {
  if (position === 'QB') return 'passing';
  if (position === 'RB') return 'rushing';
  return 'receiving';
}

function modeOptions(position: Position | undefined): Array<{ id: LogMode; label: string }> | null {
  if (!position || position === 'K' || position === 'D/ST') return null;
  if (position === 'QB') {
    return [
      { id: 'passing', label: 'Passing' },
      { id: 'rushing', label: 'Rushing' },
    ];
  }
  return [
    { id: 'receiving', label: 'Receiving' },
    { id: 'rushing', label: 'Rushing' },
  ];
}

function columnsForMode(columns: PlayerGameLogColumn[], mode: LogMode): PlayerGameLogColumn[] {
  const grouped = columns.some((col) => col.group);
  if (!grouped) return columns;
  return columns.filter((col) => col.group === mode || col.group === 'common');
}

/** Header labels while the log is loading (mirrors server column sets). */
function loadingColumnLabels(position: Position | undefined, mode: LogMode): string[] {
  if (position === 'K') return ['FG', 'FGA', 'XP', 'FPTS'];
  if (position === 'D/ST') return ['TD', 'INT', 'FR', 'SCK', 'SFTY', 'BLK', 'PA', 'YA', 'FPTS'];
  if (position === 'QB' && mode === 'passing') {
    return ['CMP', 'ATT', 'YDS', 'TD', 'INT', 'FPTS'];
  }
  if (mode === 'rushing') {
    return position === 'QB'
      ? ['CAR', 'YDS', 'TD', 'FPTS']
      : ['CAR', 'YDS', 'AVG', 'TD', 'FPTS'];
  }
  return ['TGT', 'REC', 'YDS', 'AVG', 'TD', 'FPTS'];
}

const SOS_LOADING_WEEKS = 18;

function invertRank(rank: number, teams = 32): number {
  return teams + 1 - rank;
}

function SosWeekCell({
  cell,
  scale,
}: {
  cell: PlayerSosWeek;
  /** `oprk` = ESPN 1 toughest (same as lineup strip); `easiest` = Source B. */
  scale: 'easiest' | 'oprk';
}) {
  if (cell.bye || !cell.opponent) {
    return <span className="sos-match bye">BYE</span>;
  }
  const label = cell.home === false ? `@${cell.opponent}` : cell.opponent;
  const oprkStyle = scale === 'oprk';
  // Heat always easiest-first (green = soft). OPRK ranks are 1 = toughest.
  const heatRank =
    cell.rank == null ? undefined : oprkStyle ? invertRank(cell.rank) : cell.rank;
  return (
    <span
      className="sos-match"
      style={rankHeat(heatRank)}
      title={
        cell.rank != null
          ? oprkStyle
            ? `${label} · ESPN OPRK ${cell.rank} (1 toughest, 32 easiest)`
            : `${label} · matchup ${cell.rank} (1 easiest, 32 toughest)`
          : label
      }
    >
      <span className="sos-match-opp">{label}</span>
      <span className="sos-match-n">{cell.rank ?? '—'}</span>
    </span>
  );
}

/** Hold the stacked (non-gated) loading panel briefly so first paint isn’t a flash. */
const ROSTER_LOG_MIN_LOAD_MS = 1000;

export default function PlayerGameLog({
  name,
  layout = 'stacked',
  position: positionHint,
}: {
  name: string;
  /** `roster` uses display:contents so SOS / log can sit in a parent grid. */
  layout?: 'stacked' | 'roster';
  /** Optional position hint so mode pills can render before the log loads. */
  position?: Position;
}) {
  const gate = useBioPlayerLoad();
  const gated = gate != null;
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [logOwn, setLogOwn] = useState<GameLog | null>(null);
  const [errorOwn, setErrorOwn] = useState<string | null>(null);
  const [loadingOwn, setLoadingOwn] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<LogMode>('receiving');
  const [weekFromDraft, setWeekFromDraft] = useState('1');
  const [weekToDraft, setWeekToDraft] = useState('18');
  const [weekFrom, setWeekFrom] = useState(1);
  const [weekTo, setWeekTo] = useState(18);
  const [showRemaining, setShowRemaining] = useState(false);
  const [rangePending, setRangePending] = useState(false);
  const [sosBoard, setSosBoard] = useState<SosBoard | null>(null);
  const savedWeekRange = useRef({ from: 1, to: 18 });
  const logScrollerRef = useRef<HTMLDivElement>(null);
  const focusWeekRowRef = useRef<HTMLTableRowElement>(null);
  /** Only auto-scroll to currentWeek+1 once per player/season open. */
  const didFocusWeekRef = useRef(false);

  /** Gate owns the default-season fetch; season dropdown still loads locally. */
  const gatedDefault = gated && season === undefined;
  const log = gatedDefault ? gate.log : logOwn;
  const error = gatedDefault ? gate.logError : errorOwn;
  const loading = gatedDefault ? gate.loading : loadingOwn;

  useEffect(() => {
    setSeason(undefined);
    setShowRemaining(false);
    setRangePending(false);
    setWeekFromDraft('1');
    setWeekToDraft('18');
    setWeekFrom(1);
    setWeekTo(18);
    setExpanded(true);
    savedWeekRange.current = { from: 1, to: 18 };
    didFocusWeekRef.current = false;
    if (gated) {
      setLogOwn(null);
      setErrorOwn(null);
      setLoadingOwn(false);
    }
  }, [name, gated]);

  useEffect(() => {
    let cancelled = false;
    getSosBoard()
      .then((board) => {
        if (!cancelled) setSosBoard(board);
      })
      .catch(() => {
        if (!cancelled) setSosBoard(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Default season under the bio load gate — parent reveals log atomically.
    if (gated && season === undefined) return;

    let cancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const minHoldMs = layout === 'roster' && logOwn == null ? ROSTER_LOG_MIN_LOAD_MS : 0;
    setLoadingOwn(true);
    setErrorOwn(null);
    setLogOwn(null);
    setExpanded(true);

    function reveal(run: () => void) {
      const wait = Math.max(0, minHoldMs - (Date.now() - started));
      settleTimer = setTimeout(() => {
        if (cancelled) return;
        run();
        setLoadingOwn(false);
      }, wait);
    }

    getPlayerGameLog(name, season)
      .then((data) => {
        if (cancelled) return;
        reveal(() => {
          setLogOwn(data.log);
          if (data.log.seasons?.length) setSeasons(data.log.seasons);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        reveal(() => {
          setLogOwn(null);
          setErrorOwn(err instanceof Error ? err.message : 'Game log unavailable.');
        });
      });
    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- logOwn only gates min-hold
  }, [name, season, layout, gated]);

  useEffect(() => {
    if (gate?.log?.seasons?.length) setSeasons(gate.log.seasons);
  }, [gate?.log]);

  useEffect(() => {
    didFocusWeekRef.current = false;
  }, [season]);

  useEffect(() => {
    if (log?.position) setMode(defaultMode(log.position));
  }, [name, log?.position]);

  const yearOptions = useMemo(() => {
    if (seasons.length > 0) return seasons;
    if (log?.season != null) return [log.season];
    return [];
  }, [seasons, log?.season]);

  const pills = modeOptions(log?.position ?? positionHint);
  const pillsReady = log != null;
  const columns = useMemo(
    () => (log ? columnsForMode(log.columns, mode) : []),
    [log, mode]
  );
  const preview = log?.previewRows ?? 8;
  const rows = log ? (expanded ? log.rows : log.rows.slice(0, preview)) : [];
  const canToggle = (log?.rows.length ?? 0) > preview;
  // Prefer ESPN OPRK (same numbers as My Team lineup strip) when present.
  const sosScale: 'easiest' | 'oprk' = log?.oprkSlate?.weeks?.length ? 'oprk' : 'easiest';
  const slate = sosScale === 'oprk' ? log?.oprkSlate : log?.sosSlate;
  const weekMax = useMemo(() => {
    const weeks = slate?.weeks ?? [];
    if (weeks.length === 0) return 18;
    return Math.max(18, ...weeks.map((week) => week.week));
  }, [slate]);
  const currentWeek = Math.min(weekMax, Math.max(1, slate?.currentWeek ?? 1));
  /** Newest year in the dropdown is the live draft season. */
  const isLiveSeasonLog =
    log != null &&
    yearOptions.length > 0 &&
    log.season === yearOptions[0] &&
    (season == null || season === log.season);
  const focusWeek = isLiveSeasonLog ? Math.min(weekMax, currentWeek + 1) : null;

  useLayoutEffect(() => {
    if (loading || !focusWeek || didFocusWeekRef.current) return;
    const row = focusWeekRowRef.current;
    const scroller = logScrollerRef.current;
    if (!row || !scroller) return;
    // Pin currentWeek+1 at the bottom of the scroller (recent weeks above).
    // Prefer scrollTop over scrollIntoView so the bio modal itself doesn’t jump.
    const delta =
      row.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
    didFocusWeekRef.current = true;
  }, [loading, focusWeek, rows.length, expanded, mode, name]);

  function setWeekWindow(from: number, to: number, remaining = false) {
    setWeekFrom(from);
    setWeekTo(to);
    setWeekFromDraft(String(from));
    setWeekToDraft(String(to));
    setShowRemaining(remaining);
  }

  useEffect(() => {
    if (!slate?.weeks.length) return;
    setWeekWindow(1, weekMax, false);
    setRangePending(false);
    savedWeekRange.current = { from: 1, to: weekMax };
  }, [name, slate?.team, weekMax]);

  const shownWeeks = useMemo(() => {
    if (!slate) return [];
    return slate.weeks.filter((week) => week.week >= weekFrom && week.week <= weekTo);
  }, [slate, weekFrom, weekTo]);

  const isRemainingWindow = weekFrom === currentWeek && weekTo === weekMax;
  const isFullSeason = weekFrom === 1 && weekTo === weekMax;
  const isCustom = !isFullSeason && !isRemainingWindow;

  const windowRank = useMemo(() => {
    if (!slate || !sosBoard || !isCustom) return undefined;
    const weeks = Array.from({ length: weekTo - weekFrom + 1 }, (_, i) => weekFrom + i);
    if (sosScale === 'oprk') {
      const byOpp = slate.oprkByOpponent;
      if (!byOpp) return undefined;
      return buildOprkWindowRanks(sosBoard.teams, weeks, byOpp).get(slate.team);
    }
    return buildWindowRosRanks(sosBoard.teams, weeks, chartPosFor(slate.position)).get(
      slate.team
    );
  }, [slate, sosBoard, isCustom, weekFrom, weekTo, sosScale]);

  const sosSummary = useMemo(() => {
    if (!slate) return null;
    if (!isCustom) {
      if (slate.rank == null) return { kind: 'plain' as const, text: 'ROS' };
      return {
        kind: 'ranked' as const,
        prefix: 'ROS',
        rank: slate.rank,
        quality: rosQuality(slate.rank),
      };
    }
    const range = `W${weekFrom} - W${weekTo}`;
    if (windowRank == null) {
      return { kind: 'ranged' as const, range, prefix: 'SOS' };
    }
    return {
      kind: 'ranged-ranked' as const,
      range,
      prefix: 'SOS',
      rank: windowRank,
      quality: rosQuality(windowRank),
    };
  }, [slate, isCustom, weekFrom, weekTo, windowRank]);

  function applyWeekRange(e: FormEvent) {
    e.preventDefault();
    if (showRemaining || !rangePending) return;
    const next = clampWeekRange(weekFromDraft, weekToDraft, weekMax);
    const remaining = next.from === currentWeek && next.to === weekMax;
    setWeekWindow(next.from, next.to, remaining);
    setRangePending(false);
  }

  function onShowRemaining(checked: boolean) {
    if (checked) {
      savedWeekRange.current = { from: weekFrom, to: weekTo };
      setWeekWindow(currentWeek, weekMax, true);
      setRangePending(false);
      return;
    }
    const { from, to } = savedWeekRange.current;
    setWeekWindow(from, to, false);
    setRangePending(false);
  }

  function onWeekDraftChange(which: 'from' | 'to', value: string) {
    if (which === 'from') setWeekFromDraft(value);
    else setWeekToDraft(value);
    if (showRemaining) setShowRemaining(false);
    setRangePending(true);
  }

  const canApply = !showRemaining && rangePending;
  const roster = layout === 'roster';
  /** Roster loading: enough rows to fill the log panel like a typical expanded slate. */
  const skeletonRowCount = roster ? 8 : 4;
  const hasSos = Boolean(slate && slate.weeks.length > 0);
  /** Skeleton SOS only when we have nothing to show yet (first open). */
  const showSosLoading = roster && loading && !hasSos;
  const showLogSkeleton = loading && !log;
  const showLog = Boolean(log && !error && log.rows.length > 0);
  const loadingHeaders =
    columns.length > 0
      ? columns.map((col) => col.label)
      : loadingColumnLabels(log?.position ?? positionHint, mode);

  return (
    <aside
      className={`player-gamelog${roster ? ' player-gamelog-roster' : ''}`}
      aria-label={`${name} game log`}
    >
      {showSosLoading && (
        <div className="player-sos player-sos-loading" aria-busy="true">
          <div className="player-sos-head">
            <form className="sos-week-range" onSubmit={(e) => e.preventDefault()}>
              <span>Week</span>
              <input
                type="number"
                inputMode="numeric"
                value="1"
                onChange={() => undefined}
                disabled
                aria-label="From week"
              />
              <span>to</span>
              <input
                type="number"
                inputMode="numeric"
                value="18"
                onChange={() => undefined}
                disabled
                aria-label="To week"
              />
              <button type="submit" disabled>
                Apply
              </button>
              <label className="sos-week-remaining is-disabled">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => undefined}
                  disabled
                />
                Remaining Schedule
              </label>
            </form>
            <span className="player-sos-ros" title="Remaining-slate SOS">
              ROS —
            </span>
          </div>
          <div className="player-sos-scroller">
            <div className="player-sos-row is-full-strip" aria-hidden>
              {Array.from({ length: SOS_LOADING_WEEKS }, (_, i) => (
                <div key={i + 1} className="player-sos-week">
                  <span className="player-sos-week-n">{i + 1}</span>
                  <span className="sos-match player-sos-match-skeleton" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {hasSos && slate && (
        <div className="player-sos">
          <div className="player-sos-head">
            <form className="sos-week-range" onSubmit={applyWeekRange}>
              <span>Week</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={weekMax}
                value={weekFromDraft}
                onChange={(e) => onWeekDraftChange('from', e.target.value)}
                aria-label="From week"
              />
              <span>to</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={weekMax}
                value={weekToDraft}
                onChange={(e) => onWeekDraftChange('to', e.target.value)}
                aria-label="To week"
              />
              <button type="submit" disabled={!canApply}>
                Apply
              </button>
              <label className="sos-week-remaining">
                <input
                  type="checkbox"
                  checked={showRemaining}
                  onChange={(e) => onShowRemaining(e.target.checked)}
                />
                Remaining Schedule
              </label>
            </form>
            <span
              className="player-sos-ros"
              title={
                isCustom
                  ? sosScale === 'oprk'
                    ? 'Rank for the applied weeks only (avg ESPN OPRK, 1 = easiest) — not rest-of-season'
                    : 'Matchup rank for the applied weeks only (avg weekly cells, 1 = easiest) — not rest-of-season'
                  : sosScale === 'oprk'
                    ? 'Remaining-slate rank from ESPN OPRK averages (1 = easiest) — same week cells as My Team lineup'
                    : 'Remaining-slate SOS from the current week through the end of the season (1 = easiest)'
              }
            >
              {sosSummary?.kind === 'plain' && sosSummary.text}
              {sosSummary?.kind === 'ranked' && (
                <span className="player-sos-ros-body">
                  {sosSummary.prefix} #{sosSummary.rank}
                  <span className="player-sos-ros-quality" style={rankHeat(sosSummary.rank)}>
                    {sosSummary.quality}
                  </span>
                </span>
              )}
              {sosSummary?.kind === 'ranged' && (
                <>
                  <span className="player-sos-ros-range">{sosSummary.range}</span>
                  <span className="player-sos-ros-body">{sosSummary.prefix}</span>
                </>
              )}
              {sosSummary?.kind === 'ranged-ranked' && (
                <>
                  <span className="player-sos-ros-range">{sosSummary.range}</span>
                  <span className="player-sos-ros-body">
                    {sosSummary.prefix} #{sosSummary.rank}
                    <span className="player-sos-ros-quality" style={rankHeat(sosSummary.rank)}>
                      {sosSummary.quality}
                    </span>
                  </span>
                </>
              )}
            </span>
          </div>
          {shownWeeks.length === 0 ? (
            <p className="player-gamelog-empty">No weeks in that range.</p>
          ) : (
            <div className="player-sos-scroller">
              <div
                className={`player-sos-row${
                  roster && shownWeeks.length >= weekMax ? ' is-full-strip' : ''
                }`}
              >
                {shownWeeks.map((week) => (
                  <div key={week.week} className="player-sos-week">
                    <span
                      className={`player-sos-week-n${week.week === currentWeek ? ' is-current' : ''}`}
                      title={week.week === currentWeek ? `Current week ${week.week}` : undefined}
                    >
                      {week.week}
                    </span>
                    <SosWeekCell cell={week} scale={sosScale} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="player-gamelog-body">
        <div className="player-gamelog-head">
          <div className="player-gamelog-title">
            <h3>Game Log</h3>
            {pills && (
              <div className="player-gamelog-pills" role="tablist" aria-label="Game log stats">
                {pills.map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    role="tab"
                    aria-selected={pillsReady && mode === pill.id}
                    className={`player-gamelog-pill${pillsReady && mode === pill.id ? ' active' : ''}`}
                    onClick={() => setMode(pill.id)}
                    disabled={!pillsReady}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="player-gamelog-year">
            <span className="visually-hidden">Season</span>
            <select
              value={
                yearOptions.length > 0
                  ? (season ?? log?.season ?? yearOptions[0])
                  : ''
              }
              onChange={(e) => setSeason(Number(e.target.value))}
              aria-label="Game log season"
              disabled={loading || yearOptions.length === 0}
            >
              {yearOptions.length === 0 ? (
                <option value="">—</option>
              ) : (
                yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
        <div className="player-gamelog-swap">
          {showLogSkeleton && (
            <div className="player-gamelog-scroller is-loading" aria-busy="true">
              <table className="player-gamelog-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Opp</th>
                    {loadingHeaders.map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody aria-hidden>
                  {Array.from({ length: skeletonRowCount }, (_, i) => (
                    <tr key={i} className="player-gamelog-skeleton-row">
                      <td>{i + 1}</td>
                      <td>—</td>
                      {loadingHeaders.map((label) => (
                        <td key={label}>—</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="player-gamelog-loading-overlay" aria-live="polite">
                Loading game log…
              </div>
            </div>
          )}
          {!showLogSkeleton && error && <p className="player-gamelog-empty">{error}</p>}
          {!showLogSkeleton && !error && log?.note && log.rows.length === 0 && (
            <p className="player-gamelog-empty">{log.note}</p>
          )}
          {showLog && (
            <div ref={logScrollerRef} className="player-gamelog-scroller">
              <table className="player-gamelog-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Opp</th>
                    {columns.map((col) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.week}-${row.opp}`}
                      ref={focusWeek != null && row.week === focusWeek ? focusWeekRowRef : undefined}
                      className={row.bye ? 'is-bye' : undefined}
                      data-week={row.week}
                    >
                      <td>{row.week}</td>
                      <td>{row.opp}</td>
                      {columns.map((col) => (
                        <td key={col.key}>
                          {fmtCell(col.key, row.cells[col.key], Boolean(row.bye))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* Roster: fixed-height slot so load ↔ ready never drops the Show less/more row. */}
        {roster ? (
          <div className="player-gamelog-more-slot">
            <button
              type="button"
              className={`player-gamelog-more${canToggle && !loading ? '' : ' is-reserved'}`}
              onClick={() => setExpanded((v) => !v)}
              disabled={!canToggle || loading}
              aria-hidden={!canToggle || loading}
              tabIndex={canToggle && !loading ? 0 : -1}
            >
              {/* Same label as default expanded load so the slot metrics match. */}
              {loading || expanded ? 'Show less' : 'Show more'}
            </button>
          </div>
        ) : (
          canToggle && (
            <button
              type="button"
              className="player-gamelog-more"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )
        )}
      </div>
    </aside>
  );
}
