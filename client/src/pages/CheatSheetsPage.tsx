import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PlayerCompareDialog from '../components/PlayerCompareDialog';
import { getCheatSheet } from '../services/api';
import type { CheatSheet, CheatSheetScoring, Position, RankedPlayer, RosterSettings } from '../types';
import { snakePath } from '../utils/snake';
import { statusBadge, valueChips } from '../utils/valueChips';

const STORAGE_KEY = 'dsafd-cheatsheet-v1';
const POS_FILTERS: Array<'ALL' | Position> = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'];
const DEFAULT_ROSTER: RosterSettings = {
  qb: 1,
  rb: 2,
  wr: 2,
  te: 1,
  flex: 1,
  superflex: 0,
  dst: 1,
  k: 1,
  bench: 5,
};

type SheetState = { picked: string[]; highlighted: string[]; mine: string[]; boardsCollapsed?: boolean };

type PickMarker = {
  overall: number;
  round: number;
  untilYou: number;
  beforeName: string | null;
};

type RosterColumn = { id: string; need: number; players: RankedPlayer[] };

function loadState(): SheetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { picked: [], highlighted: [], mine: [], boardsCollapsed: false };
    const parsed = JSON.parse(raw) as Partial<SheetState>;
    return {
      picked: Array.isArray(parsed.picked) ? parsed.picked.map(String) : [],
      highlighted: Array.isArray(parsed.highlighted) ? parsed.highlighted.map(String) : [],
      mine: Array.isArray(parsed.mine) ? parsed.mine.map(String) : [],
      boardsCollapsed: parsed.boardsCollapsed === true,
    };
  } catch {
    return { picked: [], highlighted: [], mine: [], boardsCollapsed: false };
  }
}

function saveState(state: SheetState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function upcomingPickMarkers(
  path: number[],
  board: RankedPlayer[],
  picked: Set<string>,
  pos: 'ALL' | Position
): PickMarker[] {
  if (path.length === 0 || board.length === 0) return [];
  const remaining = board.filter((p) => !picked.has(p.playerName));
  if (remaining.length === 0) return [];
  const nextOverall = board.length - remaining.length + 1;
  return path
    .map((overall, i) => ({ overall, round: i + 1, untilYou: overall - nextOverall }))
    .filter((m) => m.untilYou >= 0)
    .map((m) => ({
      ...m,
      beforeName:
        remaining.find((p, i) => i >= m.untilYou && (pos === 'ALL' || p.position === pos))
          ?.playerName ?? null,
    }));
}

function takeFrom(queue: RankedPlayer[], n: number): RankedPlayer[] {
  return queue.splice(0, Math.max(0, n));
}

function assignRoster(players: RankedPlayer[], roster: RosterSettings): RosterColumn[] {
  const queues: Record<Position, RankedPlayer[]> = { QB: [], RB: [], WR: [], TE: [], K: [], 'D/ST': [] };
  for (const p of players) queues[p.position].push(p);
  const qb = takeFrom(queues.QB, roster.qb);
  const sfNeed = roster.superflex ?? 0;
  const sf = takeFrom(queues.QB, sfNeed);
  const rb = takeFrom(queues.RB, roster.rb);
  const wr = takeFrom(queues.WR, roster.wr);
  const te = takeFrom(queues.TE, roster.te);
  const k = takeFrom(queues.K, roster.k);
  const dst = takeFrom(queues['D/ST'], roster.dst);
  const flexPool = [...queues.RB, ...queues.WR, ...queues.TE].sort((a, b) => a.rank - b.rank);
  const flex = takeFrom(flexPool, roster.flex);
  const bench = [...queues.QB, ...flexPool, ...queues.K, ...queues['D/ST']].sort((a, b) => a.rank - b.rank);
  const cols: RosterColumn[] = [
    { id: 'QB', need: roster.qb, players: qb },
    { id: 'RB', need: roster.rb, players: rb },
    { id: 'WR', need: roster.wr, players: wr },
    { id: 'TE', need: roster.te, players: te },
    { id: 'FLEX', need: roster.flex, players: flex },
  ];
  if (sfNeed > 0) cols.push({ id: 'SF', need: sfNeed, players: sf });
  cols.push(
    { id: 'D/ST', need: roster.dst, players: dst },
    { id: 'K', need: roster.k, players: k },
    { id: 'BN', need: roster.bench ?? 5, players: bench }
  );
  return cols;
}

export default function CheatSheetsPage() {
  const initial = loadState();
  const [sheet, setSheet] = useState<CheatSheet | null>(null);
  const [scoring, setScoring] = useState<CheatSheetScoring>('ppr');
  const [slot, setSlot] = useState<number | null>(null);
  const [pos, setPos] = useState<'ALL' | Position>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.picked));
  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set(initial.highlighted));
  const [mine, setMine] = useState<Set<string>>(() => new Set(initial.mine));
  const [boardsCollapsed, setBoardsCollapsed] = useState(() => initial.boardsCollapsed === true);
  const [inspectName, setInspectName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCheatSheet(scoring)
      .then((data) => {
        if (cancelled) return;
        setSheet(data);
        setSlot((prev) => prev ?? data.suggestedSlot);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scoring]);

  useEffect(() => {
    saveState({
      picked: [...picked],
      highlighted: [...highlighted],
      mine: [...mine],
      boardsCollapsed,
    });
  }, [picked, highlighted, mine, boardsCollapsed]);

  useEffect(() => {
    setHighlighted((prev) => {
      const next = new Set([...prev].filter((name) => !picked.has(name) && !mine.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [picked, mine]);

  const seat = sheet ? Math.min(Math.max(1, slot ?? sheet.suggestedSlot), sheet.leagueSize) : 8;
  const path = sheet ? snakePath(seat, sheet.leagueSize, sheet.rounds) : [];
  const roster = sheet?.roster ?? DEFAULT_ROSTER;

  const rows = useMemo(() => {
    const list = sheet?.players ?? [];
    if (pos === 'ALL') return list;
    return list.filter((p) => p.position === pos);
  }, [sheet, pos]);

  const offBoard = useMemo(() => {
    const next = new Set(picked);
    for (const name of mine) next.add(name);
    return next;
  }, [picked, mine]);

  const nextOverall = useMemo(() => {
    if (!sheet) return 1;
    return sheet.players.filter((p) => offBoard.has(p.playerName)).length + 1;
  }, [sheet, offBoard]);

  const left = rows.filter((p) => !offBoard.has(p.playerName)).length;
  const pickLines = useMemo(
    () => (sheet ? upcomingPickMarkers(path, sheet.players, offBoard, pos) : []),
    [sheet, path, offBoard, pos]
  );
  const linesByName = useMemo(() => {
    const map = new Map<string, PickMarker[]>();
    const atEnd: PickMarker[] = [];
    for (const marker of pickLines) {
      if (!marker.beforeName) {
        atEnd.push(marker);
        continue;
      }
      const list = map.get(marker.beforeName) ?? [];
      list.push(marker);
      map.set(marker.beforeName, list);
    }
    return { map, atEnd };
  }, [pickLines]);

  const myPlayers = useMemo(() => {
    if (!sheet) return [];
    return sheet.players.filter((p) => mine.has(p.playerName));
  }, [sheet, mine]);
  const rosterCols = useMemo(() => assignRoster(myPlayers, roster), [myPlayers, roster]);
  const watchPlayers = useMemo(() => {
    if (!sheet) return [];
    return sheet.players.filter((p) => highlighted.has(p.playerName));
  }, [sheet, highlighted]);

  function togglePicked(name: string) {
    if (mine.has(name)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleHighlight(name: string) {
    if (picked.has(name) || mine.has(name)) return;
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleMine(name: string) {
    const removing = mine.has(name);
    setMine((prev) => {
      const next = new Set(prev);
      if (removing) next.delete(name);
      else next.add(name);
      return next;
    });
    setPicked((prev) => {
      const next = new Set(prev);
      if (removing) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function clearMyTeam() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const name of mine) next.delete(name);
      return next;
    });
    setMine(new Set());
  }

  function clearWatchlist() {
    setHighlighted(new Set());
  }

  return (
    <section className="panel cheat-page">
      <div className="cheat-head">
        <h1 className="cheat-crumb">
          <Link to="/tools">Tools</Link>
          {' > '}
          Cheat Sheet
        </h1>
        {sheet?.note && <p className="subtitle">{sheet.note}</p>}
      </div>

      <div className={`cheat-sticky${boardsCollapsed ? ' is-collapsed' : ''}`}>
        <div className="cheat-boards" id="cheat-boards">
          <RosterSummary columns={rosterCols} onClear={clearMyTeam} />
          <WatchList
            players={watchPlayers}
            onInspect={(name) => setInspectName(name)}
            onRemove={toggleHighlight}
            onClear={clearWatchlist}
          />
        </div>

        <div className="cheat-toolbar">
        <div className="league-format-bar">
          <label className="league-format-field">
            Scoring
            <select
              value={scoring}
              onChange={(e) => setScoring(e.target.value as CheatSheetScoring)}
              disabled={loading}
            >
              <option value="ppr">PPR</option>
              <option value="standard">Standard</option>
            </select>
          </label>
          <label className="league-format-field">
            Pick
            <select
              value={seat}
              onChange={(e) => setSlot(Number(e.target.value))}
              disabled={!sheet}
            >
              {Array.from({ length: sheet?.leagueSize ?? 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Pick {n}
                </option>
              ))}
            </select>
          </label>
          <label className="league-format-field">
            Players
            <select
              value={pos}
              onChange={(e) => setPos(e.target.value as 'ALL' | Position)}
            >
              {POS_FILTERS.map((p) => (
                <option key={p} value={p}>
                  {p === 'ALL' ? 'All' : p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="cheat-toolbar-actions">
          <span className="cheat-left">{left} left</span>
          <button type="button" className="cheat-clear" onClick={() => setPicked(new Set())}>
            Clear checks
          </button>
          <button
            type="button"
            className="cheat-clear"
            onClick={clearWatchlist}
            disabled={highlighted.size === 0}
          >
            Clear watchlist
          </button>
          <button
            type="button"
            className="cheat-collapse"
            aria-expanded={!boardsCollapsed}
            aria-controls="cheat-boards"
            aria-label={
              boardsCollapsed ? 'Expand My team and watch list' : 'Collapse My team and watch list'
            }
            onClick={() => setBoardsCollapsed((v) => !v)}
          >
            {boardsCollapsed ? 'v' : '^'}
          </button>
        </div>
      </div>
      </div>

      {loading && <p className="status">Loading board…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <ul className="cheat-list">
          {rows.map((player) => (
            <Fragment key={player.playerName}>
              {(linesByName.map.get(player.playerName) ?? []).map((marker) => (
                <PickLine key={marker.overall} marker={marker} />
              ))}
              <CheatRow
                player={player}
                picked={picked.has(player.playerName) || mine.has(player.playerName)}
                locked={mine.has(player.playerName)}
                highlighted={highlighted.has(player.playerName)}
                mine={mine.has(player.playerName)}
                currentOverall={offBoard.has(player.playerName) ? undefined : nextOverall}
                onToggle={() => togglePicked(player.playerName)}
                onHighlight={() => toggleHighlight(player.playerName)}
                onMine={() => toggleMine(player.playerName)}
                onInspect={() => setInspectName(player.playerName)}
              />
            </Fragment>
          ))}
          {linesByName.atEnd.map((marker) => (
            <PickLine key={marker.overall} marker={marker} />
          ))}
        </ul>
      )}
      {inspectName && (
        <PlayerCompareDialog
          solo
          leftName={inspectName}
          closeLabel="Close"
          onClose={() => setInspectName(null)}
        />
      )}
    </section>
  );
}

function RosterSummary({
  columns,
  onClear,
}: {
  columns: RosterColumn[];
  onClear: () => void;
}) {
  return (
    <div className="cheat-roster">
      <div className="cheat-roster-head">
        <strong>My team</strong>
        <button type="button" className="cheat-clear" onClick={onClear}>
          Clear my team
        </button>
      </div>
      <div className="cheat-roster-cols">
        {columns.map((col) => {
          const rows = Math.max(col.need, col.players.length);
          return (
            <div key={col.id} className="cheat-roster-col">
              <strong>{col.id}</strong>
              {Array.from({ length: rows }, (_, i) => {
                const player = col.players[i];
                const over = i >= col.need;
                if (!player) {
                  return (
                    <span key={`${col.id}-empty-${i}`} className="cheat-roster-name is-empty">
                      —
                    </span>
                  );
                }
                return (
                  <span
                    key={player.playerName}
                    className={`cheat-roster-name${over ? ' is-over' : ''}`}
                    title={`${player.playerName} · ${player.position}${player.posRank ?? ''} · ESPN #${player.rank}`}
                  >
                    <span
                      className={`cheat-roster-rank pos-${player.position.replace('/', '')}`}
                    >
                      {player.posRank ?? player.rank}
                    </span>
                    <span className="cheat-roster-player">{player.playerName}</span>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WatchList({
  players,
  onInspect,
  onRemove,
  onClear,
}: {
  players: RankedPlayer[];
  onInspect: (name: string) => void;
  onRemove: (name: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="cheat-watch">
      <div className="cheat-roster-head">
        <strong>Watch list</strong>
        <button type="button" className="cheat-clear" onClick={onClear} disabled={players.length === 0}>
          Clear watchlist
        </button>
      </div>
      <div className="cheat-watch-body">
        {players.length === 0 && <p className="cheat-watch-empty">Right-click a name</p>}
        {players.map((player) => (
          <div key={player.playerName} className="cheat-watch-row">
            <button
              type="button"
              className="cheat-watch-open"
              onClick={() => onInspect(player.playerName)}
              title={`${player.playerName} · ${player.position}${player.posRank ?? ''} · ESPN #${player.rank}`}
            >
              <span className={`pos-pill pos-${player.position.replace('/', '')}`}>{player.position}</span>
              <span className="cheat-watch-name">{player.playerName}</span>
            </button>
            <button
              type="button"
              className="cheat-watch-remove"
              aria-label={`Remove ${player.playerName} from watch list`}
              onClick={() => onRemove(player.playerName)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PickLine({ marker }: { marker: PickMarker }) {
  const onClock = marker.untilYou === 0;
  const label = onClock
    ? `On the clock · R${marker.round} · overall ${marker.overall}`
    : `Your pick · ${marker.untilYou} to go · R${marker.round} · overall ${marker.overall}`;
  return (
    <li
      className={`cheat-pick-line${onClock ? ' is-clock' : ''}`}
      role="separator"
      aria-label={label}
    >
      <span>{onClock ? 'On the clock' : `R${marker.round}`}</span>
      <span className="cheat-pick-meta">
        {onClock
          ? `#${marker.overall}`
          : `${marker.untilYou} to go · #${marker.overall}`}
      </span>
    </li>
  );
}

function CheatRow({
  player,
  picked,
  locked,
  highlighted,
  mine,
  currentOverall,
  onToggle,
  onHighlight,
  onMine,
  onInspect,
}: {
  player: RankedPlayer;
  picked: boolean;
  locked: boolean;
  highlighted: boolean;
  mine: boolean;
  currentOverall?: number;
  onToggle: () => void;
  onHighlight: () => void;
  onMine: () => void;
  onInspect: () => void;
}) {
  const badge = statusBadge(player.status);
  const chips = valueChips(player, 3, { currentOverall });
  const struck = picked && !mine;
  return (
    <li>
      <div
        className={`cheat-row${struck ? ' is-picked' : ''}${highlighted ? ' is-highlighted' : ''}${mine ? ' is-mine' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          onHighlight();
        }}
      >
        <button
          type="button"
          className={`cheat-check${picked ? ' is-on' : ''}`}
          aria-pressed={picked}
          disabled={locked}
          title={locked ? `Remove ${player.playerName} from my team with × first` : undefined}
          aria-label={
            locked
              ? `${player.playerName} is on your team. Use × to undo.`
              : picked
                ? `Mark ${player.playerName} available`
                : `Mark ${player.playerName} picked`
          }
          onClick={onToggle}
        />
        <button type="button" className="cheat-open" onClick={onInspect}>
          <span className={`pos-pill pos-${player.position.replace('/', '')}`}>{player.position}</span>
          <span className="cheat-name">
            <span className="cheat-rank-pill">{player.rank}</span>
            <strong>{player.playerName}</strong>
            {player.nflTeam && <span className="cheat-team">{player.nflTeam}</span>}
            {badge && (
              <span className="status-badge" title={badge.title}>
                {badge.label}
              </span>
            )}
          </span>
          <span className="value-chip-row">
            {chips.map((chip) => (
              <span key={chip.text} className={`value-chip ${chip.tone}`} title={chip.title}>
                {chip.text}
              </span>
            ))}
          </span>
        </button>
        <button
          type="button"
          className={`cheat-mine${mine ? ' is-on' : ''}`}
          aria-pressed={mine}
          aria-label={mine ? `Remove ${player.playerName} from my team` : `Add ${player.playerName} to my team`}
          onClick={onMine}
        >
          {mine ? '×' : '✓'}
        </button>
      </div>
    </li>
  );
}
