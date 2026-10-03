import { useEffect, useMemo, useRef, useState } from 'react';
import { getRouteBoard, replayRoute } from '../services/api';
import {
  featuredOpenings,
  firstThreeOpening,
  openingTooltip,
  otherOpenings,
  preferredOpening,
} from '../utils/opening';
import { statusBadge, valueChips } from '../utils/valueChips';
import PlayerCompareDialog from './PlayerCompareDialog';
import type {
  DraftRoute,
  DraftRouteBook,
  MarketBoard,
  MarketValueRow,
  OpeningPattern,
  Position,
  RankedPlayer,
  RouteBoardPlayer,
  RoutePick,
  SeatLabel,
  SlotRoutePlan,
} from '../types';

const seatText: Record<SeatLabel, string> = {
  edge: 'Best seat',
  trap: 'Trap seat',
  turn: 'Turn value',
  early: 'Early pick',
  middle: 'Middle pick',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const KIND_ORDER = { steal: 0, pivot: 1, reach: 2 } as const;

function altKind(player: RankedPlayer, overall: number): 'steal' | 'reach' | 'pivot' {
  if (player.rank + 3 <= overall) return 'steal';
  if (player.rank > overall + 4) return 'reach';
  return 'pivot';
}

function sortOptionals<T extends { player: RankedPlayer }>(alts: T[], overall: number): T[] {
  return [...alts].sort((a, b) => {
    const byKind = KIND_ORDER[altKind(a.player, overall)] - KIND_ORDER[altKind(b.player, overall)];
    if (byKind !== 0) return byKind;
    return a.player.rank - b.player.rank;
  });
}

const POS_ORDER: Position[] = ['WR', 'RB', 'TE', 'QB', 'D/ST', 'K'];

function slotTooltip(s: SlotRoutePlan): string {
  return [
    `Pick ${s.slot} · ${seatText[s.seatLabel]}`,
    s.seatDetail,
    `Snake path ${s.snakePicks.join(' → ')}`,
    `${pct(s.historical.top3Rate)} top-3 historically`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function pickLine(player: RankedPlayer): string {
  const pos =
    player.posRank != null ? `${player.position}${player.posRank}` : player.position;
  const adp = player.adp ?? player.espnAdp;
  const adpText = adp != null ? ` · ADP ${Number.isInteger(adp) ? adp : adp.toFixed(1)}` : '';
  return `${pos} · ${player.nflTeam ?? 'FA'} · ESPN #${player.rank}${adpText}`;
}

function preserveRoundOptionals(
  next: DraftRoute,
  round: number,
  oldMain: RankedPlayer,
  prevAlts: NonNullable<RoutePick['alternates']>,
  chosenName: string
): DraftRoute {
  const kept = prevAlts.filter((alt) => alt.player.playerName !== chosenName);
  if (
    oldMain.playerName !== chosenName &&
    !kept.some((alt) => alt.player.playerName === oldMain.playerName)
  ) {
    kept.unshift({ player: oldMain, reason: 'Previous pick at this slot.' });
  }
  return {
    ...next,
    picks: next.picks.map((pick) =>
      pick.round === round ? { ...pick, alternates: kept } : pick
    ),
  };
}

function groupedBoard(players: RouteBoardPlayer[]): Array<{ pos: Position; players: RouteBoardPlayer[] }> {
  return POS_ORDER.map((pos) => ({
    pos,
    players: players.filter((p) => p.position === pos).sort((a, b) => a.rank - b.rank),
  })).filter((group) => group.players.length > 0);
}

const MARKET_POS: Array<'ALL' | Position> = ['ALL', 'QB', 'RB', 'WR', 'TE'];

function filterMarketRows(rows: MarketValueRow[], pos: 'ALL' | Position): MarketValueRow[] {
  if (pos === 'ALL') return rows;
  return rows.filter((row) => row.position === pos);
}

function signed(n: number | undefined, digits = 1): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function MarketTable({
  title,
  hint,
  rows,
  mode,
}: {
  title: string;
  hint: string;
  rows: MarketValueRow[];
  mode: 'ranks' | 'sleepers' | 'adp';
}) {
  return (
    <div className="market-block">
      <h3>
        {title} <span className="market-count">{rows.length}</span>
      </h3>
      <p className="subtitle">{hint}</p>
      {rows.length === 0 ? (
        <p className="subtitle">No names at this position.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              {mode === 'ranks' ? (
                <>
                  <th>ESPN</th>
                  <th>ECR</th>
                  <th>ESPN−ECR</th>
                  <th>Sleeper gap</th>
                  <th>Spread</th>
                  <th>Landmine</th>
                </>
              ) : mode === 'sleepers' ? (
                <>
                  <th>ECR</th>
                  <th>ESPN</th>
                  <th>Sleeper gap</th>
                  <th>Spread</th>
                </>
              ) : (
                <>
                  <th>ESPN ADP</th>
                  <th>Sleeper</th>
                  <th>Underdog</th>
                  <th>ESPN−Sleeper</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.playerName}`}>
                <td>{row.playerName}</td>
                <td>{row.position}</td>
                {mode === 'ranks' ? (
                  <>
                    <td>{row.espnRank ?? '—'}</td>
                    <td>{row.ecr ?? row.fantasyPros ?? '—'}</td>
                    <td className={(row.espnMinusEcr ?? 0) >= 0 ? 'val-good' : 'val-bad'}>
                      {signed(row.espnMinusEcr, 1)}
                    </td>
                    <td className={(row.ecrMinusAdp ?? 0) <= -8 ? 'val-good' : undefined}>
                      {signed(row.ecrMinusAdp, 1)}
                    </td>
                    <td>{row.expertSpread?.toFixed(1) ?? '—'}</td>
                    <td>{row.landmine?.toFixed(1) ?? '—'}</td>
                  </>
                ) : mode === 'sleepers' ? (
                  <>
                    <td>{row.ecr ?? '—'}</td>
                    <td>{row.espnRank ?? '—'}</td>
                    <td className="val-good">{signed(row.ecrMinusAdp, 1)}</td>
                    <td>{row.expertSpread?.toFixed(1) ?? '—'}</td>
                  </>
                ) : (
                  <>
                    <td>{row.espnAdp?.toFixed(1) ?? '—'}</td>
                    <td>{row.sleeperAdp?.toFixed(1) ?? '—'}</td>
                    <td>{row.underdogAdp?.toFixed(1) ?? '—'}</td>
                    <td className={(row.espnMinusSleeper ?? 0) >= 0 ? 'val-good' : 'val-bad'}>
                      {row.espnMinusSleeper == null
                        ? '—'
                        : `${row.espnMinusSleeper > 0 ? '+' : ''}${row.espnMinusSleeper.toFixed(1)}`}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function MarketPanel({
  market,
  showHeading = true,
  view = 'values',
}: {
  market: MarketBoard;
  showHeading?: boolean;
  view?: 'values' | 'landmines';
}) {
  const isLandmines = view === 'landmines';
  const [pos, setPos] = useState<'ALL' | Position>('ALL');
  const depth = market.draftDepth ?? 140;
  const rankRows = filterMarketRows(isLandmines ? market.landmines : market.values, pos);
  const sleeperRows = filterMarketRows(market.sleepers ?? [], pos);
  const adpRows = filterMarketRows(isLandmines ? market.adpLandmines : market.adpValues, pos);

  return (
    <section className="market-panel">
      {showHeading && <h2>{isLandmines ? 'Landmines' : 'Values'}</h2>}
      <p className="subtitle">
        {isLandmines
          ? `ESPN-room landmines across the first ${depth} picks (${market.ranksCount} ranked). Landmine is still the room metric (1 = steal, 10 = the queue will force him). Negative ESPN−ECR means this room ranks him earlier than industry ECR.`
          : `Industry sleepers vs ADP, then ESPN-room values, across the first ${depth} picks (${market.ranksCount} ranked). Sleeper gap is ECR minus multi-site ADP (negative = experts like him more than ADP). ESPN−ECR positive = he slides in this room.`}
      </p>
      <div className="market-filters" role="tablist" aria-label="Filter by position">
        {MARKET_POS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pos === id}
            className={`page-tab${pos === id ? ' active' : ''}`}
            onClick={() => setPos(id)}
          >
            {id === 'ALL' ? 'All' : id}
          </button>
        ))}
      </div>
      <div className="market-grid">
        {isLandmines ? (
          <>
            <MarketTable
              title="ESPN-room landmines"
              hint="This queue ranks them earlier than industry ECR, or Landmine ≥ 6.2. Display metric only — not the path’s boom/bust score."
              rows={rankRows}
              mode="ranks"
            />
            <MarketTable
              title="ADP landmines on ESPN"
              hint="ESPN ADP is earlier than Sleeper — you pay up in this room."
              rows={adpRows}
              mode="adp"
            />
          </>
        ) : (
          <>
            <MarketTable
              title="Industry sleepers vs ADP"
              hint="ECR at least 8 spots ahead of mean ESPN/Sleeper/Yahoo/Underdog ADP."
              rows={sleeperRows}
              mode="sleepers"
            />
            <MarketTable
              title="ESPN-room values"
              hint="ESPN ranks them at least 8 spots later than industry ECR — steals in this room."
              rows={rankRows}
              mode="ranks"
            />
          </>
        )}
      </div>
    </section>
  );
}

interface Props {
  book: DraftRouteBook;
  showHeading?: boolean;
  teams?: number;
  formatId?: string;
}

function historicalOpeningsFor(book: DraftRouteBook, plan?: SlotRoutePlan): OpeningPattern[] {
  return [...(plan?.openings ?? []), ...(book.openings ?? [])];
}

export default function DraftRoutesView({
  book,
  showHeading = true,
  teams,
  formatId,
}: Props) {
  const defaultSlot = book.slots.some((s) => s.slot === book.suggestedSlot)
    ? book.suggestedSlot
    : book.slots[0]?.slot ?? 1;
  const [slot, setSlot] = useState(defaultSlot);
  const [opening, setOpening] = useState<string | null>(() =>
    preferredOpening(historicalOpeningsFor(book, book.slots.find((s) => s.slot === defaultSlot)))
  );
  const [route, setRoute] = useState<DraftRoute | null>(null);
  const routeRequest = useRef(0);
  const [swapPick, setSwapPick] = useState<RoutePick | null>(null);
  const [swapName, setSwapName] = useState('');
  const [swapQuery, setSwapQuery] = useState('');
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [board, setBoard] = useState<RouteBoardPlayer[]>(book.board ?? []);
  const [boardLoading, setBoardLoading] = useState((book.board?.length ?? 0) === 0);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [comparePick, setComparePick] = useState<RoutePick | null>(null);
  const [statsPick, setStatsPick] = useState<RoutePick | null>(null);

  const plan: SlotRoutePlan | undefined = useMemo(
    () => book.slots.find((s) => s.slot === slot),
    [book.slots, slot]
  );

  useEffect(() => {
    if ((book.board?.length ?? 0) > 0) {
      setBoard(book.board ?? []);
      setBoardLoading(false);
      setBoardError(null);
    }
  }, [book.board]);

  useEffect(() => {
    if (board.length > 0) return;
    let cancelled = false;
    setBoardLoading(true);
    getRouteBoard()
      .then((data) => {
        if (cancelled) return;
        setBoard(data.board ?? []);
        setBoardError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setBoardError(err instanceof Error ? err.message : 'Could not load the player list.');
      })
      .finally(() => {
        if (!cancelled) setBoardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [board.length]);

  useEffect(() => {
    if (!swapPick) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !swapBusy) closeSwap();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [swapPick, swapBusy]);

  function closeSwap() {
    setSwapPick(null);
    setSwapName('');
    setSwapQuery('');
    setSwapBusy(false);
    setSwapError(null);
    setComparePick(null);
  }

  async function loadRoute(
    nextOpening: string | null,
    locks: Array<{ round: number; playerName: string }>
  ): Promise<DraftRoute | null> {
    const gen = ++routeRequest.current;
    const data = await replayRoute({
      slot,
      opening: nextOpening ?? undefined,
      locks,
      teams,
      format: formatId,
    });
    if (gen !== routeRequest.current) return null;
    setRoute(data.route);
    if ((data.board?.length ?? 0) > 0) setBoard(data.board ?? []);
    return data.route;
  }

  useEffect(() => {
    const nextOpening = preferredOpening(historicalOpeningsFor(book, plan));
    setOpening(nextOpening);
    setRoute(null);
    closeSwap();
    if (!nextOpening) {
      setRoute(plan?.routes[0] ?? null);
      return;
    }
    void loadRoute(nextOpening, []);
    // Slot change only — opening clicks and pick locks load their own paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  async function applyPickChange(
    nextOpening: string | null,
    round: number,
    playerName: string,
    oldPick: RoutePick
  ): Promise<void> {
    const before = firstThreeOpening(route);
    const locks = locksThrough(round, playerName);
    let next = await loadRoute(nextOpening, locks);
    if (!next) return;
    next = preserveRoundOptionals(
      next,
      round,
      oldPick.player,
      oldPick.alternates ?? [],
      playerName
    );
    setRoute(next);
    if (round > 3) return;
    const after = firstThreeOpening(next);
    if (!after || after === before) return;
    setOpening(after);
    const replayed = await loadRoute(after, locks);
    if (!replayed) return;
    setRoute(
      preserveRoundOptionals(replayed, round, oldPick.player, oldPick.alternates ?? [], playerName)
    );
  }

  function onOpening(pattern: string) {
    closeSwap();
    setOpening(pattern);
    void loadRoute(pattern, []);
  }

  function onSlot(nextSlot: number) {
    if (nextSlot === slot) return;
    const nextPlan = book.slots.find((s) => s.slot === nextSlot);
    setSlot(nextSlot);
    setOpening(preferredOpening(historicalOpeningsFor(book, nextPlan)));
    setRoute(null);
    closeSwap();
  }

  function locksThrough(round: number, playerName: string): Array<{ round: number; playerName: string }> {
    if (!route) return [{ round, playerName }];
    const locks = route.picks
      .filter((p) => p.round < round)
      .map((p) => ({ round: p.round, playerName: p.player.playerName }));
    locks.push({ round, playerName });
    return locks;
  }

  function onAlternate(round: number, playerName: string) {
    if (!route) return;
    const oldPick = route.picks.find((p) => p.round === round);
    if (!oldPick) return;
    void applyPickChange(opening, round, playerName, oldPick);
  }

  function openSwap(pick: RoutePick) {
    setSwapPick(pick);
    setSwapName(pick.player.playerName);
    setSwapQuery('');
    setSwapError(null);
  }

  async function confirmSwap() {
    if (!swapPick || !swapName || !route) return;
    if (swapName === swapPick.player.playerName) {
      closeSwap();
      return;
    }
    setSwapBusy(true);
    setSwapError(null);
    try {
      await applyPickChange(opening, swapPick.round, swapName, swapPick);
      closeSwap();
    } catch (err) {
      setSwapBusy(false);
      setSwapError(err instanceof Error ? err.message : 'Could not swap that pick.');
    }
  }

  const historicalOpenings = historicalOpeningsFor(book, plan);
  const openings = featuredOpenings(historicalOpenings);
  const otherOpeningList = otherOpenings(historicalOpenings, opening);
  const featuredSet = new Set(openings.map((o) => o.pattern));
  const selectedOther = otherOpeningList.find((o) => o.pattern === opening);
  const otherActive = Boolean(opening && !featuredSet.has(opening));
  const display = route ?? (openings.length === 0 && otherOpeningList.length === 0 ? plan?.routes[0] : undefined);
  const swapOptions = useMemo(() => {
    const taken = new Set(
      (display?.picks ?? [])
        .filter((p) => swapPick != null && p.round < swapPick.round)
        .map((p) => p.player.playerName)
    );
    const q = swapQuery.trim().toLowerCase();
    return groupedBoard(
      board.filter((p) => {
        if (taken.has(p.playerName)) return false;
        if (!q) return true;
        return (
          p.playerName.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q) ||
          String(p.rank).includes(q)
        );
      })
    );
  }, [board, display, swapPick, swapQuery]);

  useEffect(() => {
    if (!swapPick) return;
    const names = swapOptions.flatMap((group) => group.players.map((p) => p.playerName));
    if (names.length > 0 && !names.includes(swapName)) {
      setSwapName(names[0]);
    }
  }, [swapPick, swapOptions, swapName]);

  if (book.slots.length === 0) {
    return (
      <p className="subtitle">
        Add ESPN PPR overall rankings for {book.season} to build pick-by-pick routes.
      </p>
    );
  }

  return (
    <section className="draft-routes">
      {showHeading && <h2>{book.season} routes</h2>}
      <p className="subtitle">
        {book.source} · {book.boardSize} players · {book.leagueSize}-team snake
        {book.rosterLabel ? ` · ${book.rosterLabel}` : ''}.{' '}
        {book.valueNote ?? 'Tap a backup to rebuild the rest of the draft.'}
      </p>

      <div className="slot-pills" role="tablist" aria-label="Draft slot">
        {book.slots.map((s) => (
          <button
            key={s.slot}
            type="button"
            role="tab"
            aria-selected={s.slot === slot}
            className={`slot-pill${s.slot === slot ? ' active' : ''}${s.seatLabel === 'edge' ? ' edge' : ''}${s.seatLabel === 'trap' ? ' trap' : ''}`}
            title={slotTooltip(s)}
            onClick={() => onSlot(s.slot)}
          >
            <span>Pick {s.slot}</span>
            <small>{pct(s.historical.top3Rate)} top-3</small>
          </button>
        ))}
      </div>

      {(openings.length > 0 || otherOpeningList.length > 0) && (
        <div className="opening-pills" role="tablist" aria-label="First three">
          {openings.map((o) => (
            <button
              key={o.pattern}
              type="button"
              className={`opening-pill${opening === o.pattern ? ' active' : ''}`}
              title={openingTooltip(o)}
              onClick={() => onOpening(o.pattern)}
            >
              <span>{o.pattern}</span>
              <small>{pct(o.top3Pct)} podium</small>
            </button>
          ))}
          {otherOpeningList.length > 0 && (
            <label
              className={`opening-pill opening-other${otherActive ? ' active' : ''}`}
              title={
                selectedOther
                  ? openingTooltip(selectedOther)
                  : 'Other first-three combinations from this seat'
              }
            >
              <div className="opening-other-copy">
                <span>{otherActive && selectedOther ? selectedOther.pattern : 'Other'}</span>
                <small>
                  {otherActive && selectedOther ? `${pct(selectedOther.top3Pct)} podium` : 'All other combos'}
                </small>
              </div>
              <select
                aria-label="Other openings"
                value={otherActive ? opening ?? '' : ''}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next) onOpening(next);
                }}
              >
                <option value="">{otherActive ? 'Other openings' : 'Other'}</option>
                {otherOpeningList.map((o) => (
                  <option key={o.pattern} value={o.pattern} title={openingTooltip(o)}>
                    {o.pattern} · {pct(o.top3Pct)} podium
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {plan && !display && <p className="status">Building path…</p>}

      {plan && display && (
        <>
          <div className={`seat-banner seat-${plan.seatLabel}`}>
            <strong>
              Pick {plan.slot} · {seatText[plan.seatLabel]}
            </strong>
            <p>{plan.seatDetail}</p>
            <p className="seat-meta">Snake path {plan.snakePicks.join(' → ')}</p>
          </div>

          <article className="route-card">
            <header>
              <div>
                <h3>
                  {opening || display.shape
                    ? `Podium opening from this seat: ${opening ?? display.shape}`
                    : display.name}
                </h3>
              </div>
              <span className="route-pts">
                {display.projectedPoints > 0 ? `${display.projectedPoints} proj` : ''}
              </span>
            </header>
            <p>{display.thesis}</p>
            <ol className="route-picks">
              {display.picks.map((pick) => (
                <li key={`${display.id}-${pick.round}-${pick.player.playerName}`}>
                  <div className="route-pick-main">
                    <div className="route-pick-meta">
                      <span>
                        R{pick.round} · {pick.overallPick}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="route-pick-player"
                      aria-label={`View ${pick.player.playerName} stats`}
                      onClick={() => setStatsPick(pick)}
                    >
                      {(() => {
                        const badge = statusBadge(pick.player.status);
                        return (
                      <div className="route-pick-id">
                        <strong>
                          {pick.player.playerName}
                          {badge && (
                            <span className="status-badge" title={badge.title}>
                              {badge.label}
                            </span>
                          )}
                        </strong>
                        <span className="route-rank">{pickLine(pick.player)}</span>
                      </div>
                        );
                      })()}
                      <span className="value-chip-row">
                        {valueChips(pick.player).map((chip) => (
                          <span key={chip.text} className={`value-chip ${chip.tone}`} title={chip.title}>
                            {chip.text}
                          </span>
                        ))}
                      </span>
                    </button>
                    <em>{pick.reason}</em>
                    {(pick.alternates?.length ?? 0) > 0 && (
                      <div className="route-alts">
                        <span className="route-alts-label">Optional</span>
                        {sortOptionals(pick.alternates ?? [], pick.overallPick).map((alt) => (
                          <button
                            key={alt.player.playerName}
                            type="button"
                            className={`route-alt ${altKind(alt.player, pick.overallPick)}`}
                            title={alt.reason}
                            onClick={() => onAlternate(pick.round, alt.player.playerName)}
                          >
                            {alt.player.position} {alt.player.playerName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="route-pick-side">
                    <div className="route-pick-foot">
                      <button
                        type="button"
                        className="route-swap"
                        onClick={() => setComparePick(pick)}
                      >
                        Compare
                      </button>
                      <button
                        type="button"
                        className="route-swap"
                        onClick={() => openSwap(pick)}
                      >
                        Swap
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </>
      )}

      {statsPick && (
        <PlayerCompareDialog
          solo
          leftName={statsPick.player.playerName}
          round={statsPick.round}
          onClose={() => setStatsPick(null)}
        />
      )}
      {comparePick && (
        <PlayerCompareDialog
          leftName={comparePick.player.playerName}
          round={comparePick.round}
          board={board}
          boardLoading={boardLoading}
          onClose={() => setComparePick(null)}
        />
      )}
      {swapPick && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!swapBusy) closeSwap();
          }}
          role="presentation"
        >
          <div
            className="dialog swap-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="swap-dialog-title">Swap R{swapPick.round} pick</h2>
            <p>
              Replace {swapPick.player.playerName} with anyone still available on this path.
              Later rounds and optionals rebuild after you confirm.
            </p>
            <label className="swap-field">
              Search
              <input
                type="search"
                value={swapQuery}
                onChange={(e) => setSwapQuery(e.target.value)}
                placeholder="Name, position, or rank"
                autoFocus
                disabled={swapBusy}
              />
            </label>
            <label className="swap-field">
              Available players
              <select
                value={swapName}
                onChange={(e) => setSwapName(e.target.value)}
                disabled={swapBusy || boardLoading || board.length === 0}
              >
                {swapOptions.map((group) => (
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
            {boardLoading && <p>Loading available players…</p>}
            {!boardLoading && board.length === 0 && (
              <p className="swap-error">
                {boardError ?? 'Couldn’t load the player list. Close this and try Swap again.'}
              </p>
            )}
            {!boardLoading && board.length > 0 && swapOptions.length === 0 && (
              <p className="swap-error">No remaining players match that search.</p>
            )}
            {swapError && <p className="swap-error">{swapError}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={closeSwap}
                disabled={swapBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void confirmSwap()}
                disabled={swapBusy || boardLoading || !swapName || board.length === 0}
              >
                {swapBusy ? 'Swapping…' : 'Confirm swap'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
