import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageTabs from '../components/PageTabs';
import SurvivorPicksView from '../components/SurvivorPicksView';
import { getSurvivorBoard } from '../services/api';
import type { SurvivorBoard, SurvivorMode, SurvivorSeasonCell } from '../types';
import { pctHeat } from '../utils/heatScale';

const views = [
  { id: 'week', label: 'Week' },
  { id: 'season', label: 'Season' },
  { id: 'picks', label: 'Picks' },
];

function usedKey(mode: SurvivorMode): string {
  return mode === 'win' ? 'dsafd-survivor-win-v1' : 'dsafd-survivor-lose-v1';
}

function loadUsed(mode: SurvivorMode): string[] {
  try {
    const raw = localStorage.getItem(usedKey(mode));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export default function SurvivorPage({ mode }: { mode: SurvivorMode }) {
  const [board, setBoard] = useState<SurvivorBoard | null>(null);
  const [week, setWeek] = useState<number | undefined>(undefined);
  const [view, setView] = useState('week');
  const [seasonSortWeek, setSeasonSortWeek] = useState<number | null>(null);
  const [seasonSortDir, setSeasonSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState<string[]>(() => loadUsed(mode));

  useEffect(() => {
    setUsed(loadUsed(mode));
    setWeek(undefined);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSurvivorBoard(mode, week)
      .then((data) => {
        if (cancelled) return;
        setBoard(data);
        setError(null);
        if (week == null) setWeek(data.currentWeek);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, week]);

  function toggleUsed(team: string) {
    setUsed((prev) => {
      const next = prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team];
      localStorage.setItem(usedKey(mode), JSON.stringify(next));
      return next;
    });
  }

  const invert = mode === 'lose';
  const title = mode === 'win' ? 'NFL Survivor' : 'NFL Survivor Loser';

  const weekRows = useMemo(() => {
    if (!board) return [];
    return [...board.week].sort((a, b) => {
      const au = used.includes(a.team) ? 1 : 0;
      const bu = used.includes(b.team) ? 1 : 0;
      if (au !== bu) return au - bu;
      if (a.bye !== b.bye) return a.bye ? 1 : -1;
      return (a.pickRank ?? 99) - (b.pickRank ?? 99);
    });
  }, [board, used]);

  const seasonRows = useMemo(() => {
    if (!board) return [];
    const rows = [...board.seasonRows];
    if (seasonSortWeek == null) return rows;
    const dir = seasonSortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = seasonPct(a, seasonSortWeek, invert);
      const bv = seasonPct(b, seasonSortWeek, invert);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [board, seasonSortWeek, seasonSortDir, invert]);

  function onSeasonWeek(w: number) {
    setWeek(w);
    if (seasonSortWeek === w) {
      setSeasonSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSeasonSortWeek(w);
    setSeasonSortDir('desc');
  }

  if (loading && !board) return <p className="status">Loading survivor board...</p>;
  if (error && !board) return <p className="error">{error}</p>;
  if (!board) return null;

  const selectedWeek = week ?? board.currentWeek;
  const live = board.currentWeek === selectedWeek;
  const showLines = Boolean(board.weekHasLines) || live;

  return (
    <section className="panel">
      <div className="page-intro">
        <Link to="/strategy" className="back-link">
          ← Strategy
        </Link>
        <h1>{title}</h1>
        <p className="subtitle">
          {board.sourceNote} {board.lastUpdated ? board.lastUpdated.replace(/^Last updated:\s*/i, 'Updated ') : ''}
          Click a team code to mark it used.
        </p>
      </div>
      <PageTabs tabs={views} active={view} onChange={setView} label="Survivor view" />
      {view !== 'picks' && (
      <div className="surv-weeks" role="tablist" aria-label="Week">
        {board.weeks.map((w) => (
          <button
            key={w}
            type="button"
            className={`page-tab${selectedWeek === w ? ' active' : ''}`}
            onClick={() => setWeek(w)}
          >
            {w}
          </button>
        ))}
      </div>
      )}

      {view === 'week' && (
        <>
          <div className="surv-picks">
            {board.picks
              .filter((p) => !used.includes(p.team))
              .slice(0, 3)
              .map((p) => (
                <button key={p.team} type="button" className="surv-pick" onClick={() => toggleUsed(p.team)}>
                  <strong>
                    #{p.pickRank} {p.teamName}
                  </strong>
                  <span>{p.reason}</span>
                </button>
              ))}
          </div>
          <div className="sos-table-wrap">
            <table className="data-table surv-table">
              <thead>
                <tr>
                  <th>Rk</th>
                  <th>Team</th>
                  <th>Matchup</th>
                  <th>{invert ? 'Lose' : 'PG win'}</th>
                  {showLines && <th>Mkt</th>}
                  {showLines && <th>ML</th>}
                  {showLines && <th>Spread</th>}
                  {showLines && <th>Pop</th>}
                  {showLines && <th>EV</th>}
                  <th>FV</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {weekRows.map((row) => (
                  <tr key={row.team} className={used.includes(row.team) ? 'is-used' : row.recommended ? 'is-rec' : undefined}>
                    <td>{row.bye ? '—' : row.pickRank}</td>
                    <td>
                      <button type="button" className="surv-team" onClick={() => toggleUsed(row.team)}>
                        <span className="sos-team-code">{row.team}</span>
                        <span className="sos-team-name">{row.teamName}</span>
                        {used.includes(row.team) ? ' · used' : ''}
                      </button>
                    </td>
                    <td>{row.bye ? 'BYE' : row.matchupLabel || row.opponent}</td>
                    <td>
                      <span className="surv-chip" style={pctHeat(invert ? row.pgLosePct : row.pgWinPct)}>
                        {row.bye ? '—' : `${invert ? row.pgLosePct : row.pgWinPct}%`}
                      </span>
                    </td>
                    {showLines && <td>{row.marketWinPct != null ? `${row.marketWinPct}%` : '—'}</td>}
                    {showLines && <td>{row.moneyline || '—'}</td>}
                    {showLines && <td>{row.spread != null ? row.spread : '—'}</td>}
                    {showLines && <td>{row.popularityPct != null ? `${row.popularityPct}%` : '—'}</td>}
                    {showLines && <td>{row.ev != null ? row.ev.toFixed(2) : '—'}</td>}
                    <td>{row.futureValue != null ? row.futureValue : '—'}</td>
                    <td>
                      {[...row.gameNotes, ...(row.contextNotes ?? [])].join(' ') || '—'}
                      {row.contextAdj ? ` (${row.contextAdj > 0 ? '+' : ''}${row.contextAdj})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!showLines && (
            <p className="subtitle">
              Lines, popularity, and EV are stored when a week is current. Week {selectedWeek} only has
              projected win odds — open a week that was pulled while live for the full board.
            </p>
          )}
          {showLines && !live && (
            <p className="subtitle">
              Showing the Mkt / ML / Pop / EV board saved when week {selectedWeek} was current.
            </p>
          )}
        </>
      )}

      {view === 'picks' && <SurvivorPicksView board={board} invert={invert} mode={mode} />}

      {view === 'season' && (
        <div className="sos-chart-wrap">
          <table className="sos-chart surv-season">
            <thead>
              <tr>
                <th className="sos-chart-team">Team</th>
                {board.weeks.map((w) => (
                  <th key={w}>
                    <button
                      type="button"
                      className={`sos-sort${(seasonSortWeek ?? week) === w ? ' active' : ''}`}
                      onClick={() => onSeasonWeek(w)}
                    >
                      {w}
                      {seasonSortWeek === w ? (seasonSortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seasonRows.map((row) => (
                <tr key={row.team} className={used.includes(row.team) ? 'is-used' : undefined}>
                  <td className="sos-chart-team">
                    <button type="button" className="surv-team" onClick={() => toggleUsed(row.team)}>
                      <span className="sos-team-code">{row.team}</span>
                      <span className="sos-team-name">{row.teamName}</span>
                    </button>
                  </td>
                  {row.cells.map((cell) => (
                    <td key={cell.week}>
                      <SeasonCell cell={cell} invert={invert} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function seasonPct(row: { cells: SurvivorSeasonCell[] }, week: number, invert: boolean): number | null {
  const cell = row.cells.find((c) => c.week === week);
  if (!cell || cell.bye) return null;
  const pct = invert ? cell.losePct : cell.winPct;
  return pct ?? null;
}

function seasonHeat(cell: SurvivorSeasonCell, invert: boolean): number | null {
  const pct = invert ? cell.losePct : cell.winPct;
  return pct ?? null;
}

function SeasonCell({ cell, invert }: { cell: SurvivorSeasonCell; invert: boolean }) {
  if (cell.bye) {
    return <div className="sos-match bye">BYE</div>;
  }
  const pct = invert ? cell.losePct : cell.winPct;
  const resultBit = cell.result ? [cell.result, cell.score].filter(Boolean).join(' ') : '';
  return (
    <div
      className={`sos-match${cell.result ? ` surv-season-final is-${cell.result === 'W' ? 'win' : 'loss'}` : ''}`}
      style={pctHeat(seasonHeat(cell, invert))}
      title={[cell.opp, pct != null ? `${pct}%` : null, resultBit].filter(Boolean).join(' · ')}
    >
      <span className="sos-match-opp">{cell.opp}</span>
      {pct != null ? <span>{pct}</span> : null}
      {resultBit ? <span className="surv-score">{resultBit}</span> : null}
      {pct == null && !resultBit ? <span>—</span> : null}
    </div>
  );
}
