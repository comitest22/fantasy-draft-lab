import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import PageTabs from '../components/PageTabs';
import { getSosBoard } from '../services/api';
import type { SosBoard, SosPosStat, SosTeamRow, SosUnitChange, SosWeekCell } from '../types';
import { rankHeat } from '../utils/heatScale';
import { buildWindowRosRanks, clampWeekRange, compareWeekOrder } from '../utils/sosWindow';

const TEAM_NAMES: Record<string, string> = {
  ARI: 'Arizona',
  ATL: 'Atlanta',
  BAL: 'Baltimore',
  BUF: 'Buffalo',
  CAR: 'Carolina',
  CHI: 'Chicago',
  CIN: 'Cincinnati',
  CLE: 'Cleveland',
  DAL: 'Dallas',
  DEN: 'Denver',
  DET: 'Detroit',
  GB: 'Green Bay',
  HOU: 'Houston',
  IND: 'Indianapolis',
  JAX: 'Jacksonville',
  KC: 'Kansas City',
  LA: 'LA Rams',
  LAC: 'LA Chargers',
  LV: 'Las Vegas',
  MIA: 'Miami',
  MIN: 'Minnesota',
  NE: 'New England',
  NO: 'New Orleans',
  NYG: 'NY Giants',
  NYJ: 'NY Jets',
  PHI: 'Philadelphia',
  PIT: 'Pittsburgh',
  SEA: 'Seattle',
  SF: 'San Francisco',
  TB: 'Tampa Bay',
  TEN: 'Tennessee',
  WAS: 'Washington',
};

type SortKey = 'team' | 'overall' | 'qb' | 'rb' | 'wr' | 'te' | 'dst';
type ChartPos = 'overall' | 'qb' | 'rb' | 'wr' | 'te' | 'dst';
type ChartOrder = 'sos' | 'ranked' | 'az' | 'za';

const views = [
  { id: 'list', label: 'List' },
  { id: 'offense', label: 'Offense' },
  { id: 'defense', label: 'Defense' },
];

const chartPosTabs: Array<{ id: ChartPos; label: string }> = [
  { id: 'overall', label: 'Overall' },
  { id: 'qb', label: 'QB' },
  { id: 'rb', label: 'RB' },
  { id: 'wr', label: 'WR' },
  { id: 'te', label: 'TE' },
];

const chartOrderOptions: Array<{ id: ChartOrder; label: string }> = [
  { id: 'sos', label: 'ROS' },
  { id: 'ranked', label: 'Top ranked' },
  { id: 'az', label: 'A to Z' },
  { id: 'za', label: 'Z to A' },
];

function signed(n?: number): string | undefined {
  if (n == null) return undefined;
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function unitHint(change?: SosUnitChange, seasons?: { latest: number; prior: number }): string | undefined {
  if (!change) return undefined;
  const parts = [
    change.offense != null ? `offense ${signed(change.offense)}` : undefined,
    change.oline != null ? `O-line ${signed(change.oline)}` : undefined,
  ].filter(Boolean);
  if (parts.length === 0) return undefined;
  const yrs = seasons ? `${seasons.latest} vs ${seasons.prior}` : 'vs last year';
  return `${yrs}: ${parts.join(', ')} (positive = improved)`;
}

function SosChip({
  stat,
  change,
  seasons,
}: {
  stat: SosPosStat;
  change?: SosUnitChange;
  seasons?: { latest: number; prior: number };
}) {
  if (stat.rank == null) return <span className="sos-chip empty">—</span>;
  const bits = [
    stat.score != null ? `Score ${stat.score}` : undefined,
    unitHint(change, seasons),
  ].filter(Boolean);
  return (
    <span className="sos-chip" style={rankHeat(stat.rank)} title={bits.join(' · ') || undefined}>
      #{stat.rank}
    </span>
  );
}

function rankOf(row: SosTeamRow, key: SortKey): number {
  if (key === 'team') return 0;
  if (key === 'dst') return row.dst?.rank ?? 99;
  return row[key].rank ?? 99;
}

function rosLabel(
  team: string,
  ranks: Map<string, number>,
  pos: ChartPos,
  weekFrom: number,
  weekTo: number
): { text: string; title: string } | null {
  const rank = ranks.get(team);
  if (rank == null) return null;
  const window =
    weekFrom === weekTo ? `week ${weekFrom}` : `weeks ${weekFrom}–${weekTo}`;
  if (pos === 'dst') {
    return {
      text: `ROS #${rank}`,
      title: `D/ST matchup rank for ${window} (avg weekly cells, 1 = easiest)`,
    };
  }
  const posName = pos === 'overall' ? 'overall' : pos.toUpperCase();
  return {
    text: `ROS #${rank}`,
    title: `${posName} matchup rank for ${window} (avg weekly cells, 1 = easiest)`,
  };
}

function cellRating(cell: SosWeekCell, pos: ChartPos): number | undefined {
  return cell[pos];
}

function WeekSortHeader({
  week,
  active,
  dir,
  onSort,
  isCurrent,
}: {
  week: number;
  active: boolean;
  dir: 'asc' | 'desc';
  onSort: (week: number) => void;
  isCurrent: boolean;
}) {
  const next = !active ? 'easiest first' : dir === 'asc' ? 'toughest first' : 'original order';
  return (
    <th className={isCurrent ? 'is-current' : undefined}>
      <span className="surv-week-head">
        <span className={`surv-current-label${isCurrent ? '' : ' is-ghost'}`}>
          Current
          <br />
          Week
        </span>
        <button
          type="button"
          className={`sos-sort${active ? ' active' : ''}`}
          aria-label={`Sort week ${week}, ${next}`}
          onClick={() => onSort(week)}
        >
          {week}
          {active ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
        </button>
      </span>
    </th>
  );
}

function SosMatch({
  cell,
  pos,
  change,
  seasons,
}: {
  cell: SosWeekCell;
  pos: ChartPos;
  change?: SosUnitChange;
  seasons?: { latest: number; prior: number };
}) {
  if (cell.bye || !cell.opponent) {
    return <span className="sos-match bye">BYE</span>;
  }
  const rating = cellRating(cell, pos);
  const label = cell.home === false ? `@${cell.opponent}` : cell.opponent;
  const env = pos === 'dst' ? undefined : unitHint(change, seasons);
  const scale = pos === 'dst' ? '1 easiest offense to face, 32 toughest' : '1 easiest, 32 toughest';
  return (
    <span
      className="sos-match"
      style={rankHeat(rating)}
      title={
        rating != null
          ? `${label} · matchup ${rating} (${scale})${env ? ` · ${env}` : ''}`
          : label
      }
    >
      <span className="sos-match-opp">{label}</span>
      <span className="sos-match-n">{rating ?? '—'}</span>
    </span>
  );
}

export default function SosPage() {
  const [board, setBoard] = useState<SosBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('overall');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState('list');
  const [chartPos, setChartPos] = useState<ChartPos>('overall');
  const [chartOrder, setChartOrder] = useState<ChartOrder>('sos');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(() => new Set());
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [weekFromDraft, setWeekFromDraft] = useState('1');
  const [weekToDraft, setWeekToDraft] = useState('18');
  const [weekFrom, setWeekFrom] = useState(1);
  const [weekTo, setWeekTo] = useState(18);
  const [showRemaining, setShowRemaining] = useState(false);
  const [weekSort, setWeekSort] = useState<number | null>(null);
  const [weekSortDir, setWeekSortDir] = useState<'asc' | 'desc'>('asc');
  const filterRef = useRef<HTMLDivElement>(null);
  const savedWeekRange = useRef({ from: 1, to: 18 });

  function onView(next: string) {
    setView(next);
    setChartOrder('sos');
    setFilterOpen(false);
    setSelectedTeams(new Set());
    setShowOnlySelected(false);
    setWeekSort(null);
    setWeekSortDir('asc');
  }

  function onWeekSort(week: number) {
    if (weekSort !== week) {
      setWeekSort(week);
      setWeekSortDir('asc');
      return;
    }
    if (weekSortDir === 'asc') {
      setWeekSortDir('desc');
      return;
    }
    setWeekSort(null);
    setWeekSortDir('asc');
  }

  useEffect(() => {
    getSosBoard()
      .then((data) => {
        setBoard(data);
        const max = data.weeks ?? data.teams[0]?.games?.length ?? 18;
        setWeekFromDraft('1');
        setWeekToDraft(String(max));
        setWeekFrom(1);
        setWeekTo(max);
        setShowRemaining(false);
        savedWeekRange.current = { from: 1, to: max };
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    function onDoc(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFilterOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (selectedTeams.size === 0 && showOnlySelected) setShowOnlySelected(false);
  }, [selectedTeams, showOnlySelected]);

  const weekCount = board?.weeks ?? board?.teams[0]?.games?.length ?? 18;
  const visibleWeeks = useMemo(() => {
    const from = Math.min(weekCount, Math.max(1, weekFrom));
    const to = Math.min(weekCount, Math.max(from, weekTo));
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [weekCount, weekFrom, weekTo]);

  const windowRosRanks = useMemo(() => {
    if (!board) return new Map<string, number>();
    const pos: ChartPos = view === 'defense' ? 'dst' : chartPos;
    return buildWindowRosRanks(board.teams, visibleWeeks, pos);
  }, [board, view, chartPos, visibleWeeks]);

  const rows = useMemo(() => {
    if (!board) return [];
    let copy = [...board.teams];
    if ((view === 'offense' || view === 'defense') && weekSort != null) {
      const pos: ChartPos = view === 'defense' ? 'dst' : chartPos;
      copy.sort((a, b) => compareWeekOrder(a, b, weekSort, pos, weekSortDir));
    } else if (view === 'offense') {
      copy.sort((a, b) => {
        if (chartOrder === 'az') return a.team.localeCompare(b.team);
        if (chartOrder === 'za') return b.team.localeCompare(a.team);
        if (chartOrder === 'ranked') {
          const cmp = (a.offense ?? 99) - (b.offense ?? 99);
          return cmp || a.team.localeCompare(b.team);
        }
        const cmp = (windowRosRanks.get(a.team) ?? 99) - (windowRosRanks.get(b.team) ?? 99);
        return cmp || a.team.localeCompare(b.team);
      });
    } else if (view === 'defense') {
      copy.sort((a, b) => {
        if (chartOrder === 'az') return a.team.localeCompare(b.team);
        if (chartOrder === 'za') return b.team.localeCompare(a.team);
        if (chartOrder === 'ranked') {
          const cmp = (a.defense ?? 99) - (b.defense ?? 99);
          return cmp || a.team.localeCompare(b.team);
        }
        const cmp = (windowRosRanks.get(a.team) ?? 99) - (windowRosRanks.get(b.team) ?? 99);
        return cmp || a.team.localeCompare(b.team);
      });
    } else {
      copy.sort((a, b) => {
        if (sortKey === 'team') {
          const cmp = a.team.localeCompare(b.team);
          return sortDir === 'asc' ? cmp : -cmp;
        }
        const cmp = rankOf(a, sortKey) - rankOf(b, sortKey);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    if ((view === 'offense' || view === 'defense') && showOnlySelected && selectedTeams.size > 0) {
      copy = copy.filter((row) => selectedTeams.has(row.team));
    }
    return copy;
  }, [
    board,
    sortKey,
    sortDir,
    view,
    chartOrder,
    showOnlySelected,
    selectedTeams,
    windowRosRanks,
    chartPos,
    weekSort,
    weekSortDir,
  ]);

  function onSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  }

  function toggleTeam(team: string) {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  function setWeekWindow(from: number, to: number, remaining = false) {
    setWeekFrom(from);
    setWeekTo(to);
    setWeekFromDraft(String(from));
    setWeekToDraft(String(to));
    setShowRemaining(remaining);
    setWeekSort((current) => (current != null && (current < from || current > to) ? null : current));
  }

  function applyWeekRange(e?: FormEvent) {
    e?.preventDefault();
    const max = board?.weeks ?? board?.teams[0]?.games?.length ?? 18;
    const current = Math.min(max, Math.max(1, board?.currentWeek ?? 1));
    const next = clampWeekRange(weekFromDraft, weekToDraft, max);
    const remaining = next.from === current && next.to === max;
    setWeekWindow(next.from, next.to, remaining);
  }

  function onShowRemaining(checked: boolean) {
    const max = board?.weeks ?? board?.teams[0]?.games?.length ?? 18;
    const current = Math.min(max, Math.max(1, board?.currentWeek ?? 1));
    if (checked) {
      savedWeekRange.current = { from: weekFrom, to: weekTo };
      setWeekWindow(current, max, true);
      return;
    }
    const { from, to } = savedWeekRange.current;
    setWeekWindow(from, to, false);
  }

  if (loading) return <p className="status">Loading strength of schedule...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!board || board.teams.length === 0) {
    return (
      <section className="panel">
        <p>No SOS data loaded for this year.</p>
        <Link to="/tools" className="back-link">
          ← Tools
        </Link>
      </section>
    );
  }

  const cols: Array<{ key: SortKey; label: string }> = [
    { key: 'team', label: 'Team' },
    { key: 'overall', label: 'Overall' },
    { key: 'qb', label: 'QB' },
    { key: 'rb', label: 'RB' },
    { key: 'wr', label: 'WR' },
    { key: 'te', label: 'TE' },
    { key: 'dst', label: 'D/ST' },
  ];
  const weeks = board.weeks ?? board.teams[0]?.games?.length ?? 18;
  const currentWeek = Math.min(weeks, Math.max(1, board.currentWeek ?? 1));
  const hasChart = board.teams.some((t) => (t.games?.length ?? 0) > 0);
  const chartView = view === 'offense' || view === 'defense';
  const orderLabel = chartOrderOptions.find((o) => o.id === chartOrder)?.label ?? 'ROS';

  return (
    <section className="panel">
      <div className="page-intro">
        <Link to="/tools" className="back-link">
          ← Tools
        </Link>
        <h1>{board.season} Strength of Schedule</h1>
        <p className="subtitle">
          {view === 'offense'
            ? `Teams down the left, weeks across the top. Remaining boxes use this year’s opponent D, mixed with last year only until four weeks are in (then 100% 2026). Played weeks use this year’s ranks. Color and number 1 (easiest) to 32 (toughest), then shifted by this team’s ${board.unitSeasons ? `${board.unitSeasons.latest} vs ${board.unitSeasons.prior}` : 'latest vs prior'} offense and O-line. Position pills sit above the chart; Filter sorts by positional ROS (recalculated for the applied week window), top-ranked offenses, or A–Z / Z–A. Click a week number to sort that column easiest first, click again to reverse, and click a third time to restore the chart order. Click a team name to select rows. Narrow weeks with Showing Week … to … Apply, or Remaining Schedule.`
            : view === 'defense'
              ? 'Fantasy D/ST remaining slate by week. #1 is the easiest opposing offenses. Cells use this year’s points-scored ranks, mixed with last year only until four weeks are in. Played weeks use this year’s ranks. Offense and O-line are not applied here. Filter sorts by D/ST ROS (recalculated for the applied week window), top defenses by through-week points allowed (1 = fewest), or A–Z / Z–A. Click a week number to sort that column easiest first, click again to reverse, and click a third time to restore the chart order. Click a team name to select rows. Narrow weeks with Showing Week … to … Apply, or Remaining Schedule. Remaining-slate D/ST ranks and D-line also live on the List tab.'
              : `${board.sourceNote ? `${board.sourceNote}. ` : ''}Remaining-schedule ranks for every NFL team, with ${board.unitSeasons ? `${board.unitSeasons.latest} vs ${board.unitSeasons.prior}` : 'year-over-year'} offense and O-line baked in. #1 is the easiest slate, #32 is the toughest. D/ST is remaining opposing offenses (no Off/OL). D-line under the name is consensus pass-rush (1 = best). Hover a rank for the score and unit change. Click a column to sort.`}
        </p>
      </div>
      <div className="sos-tabs-row">
        <PageTabs tabs={views} active={view} onChange={onView} label="SOS view" />
        {hasChart && (
          <form className="sos-week-range" onSubmit={applyWeekRange}>
            <span>Showing Week</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={weeks}
              value={weekFromDraft}
              onChange={(e) => setWeekFromDraft(e.target.value)}
              aria-label="From week"
            />
            <span>to</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={weeks}
              value={weekToDraft}
              onChange={(e) => setWeekToDraft(e.target.value)}
              aria-label="To week"
            />
            <button type="submit">Apply</button>
          </form>
        )}
      </div>
      <div className="sos-legend-row">
        <div className="sos-legend" aria-hidden="true">
          <span>Easiest</span>
          <span className="sos-legend-bar" />
          <span>Toughest</span>
        </div>
        {chartView && (
          <div className="sos-legend-controls">
            <div className="sos-filter" ref={filterRef}>
              <button
                type="button"
                className={`sos-filter-btn${filterOpen ? ' open' : ''}`}
                aria-expanded={filterOpen}
                aria-haspopup="listbox"
                onClick={() => setFilterOpen((v) => !v)}
              >
                Filter · {orderLabel}
              </button>
              {filterOpen && (
                <div className="sos-filter-menu" role="listbox" aria-label="Row order">
                  {chartOrderOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={chartOrder === opt.id}
                      className={`sos-filter-option${chartOrder === opt.id ? ' active' : ''}`}
                      onClick={() => {
                        setChartOrder(opt.id);
                        setFilterOpen(false);
                        setWeekSort(null);
                        setWeekSortDir('asc');
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="sos-legend-check">
              <input
                type="checkbox"
                checked={showRemaining}
                onChange={(e) => onShowRemaining(e.target.checked)}
              />
              Remaining Schedule
            </label>
            <label className={`sos-legend-check${selectedTeams.size === 0 ? ' is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={showOnlySelected}
                disabled={selectedTeams.size === 0}
                onChange={(e) => setShowOnlySelected(e.target.checked)}
              />
              Show only selected teams
              {selectedTeams.size > 0 ? ` (${selectedTeams.size})` : ''}
            </label>
          </div>
        )}
      </div>

      {view === 'list' && (
        <div className="sos-table-wrap">
          <table className="data-table sos-table">
            <thead>
              <tr>
                {cols.map((col) => (
                  <th key={col.key}>
                    <button
                      type="button"
                      className={`sos-sort${sortKey === col.key ? ' active' : ''}`}
                      onClick={() => onSort(col.key)}
                    >
                      {col.label}
                      {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.team}>
                  <td>
                    <span className="sos-team-code">{row.team}</span>
                    <span className="sos-team-name">{TEAM_NAMES[row.team] ?? row.team}</span>
                    {row.unitChange && (
                      <span className="sos-unit-delta" title={unitHint(row.unitChange, board.unitSeasons)}>
                        Off {signed(row.unitChange.offense) ?? '—'} · OL {signed(row.unitChange.oline) ?? '—'}
                      </span>
                    )}
                    {row.dline != null && (
                      <span className="sos-unit-delta" title="Consensus D-line rank, 1 = best">
                        DL #{Math.round(row.dline)}
                      </span>
                    )}
                  </td>
                  <td>
                    <SosChip stat={row.overall} change={row.unitChange} seasons={board.unitSeasons} />
                  </td>
                  <td>
                    <SosChip stat={row.qb} change={row.unitChange} seasons={board.unitSeasons} />
                  </td>
                  <td>
                    <SosChip stat={row.rb} change={row.unitChange} seasons={board.unitSeasons} />
                  </td>
                  <td>
                    <SosChip stat={row.wr} change={row.unitChange} seasons={board.unitSeasons} />
                  </td>
                  <td>
                    <SosChip stat={row.te} change={row.unitChange} seasons={board.unitSeasons} />
                  </td>
                  <td>
                    {row.dst?.rank != null ? (
                      <span
                        className="sos-chip"
                        style={rankHeat(row.dst.rank)}
                        title={
                          row.dst.score != null
                            ? `Avg matchup ${row.dst.score} (1 easiest remaining offenses, 32 toughest)`
                            : undefined
                        }
                      >
                        #{row.dst.rank}
                      </span>
                    ) : (
                      <span className="sos-chip empty">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'offense' && !hasChart && <p className="subtitle">No weekly schedule loaded yet.</p>}

      {view === 'offense' && hasChart && (
        <>
          <div className="sos-chart-toolbar">
            <div className="sos-chart-pos" role="tablist" aria-label="Matchup position">
              {chartPosTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={chartPos === tab.id}
                  className={`page-tab${chartPos === tab.id ? ' active' : ''}`}
                  onClick={() => setChartPos(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sos-clear-selection"
              disabled={selectedTeams.size === 0}
              onClick={() => setSelectedTeams(new Set())}
            >
              Clear Selected Teams
            </button>
          </div>
          <div className="sos-chart-wrap">
            <table className="sos-chart">
              <thead>
                <tr>
                  <th className="sos-chart-team">Team</th>
                  {visibleWeeks.map((week) => (
                    <WeekSortHeader
                      key={week}
                      week={week}
                      active={weekSort === week}
                      dir={weekSortDir}
                      onSort={onWeekSort}
                      isCurrent={week === currentWeek}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const selected = selectedTeams.has(row.team);
                  const ros =
                    chartOrder === 'sos'
                      ? rosLabel(row.team, windowRosRanks, chartPos, weekFrom, weekTo)
                      : null;
                  const byWeek = new Map((row.games ?? []).map((g) => [g.week, g]));
                  return (
                    <tr key={row.team} className={selected ? 'is-selected' : undefined}>
                      <th className="sos-chart-team" scope="row">
                        <button
                          type="button"
                          className={`sos-team-select${selected ? ' is-selected' : ''}`}
                          aria-pressed={selected}
                          onClick={() => toggleTeam(row.team)}
                        >
                          <span className="sos-team-code">{row.team}</span>
                          <span className="sos-team-name">{TEAM_NAMES[row.team] ?? row.team}</span>
                        </button>
                        {row.unitChange && (
                          <span className="sos-unit-delta" title={unitHint(row.unitChange, board.unitSeasons)}>
                            Off {signed(row.unitChange.offense) ?? '—'} · OL {signed(row.unitChange.oline) ?? '—'}
                          </span>
                        )}
                        {chartOrder === 'ranked' && row.offense != null && (
                          <span className="sos-unit-delta" title="Consensus offense rank, 1 = best">
                            Off #{Math.round(row.offense)}
                          </span>
                        )}
                        {ros && (
                          <span className="sos-unit-delta" title={ros.title}>
                            {ros.text}
                          </span>
                        )}
                      </th>
                      {visibleWeeks.map((week) => {
                        const cell = byWeek.get(week) ?? { week, bye: true };
                        return (
                          <td key={week}>
                            <SosMatch
                              cell={cell}
                              pos={chartPos}
                              change={row.unitChange}
                              seasons={board.unitSeasons}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'defense' && !hasChart && <p className="subtitle">No weekly schedule loaded yet.</p>}

      {view === 'defense' && hasChart && (
        <>
          <div className="sos-chart-toolbar">
            <button
              type="button"
              className="sos-clear-selection"
              disabled={selectedTeams.size === 0}
              onClick={() => setSelectedTeams(new Set())}
            >
              Clear Selected Teams
            </button>
          </div>
          <div className="sos-chart-wrap">
            <table className="sos-chart">
              <thead>
                <tr>
                  <th className="sos-chart-team">Team</th>
                  {visibleWeeks.map((week) => (
                    <WeekSortHeader
                      key={week}
                      week={week}
                      active={weekSort === week}
                      dir={weekSortDir}
                      onSort={onWeekSort}
                      isCurrent={week === currentWeek}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const selected = selectedTeams.has(row.team);
                  const ros =
                    chartOrder === 'sos'
                      ? rosLabel(row.team, windowRosRanks, 'dst', weekFrom, weekTo)
                      : null;
                  const byWeek = new Map((row.games ?? []).map((g) => [g.week, g]));
                  return (
                    <tr key={row.team} className={selected ? 'is-selected' : undefined}>
                      <th className="sos-chart-team" scope="row">
                        <button
                          type="button"
                          className={`sos-team-select${selected ? ' is-selected' : ''}`}
                          aria-pressed={selected}
                          onClick={() => toggleTeam(row.team)}
                        >
                          <span className="sos-team-code">{row.team}</span>
                          <span className="sos-team-name">{TEAM_NAMES[row.team] ?? row.team}</span>
                        </button>
                        {chartOrder === 'ranked' && row.defense != null && (
                          <span
                            className="sos-unit-delta"
                            title="Through-week defense by points allowed, 1 = fewest"
                          >
                            D #{Math.round(row.defense)}
                          </span>
                        )}
                        {ros && (
                          <span className="sos-unit-delta" title={ros.title}>
                            {ros.text}
                          </span>
                        )}
                      </th>
                      {visibleWeeks.map((week) => {
                        const cell = byWeek.get(week) ?? { week, bye: true };
                        return (
                          <td key={week}>
                            <SosMatch cell={cell} pos="dst" />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
