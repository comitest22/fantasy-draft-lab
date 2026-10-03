import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SurvivorBoard, SurvivorMode } from '../types';
import { pctHeat } from '../utils/heatScale';
import { buildEntryPaths, cellPct, formatSurviveProduct, bpaLocks } from '../utils/survivorPath';

type Entry = { id: string; lockedCount: number; chosen: string[] };
type WeekOpt = {
  team: string;
  teamName: string;
  /** Survival-path weight (finished W → 100, else projection). */
  pct: number;
  /** Pre-game projection for heat / rating (null when unknown). */
  projPct: number | null;
  opp: string;
  result: 'W' | 'L' | null;
  score: string | null;
};

function formatOpp(opp: string): string {
  const raw = opp.trim();
  if (!raw || /^bye$/i.test(raw)) return '';
  const away = /^(@|at\b)/i.test(raw);
  const team = raw.replace(/^(@|at\b|vs\.?)\s*/i, '').trim();
  if (!team) return '';
  return away ? `@ ${team}` : `vs ${team}`;
}

function storeKey(mode: SurvivorMode): string {
  return mode === 'win' ? 'dsafd-survivor-win-picks-v1' : 'dsafd-survivor-lose-picks-v1';
}

function parseEntry(row: unknown, i: number): Entry {
  const raw = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const id = String(raw.id ?? i + 1);
  if (Array.isArray(raw.chosen)) {
    return {
      id,
      lockedCount: Math.max(0, Number(raw.lockedCount) || 0),
      chosen: raw.chosen.map((team) => (typeof team === 'string' ? team : '')),
    };
  }
  const week1 = typeof raw.week1 === 'string' && raw.week1 ? raw.week1 : '';
  return { id, lockedCount: 0, chosen: week1 ? [week1] : [] };
}

function loadEntries(mode: SurvivorMode): Entry[] {
  try {
    const raw = localStorage.getItem(storeKey(mode));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length === 0) return [{ id: '1', lockedCount: 0, chosen: [] }];
    return parsed.map(parseEntry);
  } catch {
    return [{ id: '1', lockedCount: 0, chosen: [] }];
  }
}

function saveEntries(mode: SurvivorMode, entries: Entry[]) {
  localStorage.setItem(storeKey(mode), JSON.stringify(entries));
}

function locksFor(entry: Entry): Array<string | null> {
  return entry.chosen.map((team) => (team ? team : null));
}

function LockIcon({ locked }: { locked: boolean }) {
  return locked ? (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5 7.2V5a3 3 0 0 1 6 0v2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.2" y="7" width="9.6" height="7.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5 7.2V5a3 3 0 1 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.2" y="7" width="9.6" height="7.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function LockControl({
  locked,
  disabled,
  onClick,
  title,
  label,
}: {
  locked: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  label?: string;
}) {
  if (!onClick) {
    return (
      <span className={`surv-lock${locked ? ' is-locked' : ''}`} aria-hidden="true">
        <span className="surv-lock-now">
          <LockIcon locked={locked} />
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`surv-lock${locked ? ' is-locked' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={label}
    >
      <span className="surv-lock-now">
        <LockIcon locked={locked} />
      </span>
      <span className="surv-lock-hint">
        <LockIcon locked={!locked} />
      </span>
    </button>
  );
}

function pickLabel(pct: number, result?: 'W' | 'L' | null): string {
  return result ?? String(pct);
}

function PickSquare({
  team,
  opp,
  pct,
  result,
  empty,
  locked,
}: {
  team?: string;
  opp?: string;
  pct?: number;
  projPct?: number | null;
  result?: 'W' | 'L' | null;
  score?: string | null;
  empty?: string;
  locked?: boolean;
}) {
  const vs = formatOpp(opp ?? '');
  if (empty || !team) {
    return (
      <div className="sos-match surv-pick-empty">
        <span>{empty ?? '—'}</span>
      </div>
    );
  }
  const final = result === 'W' || result === 'L';
  const lockedPending = Boolean(locked) && !final;
  return (
    <div
      className={`sos-match${final ? ` surv-pick-final is-${result === 'W' ? 'win' : 'loss'}` : ''}${
        lockedPending ? ' surv-pick-locked' : ''
      }`}
      style={final || lockedPending ? undefined : pctHeat(pct ?? 0)}
      title={`${team} ${vs}`.trim()}
    >
      <span className="sos-match-opp">{team}</span>
      {vs ? <span className="surv-pick-opp">{vs}</span> : null}
      <span>{pickLabel(pct ?? 0, result)}</span>
    </div>
  );
}

function optionLabel(opt: WeekOpt): string {
  const vs = formatOpp(opt.opp);
  const mark = opt.result ? opt.result : `${opt.pct}%`;
  return `${opt.team} ${mark}${vs ? ` ${vs}` : ''}`;
}

function PickDrop({
  week,
  label,
  selected,
  selectedOpt,
  opts,
  open,
  onOpen,
  onClose,
  onPick,
}: {
  week: number;
  label: string;
  selected: string;
  selectedOpt?: WeekOpt;
  opts: WeekOpt[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (team: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 200, maxHeight: 280, ready: false });

  function place() {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const gap = 6;
    const width = 200;
    const maxHeight = Math.min(360, Math.max(160, window.innerHeight - pad * 2));
    const spaceRight = window.innerWidth - r.right - gap - pad;
    const openRight = spaceRight >= width || spaceRight >= r.left - gap - pad;
    let left = openRight ? r.right + gap : r.left - width - gap;
    left = Math.min(Math.max(pad, left), window.innerWidth - width - pad);
    const menuH = Math.min(menuRef.current?.offsetHeight || maxHeight, maxHeight);
    let top = r.top;
    if (top + menuH > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - menuH - pad);
    }
    setPos({ top, left, width, maxHeight, ready: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const id = requestAnimationFrame(place);
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className={`surv-pick-drop${open ? ' is-focused' : ''}`} ref={wrapRef}>
      <PickSquare
        team={selectedOpt?.team}
        opp={selectedOpt?.opp}
        pct={selectedOpt?.pct}
        result={selectedOpt?.result}
        empty={selected ? undefined : `Week ${week}`}
      />
      <button
        type="button"
        className="surv-pick-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? onClose() : onOpen())}
      />
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="surv-pick-menu"
              role="listbox"
              aria-label={label}
              style={{
                top: pos.top,
                left: pos.left,
                minWidth: pos.width,
                maxHeight: pos.maxHeight,
                visibility: pos.ready ? 'visible' : 'hidden',
              }}
            >
              <button
                type="button"
                role="option"
                aria-selected={!selected}
                className={!selected ? 'is-active' : undefined}
                onClick={() => {
                  onPick('');
                  onClose();
                }}
              >
                Week {week}
              </button>
              {opts.map((opt) => (
                <button
                  key={opt.team}
                  type="button"
                  role="option"
                  aria-selected={opt.team === selected}
                  className={opt.team === selected ? 'is-active' : undefined}
                  onClick={() => {
                    onPick(opt.team);
                    onClose();
                  }}
                >
                  {optionLabel(opt)}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default function SurvivorPicksView({ board, invert, mode }: { board: SurvivorBoard; invert: boolean; mode: SurvivorMode }) {
  const [entries, setEntries] = useState<Entry[]>(() => loadEntries(mode));
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadEntries(mode));
  }, [mode]);

  const optionsByWeek = useMemo(() => {
    const map = new Map<number, WeekOpt[]>();
    for (const week of board.weeks) {
      const opts = board.seasonRows
        .map((row) => {
          const cell = row.cells.find((c) => c.week === week);
          const projPct = invert ? (cell?.losePct ?? null) : (cell?.winPct ?? null);
          const pct = cellPct(cell, invert);
          if (pct == null && projPct == null) return null;
          return {
            team: row.team,
            teamName: row.teamName,
            pct: pct ?? projPct ?? 0,
            projPct,
            opp: cell?.opp ?? '',
            result: cell?.result ?? null,
            score: cell?.score ?? null,
          } satisfies WeekOpt;
        })
        .filter((row): row is WeekOpt => row != null)
        .sort((a, b) => (b.projPct ?? b.pct) - (a.projPct ?? a.pct) || a.team.localeCompare(b.team));
      map.set(week, opts);
    }
    return map;
  }, [board.seasonRows, board.weeks, invert]);

  const { paths } = useMemo(
    () => buildEntryPaths(board.seasonRows, invert, entries.map(locksFor)),
    [board.seasonRows, invert, entries],
  );

  function write(next: Entry[]) {
    setEntries(next);
    saveEntries(mode, next);
  }

  function setPick(id: string, week: number, team: string) {
    write(
      entries.map((entry) => {
        if (entry.id !== id) return entry;
        const chosen = entry.chosen.slice();
        chosen[week - 1] = team;
        for (let w = week + 1; w <= chosen.length; w++) {
          if (chosen[w - 1] === team) chosen[w - 1] = '';
        }
        return { ...entry, chosen };
      }),
    );
  }

  function lockWeek(id: string) {
    write(
      entries.map((entry, i) => {
        if (entry.id !== id) return entry;
        const week = entry.lockedCount + 1;
        if (!entry.chosen[week - 1]) return entry;
        const chosen = entry.chosen.slice();
        const nextWeek = week + 1;
        if (nextWeek <= board.weeks.length && !chosen[nextWeek - 1]) {
          const suggested = paths[i]?.slots[nextWeek - 1]?.team;
          if (suggested && !chosen.slice(0, week).includes(suggested)) {
            chosen[nextWeek - 1] = suggested;
          }
        }
        return { ...entry, lockedCount: week, chosen };
      }),
    );
  }

  function unlockWeek(id: string, week: number) {
    write(
      entries.map((entry) => {
        if (entry.id !== id) return entry;
        return { ...entry, lockedCount: Math.max(0, week - 1) };
      }),
    );
  }

  function addEntry() {
    write([...entries, { id: String(Date.now()), lockedCount: 0, chosen: [] }]);
  }

  function removeEntry(id: string) {
    if (entries.length <= 1) {
      write([{ id: entries[0]?.id ?? '1', lockedCount: 0, chosen: [] }]);
      return;
    }
    write(entries.filter((entry) => entry.id !== id));
  }

  function applyBpa() {
    const locks = entries.map((entry) =>
      bpaLocks(entry.chosen, entry.lockedCount, board.seasonRows, board.currentWeek),
    );
    const { paths: nextPaths } = buildEntryPaths(board.seasonRows, invert, locks);
    write(
      entries.map((entry, i) => {
        const slots = nextPaths[i]?.slots ?? [];
        const lock = locks[i] ?? [];
        const chosen = slots.map((slot, week) => lock[week] ?? slot?.team ?? '');
        return { ...entry, chosen };
      }),
    );
  }

  return (
    <div>
      <div className="surv-picks-toolbar">
        <button
          type="button"
          className="td-refresh"
          onClick={applyBpa}
          title="Recalculate leftover weeks across all tickets into an even split of the best remaining path"
        >
          Best Path Available
        </button>
      </div>
      <p className="subtitle">
        Pick a team, then lock it to move the dropdown to the next week. Unlock a week to edit it again — later weeks
        keep their last pick. Leftover weeks are dealt across tickets so no row hoards every top side. The number is
        that ticket’s chance of surviving the full slate (product of weekly odds; finished W/L count as 100%/0%). Independent weeks make long paths look small — we also show 1 in X.
      </p>
      <div className="sos-chart-wrap">
        <table className="sos-chart surv-season surv-picks-table">
          <thead>
            <tr>
              <th className="sos-chart-team">Entry</th>
              {board.weeks.map((w) => (
                <th key={w} className={w === board.currentWeek ? 'is-current' : undefined}>
                  <span className="surv-week-head">
                    <span className={`surv-current-label${w === board.currentWeek ? '' : ' is-ghost'}`}>
                      Current
                      <br />
                      Week
                    </span>
                    <span className="surv-week-num">{w}</span>
                  </span>
                </th>
              ))}
              <th className="surv-picks-end" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const path = paths[i];
              const cursor = entry.lockedCount + 1;
              const used = new Set(entry.chosen.slice(0, entry.lockedCount).filter(Boolean));
              return (
                <tr key={entry.id}>
                  <td className="sos-chart-team">
                    <div className="surv-entry-meta">
                      <strong>Entry {i + 1}</strong>
                      <span
                        className="subtitle"
                        title="Product of weekly win (or lose) odds. Finished weeks are 100% or 0%. Independent weeks → long products look small."
                      >
                        {formatSurviveProduct(path?.survive ?? null)} chance of survival
                      </span>
                      <button type="button" className="td-refresh" onClick={() => removeEntry(entry.id)}>
                        {entries.length <= 1 ? 'Clear' : 'Remove'}
                      </button>
                    </div>
                  </td>
                  {board.weeks.map((w) => {
                    const slot = path?.slots[w - 1] ?? null;
                    const locked = w <= entry.lockedCount;
                    const isCursor = w === cursor;
                    const chosenTeam = entry.chosen[w - 1] ?? '';
                    const weekOpts = optionsByWeek.get(w) ?? [];
                    const shown =
                      slot ??
                      (chosenTeam
                        ? {
                            week: w,
                            team: chosenTeam,
                            teamName: chosenTeam,
                            opp: '',
                            pct: 0,
                            result: null as 'W' | 'L' | null,
                          }
                        : null);
                    const shownOpt = shown
                      ? weekOpts.find((opt) => opt.team === shown.team)
                      : undefined;
                    if (isCursor) {
                      const selected = chosenTeam;
                      const opts = weekOpts.filter((opt) => !used.has(opt.team) || opt.team === selected);
                      if (selected && !opts.some((opt) => opt.team === selected)) {
                        opts.unshift({
                          team: selected,
                          teamName: selected,
                          pct: 0,
                          projPct: null,
                          opp: '',
                          result: null,
                          score: null,
                        });
                      }
                      const selectedOpt = opts.find((opt) => opt.team === selected);
                      const dropKey = `${entry.id}-${w}`;
                      return (
                        <td key={w}>
                          <div className="surv-pick-cell">
                            <PickDrop
                              week={w}
                              label={`Entry ${i + 1} week ${w} team`}
                              selected={selected}
                              selectedOpt={selectedOpt}
                              opts={opts}
                              open={openKey === dropKey}
                              onOpen={() => setOpenKey(dropKey)}
                              onClose={() => setOpenKey((key) => (key === dropKey ? null : key))}
                              onPick={(team) => setPick(entry.id, w, team)}
                            />
                            <LockControl
                              locked={false}
                              disabled={!selected}
                              onClick={() => lockWeek(entry.id)}
                              title={selected ? `Lock week ${w}` : 'Pick a team first'}
                              label={selected ? `Lock week ${w}` : `Week ${w} unlocked`}
                            />
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={w}>
                        <div className="surv-pick-cell">
                          {shown ? (
                            <PickSquare
                              team={shown.team}
                              opp={shownOpt?.opp ?? shown.opp}
                              pct={shown.pct}
                              result={shownOpt?.result ?? shown.result}
                              locked={locked}
                            />
                          ) : (
                            <PickSquare empty="—" />
                          )}
                          {locked ? (
                            <LockControl
                              locked
                              onClick={() => unlockWeek(entry.id, w)}
                              title={`Unlock week ${w}`}
                              label={`Unlock week ${w}`}
                            />
                          ) : (
                            <LockControl locked={false} />
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="surv-picks-end" aria-hidden="true" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="surv-add" onClick={addEntry}>
        + Add entry
      </button>
    </div>
  );
}
