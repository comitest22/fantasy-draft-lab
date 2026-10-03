import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getPlayerGameLog, getSosBoard } from '../services/api';
import type {
  PlayerGameLog as GameLog,
  PlayerGameLogColumn,
  PlayerSosWeek,
  Position,
  SosBoard,
} from '../types';
import { rankHeat } from '../utils/heatScale';
import { buildWindowRosRanks, clampWeekRange, type SosChartPos } from '../utils/sosWindow';

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

function SosWeekCell({ cell }: { cell: PlayerSosWeek }) {
  if (cell.bye || !cell.opponent) {
    return <span className="sos-match bye">BYE</span>;
  }
  const label = cell.home === false ? `@${cell.opponent}` : cell.opponent;
  return (
    <span
      className="sos-match"
      style={rankHeat(cell.rank)}
      title={
        cell.rank != null
          ? `${label} · matchup ${cell.rank} (1 easiest, 32 toughest)`
          : label
      }
    >
      <span className="sos-match-opp">{label}</span>
      <span className="sos-match-n">{cell.rank ?? '—'}</span>
    </span>
  );
}

export default function PlayerGameLog({ name }: { name: string }) {
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [log, setLog] = useState<GameLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<LogMode>('receiving');
  const [weekFromDraft, setWeekFromDraft] = useState('1');
  const [weekToDraft, setWeekToDraft] = useState('18');
  const [weekFrom, setWeekFrom] = useState(1);
  const [weekTo, setWeekTo] = useState(18);
  const [showRemaining, setShowRemaining] = useState(false);
  const [sosBoard, setSosBoard] = useState<SosBoard | null>(null);
  const savedWeekRange = useRef({ from: 1, to: 18 });

  useEffect(() => {
    setSeason(undefined);
    setSeasons([]);
    setMode('receiving');
    setWeekFromDraft('1');
    setWeekToDraft('18');
    setWeekFrom(1);
    setWeekTo(18);
    setShowRemaining(false);
    savedWeekRange.current = { from: 1, to: 18 };
  }, [name]);

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
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLog(null);
    setExpanded(true);
    getPlayerGameLog(name, season)
      .then((data) => {
        if (cancelled) return;
        setLog(data.log);
        if (data.log.seasons?.length) setSeasons(data.log.seasons);
        if (season == null && data.log.season != null) setSeason(data.log.season);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Game log unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, season]);

  useEffect(() => {
    if (log?.position) setMode(defaultMode(log.position));
  }, [name, log?.position]);

  const yearOptions = useMemo(() => {
    if (seasons.length > 0) return seasons;
    if (log?.season != null) return [log.season];
    return [];
  }, [seasons, log?.season]);

  const pills = modeOptions(log?.position);
  const columns = useMemo(
    () => (log ? columnsForMode(log.columns, mode) : []),
    [log, mode]
  );
  const preview = log?.previewRows ?? 8;
  const rows = log ? (expanded ? log.rows : log.rows.slice(0, preview)) : [];
  const canToggle = (log?.rows.length ?? 0) > preview;
  const slate = log?.sosSlate;
  const weekMax = useMemo(() => {
    const weeks = slate?.weeks ?? [];
    if (weeks.length === 0) return 18;
    return Math.max(18, ...weeks.map((week) => week.week));
  }, [slate]);
  const currentWeek = Math.min(weekMax, Math.max(1, slate?.currentWeek ?? 1));

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
    const ranks = buildWindowRosRanks(sosBoard.teams, weeks, chartPosFor(slate.position));
    return ranks.get(slate.team);
  }, [slate, sosBoard, isCustom, weekFrom, weekTo]);

  const sosLabel = useMemo(() => {
    if (!slate) return '';
    if (!isCustom) {
      return slate.rank != null ? `ROS #${slate.rank} (${rosQuality(slate.rank)})` : 'ROS';
    }
    const range = `W${weekFrom} - W${weekTo}`;
    if (windowRank == null) return `${range} SOS`;
    return `${range} SOS #${windowRank} (${rosQuality(windowRank)})`;
  }, [slate, isCustom, weekFrom, weekTo, windowRank]);

  function applyWeekRange(e: FormEvent) {
    e.preventDefault();
    const next = clampWeekRange(weekFromDraft, weekToDraft, weekMax);
    const remaining = next.from === currentWeek && next.to === weekMax;
    setWeekWindow(next.from, next.to, remaining);
  }

  function onShowRemaining(checked: boolean) {
    if (checked) {
      savedWeekRange.current = { from: weekFrom, to: weekTo };
      setWeekWindow(currentWeek, weekMax, true);
      return;
    }
    const { from, to } = savedWeekRange.current;
    setWeekWindow(from, to, false);
  }

  return (
    <aside className="player-gamelog" aria-label={`${name} game log`}>
      {slate && slate.weeks.length > 0 && (
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
                onChange={(e) => setWeekFromDraft(e.target.value)}
                aria-label="From week"
              />
              <span>to</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={weekMax}
                value={weekToDraft}
                onChange={(e) => setWeekToDraft(e.target.value)}
                aria-label="To week"
              />
              <button type="submit">Apply</button>
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
                  ? 'Matchup rank for the applied weeks (avg weekly cells, 1 = easiest)'
                  : 'Remaining-slate SOS from the current week through the end of the season (1 = easiest)'
              }
            >
              {sosLabel}
            </span>
          </div>
          {shownWeeks.length === 0 ? (
            <p className="player-gamelog-empty">No weeks in that range.</p>
          ) : (
            <div className="player-sos-scroller">
              <div className="player-sos-row">
                {shownWeeks.map((week) => (
                  <div key={week.week} className="player-sos-week">
                    <span
                      className={`player-sos-week-n${week.week === currentWeek ? ' is-current' : ''}`}
                      title={week.week === currentWeek ? `Current week ${week.week}` : undefined}
                    >
                      {week.week}
                    </span>
                    <SosWeekCell cell={week} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
                  aria-selected={mode === pill.id}
                  className={`player-gamelog-pill${mode === pill.id ? ' active' : ''}`}
                  onClick={() => setMode(pill.id)}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {yearOptions.length > 0 && (
          <label className="player-gamelog-year">
            <span className="visually-hidden">Season</span>
            <select
              value={season ?? log?.season ?? yearOptions[0]}
              onChange={(e) => setSeason(Number(e.target.value))}
              aria-label="Game log season"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {loading && <p className="player-gamelog-empty">Loading game log…</p>}
      {!loading && error && <p className="player-gamelog-empty">{error}</p>}
      {!loading && !error && log?.note && log.rows.length === 0 && (
        <p className="player-gamelog-empty">{log.note}</p>
      )}
      {!loading && !error && log && log.rows.length > 0 && (
        <>
          <div className="player-gamelog-scroller">
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
                  <tr key={`${row.week}-${row.opp}`} className={row.bye ? 'is-bye' : undefined}>
                    <td>{row.week}</td>
                    <td>{row.opp}</td>
                    {columns.map((col) => (
                      <td key={col.key}>{fmtCell(col.key, row.cells[col.key], Boolean(row.bye))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canToggle && (
            <button type="button" className="player-gamelog-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}
    </aside>
  );
}
