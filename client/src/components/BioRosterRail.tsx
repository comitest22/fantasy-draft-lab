import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { getFreeAgents } from '../services/api';
import type {
  FreeAgentPlayer,
  FreeAgentPosFilter,
  LineupSlot,
  MyTeamRosterPlayer,
  Position,
} from '../types';
import { statusBadge } from '../utils/valueChips';

const STARTER_SLOTS: LineupSlot[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
const BENCH_SLOTS: LineupSlot[] = ['BE', 'UNKNOWN'];
const IR_SLOTS: LineupSlot[] = ['IR'];

export type BioRailMode = 'roster' | 'available';

const AVAIL_POS: FreeAgentPosFilter[] = [
  'ALL',
  'QB',
  'RB',
  'WR',
  'TE',
  'FLEX',
  'D/ST',
  'K',
];

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

/** Starters → Bench → IR, same order as the My Team bio strip. */
export function rosterOrder(players: MyTeamRosterPlayer[]): MyTeamRosterPlayer[] {
  return [
    ...sectionPlayers(players, STARTER_SLOTS),
    ...sectionPlayers(players, BENCH_SLOTS),
    ...sectionPlayers(players, IR_SLOTS),
  ];
}

function PlayerSilhouette() {
  return (
    <svg
      className="mt-bio-rail-sil-icon"
      viewBox="0 0 40 40"
      width="40"
      height="40"
      aria-hidden
      focusable="false"
    >
      <circle cx="20" cy="14" r="7" fill="currentColor" />
      <path d="M6 36c1.5-8 7-12 14-12s12.5 4 14 12" fill="currentColor" />
    </svg>
  );
}

function posRailLabel(position: Position): string {
  return position === 'D/ST' ? 'DST' : position;
}

/** Keep strip labels on one line: abbreviate first name past 19 characters. */
export function railDisplayName(name: string): string {
  if (name.length <= 19) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const initial = parts[0].charAt(0).toUpperCase();
  if (!initial) return name;
  return `${initial}. ${parts.slice(1).join(' ')}`;
}

function formatRailProj(week: number | undefined, projectedPoints?: number | null): string {
  const wk = week != null && week > 0 ? week : '—';
  const proj =
    projectedPoints != null && !Number.isNaN(projectedPoints)
      ? Number(projectedPoints).toFixed(1)
      : '—';
  return `Wk ${wk} Proj: ${proj}`;
}

type RailPlayer = {
  key: string;
  name: string;
  position: Position;
  status?: string;
  title: string;
  projectedPoints?: number | null;
};

function BioRailPlayerButton({
  player,
  active,
  activeRef,
  currentWeek,
  onSelect,
}: {
  player: RailPlayer;
  active: boolean;
  activeRef?: Ref<HTMLButtonElement>;
  currentWeek?: number;
  onSelect: (name: string) => void;
}) {
  const posClass = `pos-${(player.position ?? 'UNK').replace('/', '')}`;
  const badge = statusBadge(player.status);
  return (
    <button
      ref={active ? activeRef : undefined}
      type="button"
      className={`mt-bio-rail-item${active ? ' is-active' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(player.name);
      }}
      aria-current={active ? 'true' : undefined}
      title={player.title}
    >
      <span className={`mt-bio-rail-sil ${posClass}`}>
        <PlayerSilhouette />
        {badge && (
          <span
            className={`status-badge status-badge-${badge.tone} mt-bio-rail-badge`}
            title={badge.title}
          >
            {badge.label}
          </span>
        )}
      </span>
      <span className="mt-bio-rail-name">{railDisplayName(player.name)}</span>
      <span className="mt-bio-rail-proj">
        {formatRailProj(currentWeek, player.projectedPoints)}
      </span>
      <span className={`pos-pill ${posClass}`}>{posRailLabel(player.position)}</span>
    </button>
  );
}

function sortByProj(players: FreeAgentPlayer[] | undefined | null): FreeAgentPlayer[] {
  return [...(players ?? [])].sort((a, b) => {
    const ap = a.projectedPoints;
    const bp = b.projectedPoints;
    const aMissing = ap == null || Number.isNaN(ap);
    const bMissing = bp == null || Number.isNaN(bp);
    if (aMissing && bMissing) return (a.name ?? '').localeCompare(b.name ?? '');
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (bp !== ap) return (bp as number) - (ap as number);
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}

/** Horizontal roster / free-agent strip under the My Team player bio. */
export default function BioRosterRail({
  players,
  activeName,
  onSelect,
  mode,
  onModeChange,
  availablePos,
  onAvailablePosChange,
  season,
  currentWeek,
  seedAvailable,
  onStripNamesChange,
  onAvailablePlayersChange,
  /**
   * Bump only from ‹ / ›. Strip does not scroll on tile click; on ‹ / › it only
   * nudges enough to keep the newly selected tile in view (no centering).
   */
  navScrollSignal = 0,
}: {
  players: MyTeamRosterPlayer[];
  activeName: string;
  onSelect: (name: string) => void;
  mode: BioRailMode;
  onModeChange: (mode: BioRailMode) => void;
  availablePos: FreeAgentPosFilter;
  onAvailablePosChange: (pos: FreeAgentPosFilter) => void;
  season?: number;
  currentWeek?: number;
  /** FA opened from Players / lineup strip — keep them in the rail if outside top-N. */
  seedAvailable?: FreeAgentPlayer | null;
  /** Current left/right strip order for ‹ / ›. */
  onStripNamesChange?: (names: string[]) => void;
  onAvailablePlayersChange?: (players: FreeAgentPlayer[]) => void;
  navScrollSignal?: number;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [faPlayers, setFaPlayers] = useState<FreeAgentPlayer[]>([]);
  const [faLoading, setFaLoading] = useState(false);
  const [faError, setFaError] = useState<string | null>(null);

  const starters = sectionPlayers(players, STARTER_SLOTS);
  const bench = sectionPlayers(players, BENCH_SLOTS);
  const ir = sectionPlayers(players, IR_SLOTS);

  useEffect(() => {
    if (mode !== 'available') return;
    let cancelled = false;
    setFaLoading(true);
    setFaError(null);
    // Reset leftover My Team scroll before FA tiles mount.
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    getFreeAgents(season, { position: availablePos, limit: 80 })
      .then((view) => {
        if (cancelled) return;
        setFaPlayers(sortByProj(view.players));
      })
      .catch((err) => {
        if (cancelled) return;
        setFaPlayers([]);
        setFaError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setFaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, availablePos, season]);

  const displayFa = useMemo(() => {
    if (
      !seedAvailable ||
      faPlayers.some(
        (p) => p.espnId === seedAvailable.espnId || p.name === seedAvailable.name
      )
    ) {
      return faPlayers;
    }
    return sortByProj([seedAvailable, ...faPlayers]);
  }, [faPlayers, seedAvailable]);

  const rosterKey = players.map((p) => `${p.espnId}:${p.lineupSlotId}:${p.name}`).join('|');
  const availableKey = displayFa.map((p) => `${p.espnId}:${p.name}`).join('|');
  const rosterNames = useMemo(
    () => rosterOrder(players).map((p) => p.name),
    // rosterKey captures identity; `players` alone is a new array each parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rosterKey]
  );
  const availableNames = useMemo(
    () => displayFa.map((p) => p.name),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableKey]
  );

  useLayoutEffect(() => {
    // Only ‹ / › bumps navScrollSignal. If the new tile is already fully visible,
    // leave scroll alone; otherwise nudge just enough to reveal it (listbox-style).
    // Never scrollIntoView (blows out the fixed shell).
    if (navScrollSignal <= 0) return;
    if (mode === 'available' && faLoading) return;

    function ensureActiveVisible() {
      const sc = scrollRef.current;
      const active = activeRef.current;
      if (!sc || !active) return;
      const scRect = sc.getBoundingClientRect();
      const elRect = active.getBoundingClientRect();
      let delta = 0;
      if (elRect.left < scRect.left) {
        delta = elRect.left - scRect.left;
      } else if (elRect.right > scRect.right) {
        delta = elRect.right - scRect.right;
      } else {
        return;
      }
      const max = Math.max(0, sc.scrollWidth - sc.clientWidth);
      const next = Math.min(max, Math.max(0, sc.scrollLeft + delta));
      if (next !== sc.scrollLeft) sc.scrollTo({ left: next, behavior: 'auto' });
    }

    ensureActiveVisible();
    const raf1 = requestAnimationFrame(() => {
      ensureActiveVisible();
      requestAnimationFrame(ensureActiveVisible);
    });
    return () => cancelAnimationFrame(raf1);
  }, [navScrollSignal, mode, faLoading]);

  useEffect(() => {
    onStripNamesChange?.(mode === 'roster' ? rosterNames : availableNames);
  }, [mode, rosterNames, availableNames, onStripNamesChange]);

  useEffect(() => {
    onAvailablePlayersChange?.(displayFa);
  }, [displayFa, onAvailablePlayersChange]);

  // After an Available strip context loads (mode → available, or pos chip
  // change): if the open player isn’t on this page, select the first FA.
  // Do NOT snap when activeName alone leaves the strip (depth-chart click /
  // external select) — that was sending users to the top-proj WR (e.g. Godwin).
  const stripContextRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'available') {
      stripContextRef.current = null;
      return;
    }
    if (faLoading || faError) return;
    if (displayFa.length === 0) return;
    const key = `${mode}:${availablePos}`;
    const contextChanged = stripContextRef.current !== key;
    stripContextRef.current = key;
    if (displayFa.some((p) => p.name === activeName)) return;
    if (!contextChanged) return;
    onSelect(displayFa[0].name);
  }, [mode, availablePos, faLoading, faError, displayFa, activeName, onSelect]);

  const availableRails: RailPlayer[] = useMemo(
    () =>
      displayFa.map((p) => ({
        key: `fa-${p.espnId}`,
        name: p.name,
        position: p.position ?? 'QB',
        status: p.status,
        projectedPoints: p.projectedPoints,
        title:
          p.projectedPoints != null
            ? `${p.name} · ${p.position ?? '?'} · Proj ${Number(p.projectedPoints).toFixed(1)}`
            : `${p.name} · ${p.position ?? '?'}`,
      })),
    [displayFa]
  );

  const posDisabled = mode !== 'available';

  return (
    <div className="mt-player-bio-rail-wrap">
      <div
        className="mt-bio-rail-source"
        aria-label="Bio strip source"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="mt-bio-rail-source-modes"
          role="tablist"
          aria-label="Roster or available"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'roster'}
            className={`mt-bio-rail-source-btn mt-bio-rail-source-btn-team${mode === 'roster' ? ' is-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onModeChange('roster');
            }}
          >
            My Team
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'available'}
            className={`mt-bio-rail-source-btn mt-bio-rail-source-btn-avail${mode === 'available' ? ' is-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onModeChange('available');
            }}
          >
            Available
          </button>
        </div>
        <div
          className={`mt-bio-rail-source-pos${posDisabled ? ' is-disabled' : ''}`}
          role="group"
          aria-label="Available position filter"
          aria-disabled={posDisabled}
        >
          {AVAIL_POS.map((id) => (
            <button
              key={id}
              type="button"
              className={`mt-bio-rail-pos-btn${mode === 'available' && availablePos === id ? ' is-active' : ''}`}
              disabled={posDisabled}
              onClick={(e) => {
                e.stopPropagation();
                onAvailablePosChange(id);
              }}
            >
              {id === 'ALL' ? 'All' : id === 'D/ST' ? 'DST' : id}
            </button>
          ))}
        </div>
      </div>

      <nav className="mt-player-bio-rail" aria-label={mode === 'roster' ? 'Roster players' : 'Available players'}>
        <div ref={scrollRef} className="mt-player-bio-rail-scroll">
          {mode === 'roster' ? (
            players.length === 0 ? (
              <p className="mt-bio-rail-empty">No roster players.</p>
            ) : (
              <>
                {starters.map((p) => (
                  <BioRailPlayerButton
                    key={`${p.espnId}-${p.lineupSlotId}`}
                    player={{
                      key: `${p.espnId}-${p.lineupSlotId}`,
                      name: p.name,
                      position: p.position,
                      status: p.status,
                      projectedPoints: p.projectedPoints,
                      title: statusBadge(p.status)
                        ? `${p.name} · ${p.lineupSlot} · ${statusBadge(p.status)!.title}`
                        : `${p.name} · ${p.lineupSlot}`,
                    }}
                    active={p.name === activeName}
                    activeRef={p.name === activeName ? activeRef : undefined}
                    currentWeek={currentWeek}
                    onSelect={onSelect}
                  />
                ))}
                {bench.length > 0 && (
                  <>
                    <div className="mt-bio-rail-divider" role="separator" aria-label="Bench">
                      <span className="mt-bio-rail-divider-line" />
                      <span className="mt-bio-rail-divider-label">Bench</span>
                      <span className="mt-bio-rail-divider-line" />
                    </div>
                    {bench.map((p) => (
                      <BioRailPlayerButton
                        key={`${p.espnId}-${p.lineupSlotId}`}
                        player={{
                          key: `${p.espnId}-${p.lineupSlotId}`,
                          name: p.name,
                          position: p.position,
                          status: p.status,
                          projectedPoints: p.projectedPoints,
                          title: statusBadge(p.status)
                            ? `${p.name} · ${p.lineupSlot} · ${statusBadge(p.status)!.title}`
                            : `${p.name} · ${p.lineupSlot}`,
                        }}
                        active={p.name === activeName}
                        activeRef={p.name === activeName ? activeRef : undefined}
                        currentWeek={currentWeek}
                        onSelect={onSelect}
                      />
                    ))}
                  </>
                )}
                {ir.length > 0 && (
                  <>
                    <div className="mt-bio-rail-divider" role="separator" aria-label="IR">
                      <span className="mt-bio-rail-divider-line" />
                      <span className="mt-bio-rail-divider-label">IR</span>
                      <span className="mt-bio-rail-divider-line" />
                    </div>
                    {ir.map((p) => (
                      <BioRailPlayerButton
                        key={`${p.espnId}-${p.lineupSlotId}`}
                        player={{
                          key: `${p.espnId}-${p.lineupSlotId}`,
                          name: p.name,
                          position: p.position,
                          status: p.status,
                          projectedPoints: p.projectedPoints,
                          title: statusBadge(p.status)
                            ? `${p.name} · ${p.lineupSlot} · ${statusBadge(p.status)!.title}`
                            : `${p.name} · ${p.lineupSlot}`,
                        }}
                        active={p.name === activeName}
                        activeRef={p.name === activeName ? activeRef : undefined}
                        currentWeek={currentWeek}
                        onSelect={onSelect}
                      />
                    ))}
                  </>
                )}
              </>
            )
          ) : faLoading && availableRails.length === 0 ? (
            <p className="mt-bio-rail-empty">Loading available…</p>
          ) : faError ? (
            <p className="mt-bio-rail-empty">{faError}</p>
          ) : availableRails.length === 0 ? (
            <p className="mt-bio-rail-empty">No available players.</p>
          ) : (
            availableRails.map((p) => (
              <BioRailPlayerButton
                key={p.key}
                player={p}
                active={p.name === activeName}
                activeRef={p.name === activeName ? activeRef : undefined}
                currentWeek={currentWeek}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      </nav>
    </div>
  );
}
