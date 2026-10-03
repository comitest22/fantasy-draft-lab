import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PageTabs from '../components/PageTabs';
import PlayerCompareDialog from '../components/PlayerCompareDialog';
import { getTdStreakBoard } from '../services/api';
import type { TdCandidate, TdStreakBoard, TdWeekPick } from '../types';
import { pctHeat } from '../utils/heatScale';
import { assignPrimaries, pickAlternate, weekSurvival, type TdPrimarySlots } from '../utils/tdPath';

const views = [
  { id: 'path', label: 'Season path' },
  { id: 'board', label: 'Player board' },
];

const STORE = 'dsafd-td-streak-v1';

type Slot = 'primary' | 'primary2' | 'alternate';

type Store = {
  used: string[];
  altUsed: string[];
  slots: Record<string, string>;
  locked: string[];
};

const emptyStore = (): Store => ({ used: [], altUsed: [], slots: {}, locked: [] });

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE);
    const parsed = raw ? JSON.parse(raw) : {};
    const slots =
      parsed.slots && typeof parsed.slots === 'object' && !Array.isArray(parsed.slots)
        ? Object.fromEntries(Object.entries(parsed.slots).map(([k, v]) => [k, String(v)]))
        : {};
    return {
      used: Array.isArray(parsed.used) ? parsed.used.map(String) : [],
      altUsed: Array.isArray(parsed.altUsed) ? parsed.altUsed.map(String) : [],
      slots,
      locked: Array.isArray(parsed.locked) ? parsed.locked.map(String) : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(next: Store) {
  localStorage.setItem(STORE, JSON.stringify(next));
}

function slotKey(week: number, slot: Slot): string {
  return `${week}:${slot}`;
}

function gameId(player: TdCandidate | null | undefined): string | null {
  if (!player?.nflTeam) return null;
  const opp = (player.opp ?? '').replace(/^@/, '').replace(/\s*\(.*\)\s*$/, '').trim();
  if (!opp) return player.nflTeam;
  return [player.nflTeam, opp].sort().join('|');
}

export default function TdStreakPage() {
  const [board, setBoard] = useState<TdStreakBoard | null>(null);
  const [view, setView] = useState('path');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<Store>(loadStore);
  const [swap, setSwap] = useState<{ week: number; slot: Slot; label: string } | null>(null);
  const [swapName, setSwapName] = useState('');
  const [inspectName, setInspectName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTdStreakBoard()
      .then((data) => {
        if (cancelled) return;
        setBoard(data);
        setError(null);
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
  }, []);

  const retriedHist = useRef(false);

  useEffect(() => {
    if (!board || retriedHist.current) return;
    const hasHist = board.path.some((row) => row.options?.some((o) => o.totalGames != null || o.vsOppGames != null));
    if (hasHist) return;
    retriedHist.current = true;
    getTdStreakBoard()
      .then(setBoard)
      .catch(() => {});
  }, [board]);

  function toggle(list: 'used' | 'altUsed', name: string) {
    setStore((prev) => {
      const cur = prev[list];
      const next = {
        ...prev,
        [list]: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name],
      };
      saveStore(next);
      return next;
    });
  }

  const completedUsed = useMemo(
    () => completedStarterNames(board?.path ?? [], store.slots),
    [board, store.slots],
  );
  const burned = useMemo(() => new Set([...store.used, ...completedUsed]), [store.used, completedUsed]);

  const resolved = useMemo(() => {
    if (!board) return [];
    return resolvePath(board.path, store.slots, new Set(store.locked), burned);
  }, [board, store.slots, store.locked, burned]);

  const pathSurvive = useMemo(() => pathSurvival(resolved), [resolved]);
  const nextFive = useMemo(() => nextFiveSurvival(resolved), [resolved]);

  const starterWeekByName = useMemo(() => {
    const weeks = new Map<string, number>();
    for (const row of resolved) {
      if (row.primary) weeks.set(row.primary.playerName, row.row.week);
      if (row.primary2) weeks.set(row.primary2.playerName, row.row.week);
    }
    return weeks;
  }, [resolved]);

  const swapChoices = useMemo(() => {
    if (!swap) return [];
    const current = resolved.find((r) => r.row.week === swap.week);
    if (!current) return [];
    const pool = eligibleForSlot(current.row, swap.slot, current);
    const sitting =
      swap.slot === 'primary' ? current.primary : swap.slot === 'primary2' ? current.primary2 : current.alternate;
    let list =
      sitting && !pool.some((p) => p.playerName === sitting.playerName) ? [sitting, ...pool] : pool;
    const backup = swap.slot !== 'alternate' ? current.alternate : null;
    if (backup && !list.some((p) => p.playerName === backup.playerName)) list = [backup, ...list];
    return [...list].sort(sortSwapChoices);
  }, [swap, resolved]);

  const swapBackupName =
    swap && swap.slot !== 'alternate'
      ? resolved.find((r) => r.row.week === swap.week)?.alternate?.playerName
      : undefined;

  useEffect(() => {
    if (!swap) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSwap(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [swap]);

  function toggleLock(week: number, slot: Slot, player: TdCandidate) {
    setStore((prev) => {
      const key = slotKey(week, slot);
      const slots = { ...prev.slots };
      const used = new Set(prev.used);
      const locked = new Set(prev.locked);
      if (locked.has(key)) {
        locked.delete(key);
        delete slots[key];
        if (slot !== 'alternate') used.delete(player.playerName);
      } else {
        slots[key] = player.playerName;
        locked.add(key);
        if (slot !== 'alternate') {
          stealPrimarySlots(slots, key, player.playerName);
          used.add(player.playerName);
        }
        for (const other of [...locked]) {
          if (!slots[other]) locked.delete(other);
        }
      }
      const next = { ...prev, used: [...used], slots, locked: [...locked] };
      saveStore(next);
      return next;
    });
  }

  function setSlot(week: number, slot: Slot, playerName: string) {
    setStore((prev) => {
      const key = slotKey(week, slot);
      const weekRow = resolved.find((r) => r.row.week === week);
      const prevName =
        prev.slots[key] ??
        (slot === 'primary'
          ? weekRow?.primary?.playerName
          : slot === 'primary2'
            ? weekRow?.primary2?.playerName
            : weekRow?.alternate?.playerName);
      const slots = { ...prev.slots, [key]: playerName };
      if (slot !== 'alternate') {
        stealPrimarySlots(slots, key, playerName);
        const altKey = slotKey(week, 'alternate');
        const altName = prev.slots[altKey] ?? weekRow?.alternate?.playerName;
        if (altName && playerName === altName) {
          if (prevName && prevName !== playerName) slots[altKey] = prevName;
          else delete slots[altKey];
        }
      }
      const destLocked = prev.locked.includes(key);
      const locked = prev.locked.filter((k) => k === key || Boolean(slots[k]));
      let used = prev.used;
      if (slot !== 'alternate') {
        if (destLocked) {
          if (prevName) used = used.filter((n) => n !== prevName);
          if (!used.includes(playerName)) used = [...used, playerName];
        } else {
          const stillLocked = locked.some(
            (k) => (k.endsWith(':primary') || k.endsWith(':primary2')) && slots[k] === playerName,
          );
          if (!stillLocked) used = used.filter((n) => n !== playerName);
        }
      }
      const next = { ...prev, slots, locked, used };
      saveStore(next);
      return next;
    });
  }

  function refresh(week: number, slot: Slot) {
    if (!board) return;
    const current = resolved.find((r) => r.row.week === week);
    if (!current) return;
    const nextPlayer = nextForSlot(current.row, slot, current);
    if (!nextPlayer) return;
    setSlot(week, slot, nextPlayer.playerName);
  }

  function openSwap(week: number, slot: Slot, label: string, currentName?: string) {
    setSwapName(currentName ?? '');
    setSwap({ week, slot, label });
  }

  function applySwap() {
    if (!swap || !swapName) return;
    setSlot(swap.week, swap.slot, swapName);
    setSwap(null);
  }

  function applyBpa() {
    if (!board) return;
    setStore((prev) => {
      const keepKey = (key: string) => {
        const [weekStr, slot] = key.split(':');
        const week = Number(weekStr);
        if (prev.locked.includes(key)) return true;
        const row = board.path.find((r) => r.week === week);
        return Boolean(row && weekIsFinal(row) && (slot === 'primary' || slot === 'primary2'));
      };
      const dropped = new Set(
        Object.entries(prev.slots)
          .filter(([key, name]) => name && /:(primary|primary2)$/.test(key) && !keepKey(key))
          .map(([, name]) => name),
      );
      const slots = Object.fromEntries(Object.entries(prev.slots).filter(([key]) => keepKey(key)));
      const used = [...new Set([...prev.used.filter((name) => !dropped.has(name))])];
      const next = { ...prev, slots, used };
      saveStore(next);
      return next;
    });
  }

  if (loading) return <p className="status">Loading TD streak board...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!board) return null;

  return (
    <section className="panel">
      <div className="page-intro">
        <Link to="/strategy" className="back-link">
          ← Strategy
        </Link>
        <h1>TD Streak</h1>
        <p className="subtitle">{board.note}</p>
      </div>
      <PageTabs tabs={views} active={view} onChange={setView} label="TD streak view" />

      {view === 'path' && (
        <div className="td-path">
          <div>
            <div className="surv-picks-toolbar">
              <button
                type="button"
                className="page-tab"
                onClick={applyBpa}
                title="Recalculate leftover unlocked weeks around locked and finished starters into the best remaining survival path"
              >
                Best Path Available
              </button>
            </div>
            <div className="td-survival">
              <div className="td-survival-row">
                <span className="surv-chip" style={pctHeat(pathSurviveHeat(pathSurvive))}>
                  {formatTdSurvive(pathSurvive)}
                </span>
                <span>{survivalNote(resolved, pathSurvive)}</span>
              </div>
              <div className="td-survival-row">
                <span className="surv-chip" style={pctHeat(pathSurviveHeat(nextFive.product, nextFive.weeks.length || 5))}>
                  {formatTdSurvive(nextFive.product)}
                </span>
                <span>{nextFiveNote(nextFive)}</span>
              </div>
            </div>
          </div>
          {resolved.map(({ row, primary, primary2, alternate }) => {
            const second = row.week === 1;
            return (
            <article key={row.week} className="td-week">
              <h2>Week {row.week}</h2>
              <div className="td-picks">
                <PickCard
                  label={second ? 'Primary A' : 'Primary'}
                  player={primary}
                  locked={store.locked.includes(slotKey(row.week, 'primary'))}
                  onToggle={() => primary && toggleLock(row.week, 'primary', primary)}
                  onInspect={() => primary && setInspectName(primary.playerName)}
                  onRefresh={() => refresh(row.week, 'primary')}
                  onSwap={() => openSwap(row.week, 'primary', second ? 'Primary A' : 'Primary', primary?.playerName)}
                />
                {second ? (
                  <PickCard
                    label="Primary B"
                    player={primary2}
                    locked={store.locked.includes(slotKey(row.week, 'primary2'))}
                    onToggle={() => primary2 && toggleLock(row.week, 'primary2', primary2)}
                    onInspect={() => primary2 && setInspectName(primary2.playerName)}
                    onRefresh={() => refresh(row.week, 'primary2')}
                    onSwap={() => openSwap(row.week, 'primary2', 'Primary B', primary2?.playerName)}
                  />
                ) : null}
                <PickCard
                  label="Alternate"
                  player={alternate}
                  locked={store.locked.includes(slotKey(row.week, 'alternate'))}
                  onToggle={() => alternate && toggleLock(row.week, 'alternate', alternate)}
                  onInspect={() => alternate && setInspectName(alternate.playerName)}
                  onRefresh={() => refresh(row.week, 'alternate')}
                  onSwap={() => openSwap(row.week, 'alternate', 'Alternate', alternate?.playerName)}
                />
              </div>
            </article>
            );
          })}
        </div>
      )}

      {view === 'board' && (
        <div className="sos-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Player</th>
                <th>Pos</th>
                <th>Team</th>
                <th>TD%</th>
                <th>Hit</th>
                <th>Pos TDs</th>
                <th>Why this week</th>
              </tr>
            </thead>
            <tbody>
              {board.candidates.map((p) => {
                const gone = burned.has(p.playerName);
                return (
                  <tr key={p.playerName} className={gone ? 'is-used' : undefined}>
                    <td>
                      <button type="button" className="surv-team" onClick={() => toggle('used', p.playerName)}>
                        {gone ? 'Used' : 'Open'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="td-player-link" onClick={() => setInspectName(p.playerName)}>
                        {p.playerName}
                      </button>
                      {p.status && p.status !== 'ACTIVE' ? ` · ${p.status}` : ''}
                    </td>
                    <td>
                      {p.position}
                      {p.posRank != null ? p.posRank : ''}
                    </td>
                    <td>{p.nflTeam ?? '—'}</td>
                    <td>
                      {p.tdChance != null ? (
                        <span className="surv-chip" style={pctHeat(p.tdChance)}>
                          {Math.round(p.tdChance)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{p.hitRate != null ? `${Math.round(p.hitRate * 100)}%` : '—'}</td>
                    <td>{p.posTdShare != null ? `${Math.round(p.posTdShare * 100)}%` : '—'}</td>
                    <td>{p.reason ?? p.why}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {swap ? (
        <div className="dialog-backdrop" onClick={() => setSwap(null)} role="presentation">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="td-swap-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="td-swap-title">
              Swap week {swap.week} {swap.label}
            </h2>
            <p>
              {swap.slot === 'alternate'
                ? 'Sitting as backup does not use this player. They can still be a starter in another week. Tuesday locks whoever actually played.'
                : 'Starters are unique across the season. Picking a later-week starter moves them here. A backup elsewhere can still be suggested as a starter.'}
            </p>
            <label className="visually-hidden" htmlFor="td-swap-player">
              Player
            </label>
            <select
              id="td-swap-player"
              className="td-swap-select"
              value={swapName}
              onChange={(e) => setSwapName(e.target.value)}
              autoFocus
            >
              {swapChoices.length === 0 ? <option value="">No eligible players</option> : null}
              {groupSwapChoices(swapChoices).map((group) => (
                <optgroup key={group.pos} label={group.pos}>
                  {group.players.map((p) => (
                    <option key={p.playerName} value={p.playerName}>
                      {optionLabel(
                        p,
                        starterWeekByName.get(p.playerName) === swap.week
                          ? undefined
                          : starterWeekByName.get(p.playerName),
                        p.playerName === swapBackupName,
                      )}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setSwap(null)}>
                Cancel
              </button>
              <button type="button" className="button" onClick={applySwap} disabled={!swapName}>
                Swap
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {inspectName ? (
        <PlayerCompareDialog
          solo
          leftName={inspectName}
          closeLabel="Close"
          onClose={() => setInspectName(null)}
        />
      ) : null}
    </section>
  );
}

function stealPrimarySlots(slots: Record<string, string>, key: string, playerName: string) {
  for (const [other, name] of Object.entries(slots)) {
    if (other !== key && name === playerName && /:(primary|primary2)$/.test(other)) {
      delete slots[other];
    }
  }
}

function weekIsFinal(row: TdWeekPick): boolean {
  return (row.options ?? []).some((o) => o.scoredTd === true || o.scoredTd === false);
}

function completedStarterNames(path: TdWeekPick[], slots: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const row of path) {
    if (!weekIsFinal(row)) continue;
    const a = slots[slotKey(row.week, 'primary')] ?? row.primary?.playerName;
    if (a) names.add(a);
    if (row.week === 1) {
      const b = slots[slotKey(1, 'primary2')] ?? row.primary2?.playerName;
      if (b) names.add(b);
    }
  }
  return names;
}

function resolvePath(
  path: TdWeekPick[],
  slots: Record<string, string>,
  lockedKeys: Set<string>,
  burned: Set<string>,
): Array<{ row: TdWeekPick; primary: TdCandidate | null; primary2: TdCandidate | null; alternate: TdCandidate | null }> {
  function fromOptions(row: TdWeekPick, name: string | undefined): TdCandidate | null {
    if (!name) return null;
    return row.options?.find((o) => o.playerName === name) ?? null;
  }

  function hydrate(row: TdWeekPick, player: { playerName: string } | null | undefined): TdCandidate | null {
    if (!player) return null;
    return row.options?.find((o) => o.playerName === player.playerName) ?? null;
  }

  const locked = new Map<number, TdPrimarySlots>();
  const pinned = new Set<string>();
  for (const row of path) {
    const final = weekIsFinal(row);
    const p1 =
      lockedKeys.has(slotKey(row.week, 'primary')) || final
        ? fromOptions(row, slots[slotKey(row.week, 'primary')]) ?? (final ? hydrate(row, row.primary) : null)
        : null;
    const p2 =
      row.week === 1 && (lockedKeys.has(slotKey(row.week, 'primary2')) || final)
        ? fromOptions(row, slots[slotKey(row.week, 'primary2')]) ?? (final ? hydrate(row, row.primary2) : null)
        : null;
    const primary = p1 && !pinned.has(p1.playerName) ? p1 : null;
    if (primary) pinned.add(primary.playerName);
    const primary2 = p2 && !pinned.has(p2.playerName) ? p2 : null;
    if (primary2) pinned.add(primary2.playerName);
    if (primary || primary2) locked.set(row.week, { primary, primary2 });
  }

  const byWeek = new Map(path.map((row) => [row.week, row.options ?? []]));
  const banned = new Set(burned);
  for (const [key, name] of Object.entries(slots)) {
    if (!name) continue;
    if (/:(primary|primary2)$/.test(key)) banned.add(name);
  }
  const assigned = assignPrimaries(byWeek, 18, { locked, banned });

  const overlaid = path.map((row) => {
    const fill = assigned.get(row.week);
    const slotted1 = fromOptions(row, slots[slotKey(row.week, 'primary')]);
    const slotted2 = row.week === 1 ? fromOptions(row, slots[slotKey(row.week, 'primary2')]) : null;
    const primary = slotted1 ?? hydrate(row, fill?.primary);
    const primary2 = row.week === 1 ? slotted2 ?? hydrate(row, fill?.primary2) : null;
    return { row, primary, primary2 };
  });

  return overlaid.map(({ row, primary, primary2 }) => {
    const slottedAlt = fromOptions(row, slots[slotKey(row.week, 'alternate')]);
    const primaries = [primary, primary2].filter((p): p is TdCandidate => Boolean(p));
    const fitsHere = (p: TdCandidate | null) =>
      Boolean(
        p &&
          p.playerName !== primary?.playerName &&
          p.playerName !== primary2?.playerName &&
          sameGameOk(p, primary) &&
          sameGameOk(p, primary2),
      );
    const alternate =
      (fitsHere(slottedAlt) ? slottedAlt : null) ??
      hydrate(row, pickAlternate(row.options ?? [], primaries, burned));
    return { row, primary, primary2, alternate };
  });
}

function sameGameOk(player: TdCandidate | null, other: TdCandidate | null): boolean {
  if (!player || !other) return true;
  if (player.playerName === other.playerName) return false;
  if (player.nflTeam && other.nflTeam && player.nflTeam === other.nflTeam) return false;
  const a = gameId(player);
  const b = gameId(other);
  return !a || !b || a !== b;
}

function eligibleForSlot(
  row: TdWeekPick,
  slot: Slot,
  current: { primary: TdCandidate | null; primary2: TdCandidate | null; alternate: TdCandidate | null },
): TdCandidate[] {
  const options = row.options ?? [];
  const others: TdCandidate[] = [];
  if (slot !== 'primary' && current.primary) others.push(current.primary);
  if (slot !== 'primary2' && current.primary2) others.push(current.primary2);
  if (slot !== 'alternate' && current.alternate) others.push(current.alternate);
  const takenNames = new Set(others.map((p) => p.playerName));
  const takenTeams = new Set(others.map((p) => p.nflTeam).filter(Boolean) as string[]);
  const takenGames = new Set(others.map((p) => gameId(p)).filter(Boolean) as string[]);

  return options.filter((o) => {
    if (takenNames.has(o.playerName)) return false;
    if (o.nflTeam && takenTeams.has(o.nflTeam)) return false;
    const gid = gameId(o);
    if (gid && takenGames.has(gid)) return false;
    return true;
  });
}

function nextForSlot(
  row: TdWeekPick,
  slot: Slot,
  current: { primary: TdCandidate | null; primary2: TdCandidate | null; alternate: TdCandidate | null },
): TdCandidate | null {
  const pool = eligibleForSlot(row, slot, current);
  if (pool.length === 0) return null;
  const currentName =
    slot === 'primary' ? current.primary?.playerName : slot === 'primary2' ? current.primary2?.playerName : current.alternate?.playerName;
  const idx = pool.findIndex((o) => o.playerName === currentName);
  return pool[idx < 0 ? 0 : (idx + 1) % pool.length] ?? null;
}

function optionLabel(p: TdCandidate, starterWeek?: number, thisWeekBackup?: boolean): string {
  const match = p.opp ? ` ${p.opp}` : '';
  const chance = p.tdChance != null ? ` · ${Math.round(p.tdChance)}% to score` : '';
  const saved = starterWeek != null ? ` · week ${starterWeek} starter` : '';
  const backup = thisWeekBackup ? " · this week's backup" : '';
  return `${p.playerName} · ${p.position} ${p.nflTeam ?? ''}${match}${chance}${saved}${backup}`.replace(/\s+/g, ' ').trim();
}

const SWAP_POS = ['RB', 'WR', 'TE', 'QB'] as const;

function posOrder(pos?: string): number {
  const i = SWAP_POS.indexOf((pos ?? '') as (typeof SWAP_POS)[number]);
  return i < 0 ? SWAP_POS.length : i;
}

function sortSwapChoices(a: TdCandidate, b: TdCandidate): number {
  const pa = posOrder(a.position);
  const pb = posOrder(b.position);
  if (pa !== pb) return pa - pb;
  const chance = (b.tdChance ?? -1) - (a.tdChance ?? -1);
  if (chance) return chance;
  const ra = a.posRank ?? 99;
  const rb = b.posRank ?? 99;
  if (ra !== rb) return ra - rb;
  return a.playerName.localeCompare(b.playerName);
}

function groupSwapChoices(players: TdCandidate[]): Array<{ pos: string; players: TdCandidate[] }> {
  const groups: Array<{ pos: string; players: TdCandidate[] }> = [];
  for (const player of players) {
    const pos = SWAP_POS.includes(player.position as (typeof SWAP_POS)[number])
      ? player.position
      : player.position || 'Other';
    const last = groups[groups.length - 1];
    if (last && last.pos === pos) last.players.push(player);
    else groups.push({ pos, players: [player] });
  }
  return groups;
}

function matchupLabel(rank?: number): string | undefined {
  if (rank == null) return undefined;
  if (rank <= 8) return 'Favorable matchup';
  if (rank <= 16) return 'Slightly favorable';
  if (rank <= 24) return 'Average matchup';
  return 'Tough matchup';
}

function teamOddsLabel(player: TdCandidate): string | undefined {
  if (player.teamWinPct == null) return undefined;
  if (player.teamWinPct >= 58) return `${player.nflTeam} is a ${Math.round(player.teamWinPct)}% favorite`;
  if (player.teamWinPct <= 42) return `${player.nflTeam} is an underdog (${Math.round(player.teamWinPct)}%)`;
  return `${player.nflTeam} is about even (${Math.round(player.teamWinPct)}%)`;
}

function pathSurvival(
  resolved: Array<{ row: TdWeekPick; primary: TdCandidate | null; primary2: TdCandidate | null }>,
): number {
  let product = 1;
  for (const entry of resolved) {
    product *= weekSurvival(entry.row.week, entry.primary, entry.primary2);
  }
  return product;
}

function weekDecided(entry: { row: TdWeekPick; primary: TdCandidate | null; primary2: TdCandidate | null }): boolean {
  return entry.row.week === 1
    ? entry.primary?.scoredTd != null || entry.primary2?.scoredTd != null
    : entry.primary?.scoredTd != null;
}

function nextFiveSurvival(
  resolved: Array<{ row: TdWeekPick; primary: TdCandidate | null; primary2: TdCandidate | null }>,
): { product: number; weeks: number[] } {
  const start = resolved.findIndex((entry) => !weekDecided(entry));
  const window = start < 0 ? [] : resolved.slice(start, start + 5);
  let product = window.length ? 1 : 0;
  for (const entry of window) {
    product *= weekSurvival(entry.row.week, entry.primary, entry.primary2);
  }
  return { product, weeks: window.map((entry) => entry.row.week) };
}

function formatTdSurvive(product: number): string {
  if (!Number.isFinite(product) || product < 0) return '—';
  if (product === 0) return '0%';
  const pct = product * 100;
  const odds = product > 0 ? Math.round(1 / product) : 0;
  const oddsBit =
    odds >= 1_000_000 ? `1 in ${(odds / 1_000_000).toFixed(1)}M` : odds >= 10_000 ? `1 in ${Math.round(odds / 1000)}k` : odds >= 2 ? `1 in ${odds.toLocaleString()}` : '';
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return oddsBit ? `${pct.toFixed(3)}% · ${oddsBit}` : `${pct.toFixed(3)}%`;
  return oddsBit || `${pct.toExponential(1)}%`;
}

function pathSurviveHeat(product: number, weeks = 18): number {
  if (!Number.isFinite(product) || product <= 0) return 20;
  return Math.min(80, Math.max(20, Math.pow(product, 1 / Math.max(1, weeks)) * 100));
}

function survivalNote(
  resolved: Array<{ row: TdWeekPick; primary: TdCandidate | null; primary2: TdCandidate | null }>,
  product: number,
): string {
  const decided = resolved.filter((entry) =>
    entry.row.week === 1
      ? entry.primary?.scoredTd != null || entry.primary2?.scoredTd != null
      : entry.primary?.scoredTd != null,
  ).length;
  const rest = 18 - decided;
  if (product === 0) return 'This path is already dead — a finished week missed.';
  const base =
    decided > 0
      ? `chance the remaining ${rest} week${rest === 1 ? '' : 's'} survive, using made/missed results for finished weeks`
      : 'chance this path survives all 18 weeks from the starters below (week 1: either TD advances)';
  return `${base}. Anytime TDs compound, so even a strong path is a small number.`;
}

function nextFiveNote(nextFive: { product: number; weeks: number[] }): string {
  const n = nextFive.weeks.length;
  if (!n) return 'No upcoming weeks left on this path.';
  if (nextFive.product === 0) {
    return n === 1
      ? `week ${nextFive.weeks[0]} already missed.`
      : `the next ${n} weeks already include a miss (weeks ${nextFive.weeks[0]}–${nextFive.weeks[n - 1]}).`;
  }
  const range = n === 1 ? `week ${nextFive.weeks[0]}` : `weeks ${nextFive.weeks[0]}–${nextFive.weeks[n - 1]}`;
  return `chance the next ${n} week${n === 1 ? '' : 's'} survive (${range}).`;
}

function oppShort(opp?: string): string | undefined {
  if (!opp) return undefined;
  const cleaned = opp.replace(/^@/, '').replace(/\s*\(.*\)\s*$/, '').replace(/^(vs|at)\s+/i, '').trim();
  return cleaned || undefined;
}

function olineLabel(rank?: number): string | undefined {
  if (rank == null) return undefined;
  const n = Math.round(rank);
  const tone = n <= 10 ? 'strong' : n >= 23 ? 'weak' : 'average';
  return `OL #${n} (${tone})`;
}

function cardUnitLine(player: TdCandidate): string | undefined {
  const unit = [olineLabel(player.olineRank), player.mismatch].filter(Boolean);
  return unit.length ? unit.join(' · ') : undefined;
}

function cardStats(player: TdCandidate): string[] {
  const lines: string[] = [];
  const years = player.sampleYears ?? 5;
  const plus = Boolean(player.sampleYearsPlus);
  const yearBit = plus ? '5+ years' : years === 1 ? '1 year' : `${years} years`;
  const lastWindow = plus ? 'the last 5+ years' : years === 1 ? 'the last year' : `the last ${years} years`;
  if (player.totalGames) {
    const gameWord = player.totalGames === 1 ? 'game' : 'games';
    lines.push(`${player.totalTds ?? 0} TD in ${player.totalGames} ${gameWord} (${yearBit})`);
  }
  if (player.last5Games) {
    const gameWord = player.last5Games === 1 ? 'game' : 'games';
    lines.push(`${player.last5Tds ?? 0} TD in last ${player.last5Games} ${gameWord}`);
  }
  const opp = oppShort(player.opp);
  if (player.vsOppLine) {
    lines.push(player.vsOppLine);
  } else if (opp) {
    if (player.vsOppGames) {
      const pct = player.vsOppHitPct != null ? ` · ${Math.round(player.vsOppHitPct)}% of games` : '';
      const gameWord = player.vsOppGames === 1 ? 'game' : 'games';
      lines.push(`Career stats vs ${opp}: ${player.vsOppTds ?? 0} TD in ${player.vsOppGames} ${gameWord}${pct}`);
    } else if (player.totalGames) {
      lines.push(`Career stats vs ${opp}: no games in ${lastWindow}`);
    }
  }
  return lines;
}

function WeatherGlyph({ kind }: { kind: string }) {
  if (kind === 'dome') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M2.4 9.2C3.2 5.6 6 3.4 8 3.4s4.8 2.2 5.6 5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M1.8 9.4h12.4v1.2H1.8zM3 10.6v2.4h10v-2.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 3.4V9.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  if (kind === 'rain') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M5.2 7.2A2.6 2.6 0 0 1 7.6 5.4c.4-1.4 1.7-2.4 3.2-2.4A3.2 3.2 0 0 1 14 6.4c0 .2 0 .3-.1.5A2.4 2.4 0 0 1 13.4 11H5.6A2.6 2.6 0 0 1 5.2 7.2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M6 12.2v1.6M8.2 12.6v1.8M10.4 12.2v1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'snow') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M8 2.5v11M3.4 5.2l9.2 5.6M12.6 5.2 3.4 10.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'wind') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M2 6.2h8.2A2 2 0 1 0 8.4 4M2 8.6h10.2A2.1 2.1 0 1 1 10 11.2M2 11h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'cold') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M8 2.6v6.2M8 8.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M6.4 5.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 2.4v1.3M8 12.3v1.3M2.4 8h1.3M12.3 8h1.3M4 4l.9.9M11.1 11.1l.9.9M4 12l.9-.9M11.1 4.9l.9-.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockGlyph({ locked }: { locked: boolean }) {
  return locked ? (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path d="M5 7.2V5a3 3 0 0 1 6 0v2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.2" y="7" width="9.6" height="7.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path d="M5 7.2V5a3 3 0 1 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.2" y="7" width="9.6" height="7.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function RefreshGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path
        d="M13.2 8a5.2 5.2 0 1 1-1.55-3.68"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M13.2 2.4v3.2h-3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwapGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path
        d="M2.5 5.5h11M10.5 3 13.5 5.5 10.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 10.5h-11M5.5 8 2.5 10.5 5.5 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PickCard({
  label,
  player,
  locked,
  onToggle,
  onInspect,
  onRefresh,
  onSwap,
}: {
  label: string;
  player: TdCandidate | null;
  locked: boolean;
  onToggle: () => void;
  onInspect: () => void;
  onRefresh: () => void;
  onSwap: () => void;
}) {
  const resultClass =
    player?.scoredTd === true ? ' is-td-hit' : player?.scoredTd === false ? ' is-td-miss' : '';
  const stats = player ? cardStats(player) : [];
  const unit = player ? cardUnitLine(player) : undefined;
  const odds = player ? teamOddsLabel(player) : undefined;
  const lockLabel = locked ? 'Unlock' : 'Lock';
  return (
    <div className="td-card-wrap">
      <div className={`td-card${locked ? ' is-used' : ''}${resultClass}`}>
        <div className="td-card-top">
          <span className="subtitle">
            {label}
            {locked ? ' · locked' : ''}
            {player?.scoredTd === true ? ' · scored' : player?.scoredTd === false ? ' · no TD' : ''}
          </span>
        </div>
        {player ? (
          <div className="td-card-pick">
            <strong>
              <button type="button" className="td-player-link" onClick={onInspect}>
                <span
                  className={
                    player.scoredTd === true
                      ? 'td-name-ring is-hit'
                      : player.scoredTd === false
                        ? 'td-name-ring is-miss'
                        : undefined
                  }
                >
                  {player.playerName}
                </span>
              </button>{' '}
              <span className="sos-team-name">
                {player.position} · {player.nflTeam}
              </span>
            </strong>
            {player.venueSplit || player.matchupMeta || player.weather || unit || odds ? (
              <span className="td-card-head">
                {player.matchupMeta || player.weather ? (
                  <span className="td-card-meta td-card-kick">
                    {player.matchupMeta ? <span>{player.matchupMeta}</span> : null}
                    {player.weather ? (
                      <span className="td-weather" title={player.weather.label} aria-label={player.weather.label}>
                        <WeatherGlyph kind={player.weather.kind} />
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {player.venueSplit ? <span className="td-card-meta">{player.venueSplit}</span> : null}
                {unit ? <span className="td-card-meta">{unit}</span> : null}
                {odds ? <span className="td-card-meta">{odds}</span> : null}
              </span>
            ) : null}
            {player.tdChance != null ? (
              <span className="td-chance-row">
                <span className="surv-chip" style={pctHeat(player.tdChance)}>
                  {Math.round(player.tdChance)}% to score
                </span>
                {matchupLabel(player.matchupRank) ? (
                  <span className="subtitle">{matchupLabel(player.matchupRank)}</span>
                ) : null}
              </span>
            ) : null}
            {player.reason ? <span className="td-card-reason">{player.reason}</span> : null}
            {stats.length ? (
              <span className="td-card-stats">
                {stats.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            ) : null}
          </div>
        ) : (
          <strong>—</strong>
        )}
      </div>
      <div className="td-card-actions">
        <button
          type="button"
          className={`td-icon-btn${locked ? ' is-locked' : ''}`}
          onClick={onToggle}
          disabled={!player}
          title={lockLabel}
          aria-label={lockLabel}
        >
          <LockGlyph locked={locked} />
        </button>
        <button
          type="button"
          className="td-icon-btn"
          onClick={onRefresh}
          disabled={!player || locked}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshGlyph />
        </button>
        <button
          type="button"
          className="td-icon-btn"
          onClick={onSwap}
          disabled={!player || locked}
          title="Swap"
          aria-label="Swap"
        >
          <SwapGlyph />
        </button>
      </div>
    </div>
  );
}
