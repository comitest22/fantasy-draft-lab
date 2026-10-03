import { useEffect, useMemo, useState } from 'react';
import { getPlayerCompare } from '../services/api';
import type { PlayerCompare, Position, RouteBoardPlayer } from '../types';
import PlayerGameLog from './PlayerGameLog';
import { statusBadge } from '../utils/valueChips';

const POS_ORDER: Position[] = ['WR', 'RB', 'TE', 'QB', 'D/ST', 'K'];

function groupedBoard(players: RouteBoardPlayer[]) {
  return POS_ORDER.map((pos) => ({
    pos,
    players: players.filter((p) => p.position === pos).sort((a, b) => a.rank - b.rank),
  })).filter((group) => group.players.length > 0);
}

function fmtNum(n: number | undefined, digits = 1): string {
  if (n == null) return '—';
  return n.toFixed(digits);
}

function fmtRank(n: number | undefined): string {
  return n != null ? `#${n}` : '—';
}

interface CellVal {
  main: string;
  prior?: string;
  hint?: string;
}

function cell(main: string): CellVal {
  return { main };
}

function withPrior(main: string, prior: string | undefined, hint: string): CellVal {
  if (!prior) return { main };
  return { main, prior, hint };
}

function fmtPos(pos: Position | undefined, n: number | undefined): string {
  if (n == null) return '—';
  return `${pos ?? ''}${n}`;
}

type Tone = 'better' | 'mid' | 'worse' | 'same';
type MetricKey =
  | 'rank'
  | 'pos'
  | 'proj'
  | 'sos'
  | 'ecr'
  | 'espnMinusEcr'
  | 'sleeperGap'
  | 'landmine'
  | 'adpGap'
  | 'qb'
  | 'yearsQb'
  | 'offense'
  | 'oline'
  | 'lyPts'
  | 'lyRank'
  | 'lyPos'
  | 'lyAvg'
  | 'tyPts'
  | 'tyAvg';

const QUALITY: Record<MetricKey, { prefer: 'high' | 'low'; good: number; bad: number }> = {
  rank: { prefer: 'low', good: 12, bad: 48 },
  pos: { prefer: 'low', good: 12, bad: 24 },
  proj: { prefer: 'high', good: 240, bad: 160 },
  sos: { prefer: 'low', good: 8, bad: 33 },
  ecr: { prefer: 'low', good: 12, bad: 48 },
  espnMinusEcr: { prefer: 'high', good: 8, bad: -8 },
  sleeperGap: { prefer: 'low', good: -8, bad: 8 },
  landmine: { prefer: 'low', good: 4.6, bad: 6.5 },
  adpGap: { prefer: 'high', good: 3, bad: -3 },
  qb: { prefer: 'low', good: 8, bad: 18 },
  yearsQb: { prefer: 'high', good: 2, bad: 0 },
  offense: { prefer: 'low', good: 10, bad: 23 },
  oline: { prefer: 'low', good: 10, bad: 23 },
  lyPts: { prefer: 'high', good: 200, bad: 120 },
  lyRank: { prefer: 'low', good: 24, bad: 60 },
  lyPos: { prefer: 'low', good: 12, bad: 24 },
  lyAvg: { prefer: 'high', good: 16, bad: 11 },
  tyPts: { prefer: 'high', good: 18, bad: 6 },
  tyAvg: { prefer: 'high', good: 16, bad: 11 },
};

function tone(left?: number, right?: number, prefer: 'high' | 'low' = 'high'): Tone {
  if (left == null || right == null) return 'same';
  if (left === right) return 'same';
  const leftWins = prefer === 'high' ? left > right : left < right;
  return leftWins ? 'better' : 'worse';
}

function other(t: Tone): Tone {
  if (t === 'better') return 'worse';
  if (t === 'worse') return 'better';
  return 'same';
}

function quality(key: MetricKey, n: number | undefined, pos?: Position): Tone {
  if (n == null || !Number.isFinite(n)) return 'same';
  if ((pos === 'K' || pos === 'D/ST') && (key === 'proj' || key === 'rank' || key === 'lyPts' || key === 'lyAvg')) {
    return 'same';
  }
  const { prefer, good, bad } = QUALITY[key];
  if (prefer === 'low') {
    if (n <= good) return 'better';
    if (n >= bad) return 'worse';
    return 'mid';
  }
  if (n >= good) return 'better';
  if (n <= bad) return 'worse';
  return 'mid';
}

interface Row {
  label: string;
  left: CellVal;
  right: CellVal;
  leftTone: Tone;
  rightTone: Tone;
}

function ValueCell({ val, tone }: { val: CellVal; tone: Tone }) {
  return (
    <td>
      <span className={`compare-val ${tone}`}>{val.main}</span>
      {val.prior && (
        <span className="compare-prior" data-hint={val.hint}>
          {' '}
          ({val.prior})
        </span>
      )}
    </td>
  );
}

function rowsFor(left: PlayerCompare, right: PlayerCompare | null): Row[] {
  const p = left.player;
  const q = right?.player;
  const lastY = left.lastSeason ?? right?.lastSeason;
  const priorY = left.priorSeason ?? right?.priorSeason;
  const lastHint = lastY != null ? String(lastY) : 'Last year';
  const twoBackHint = priorY != null ? String(priorY) : 'Two years back';
  const pair = (
    label: string,
    key: MetricKey,
    lv: CellVal,
    rv: CellVal,
    ln?: number,
    rn?: number,
    prefer: 'high' | 'low' = 'high'
  ): Row => {
    if (right) {
      const leftTone = tone(ln, rn, prefer);
      return { label, left: lv, right: rv, leftTone, rightTone: other(leftTone) };
    }
    return {
      label,
      left: lv,
      right: rv,
      leftTone: quality(key, ln, p.position),
      rightTone: quality(key, rn, q?.position),
    };
  };

  return [
    pair(
      'ESPN rank',
      'rank',
      withPrior(
        fmtRank(p.rank),
        left.lastYearRank != null ? `#${left.lastYearRank}` : undefined,
        `${lastHint} overall PPR finish`
      ),
      withPrior(
        fmtRank(q?.rank),
        right?.lastYearRank != null ? `#${right.lastYearRank}` : undefined,
        `${lastHint} overall PPR finish`
      ),
      p.rank,
      q?.rank,
      'low'
    ),
    pair(
      'Pos rank',
      'pos',
      withPrior(
        fmtPos(p.position, left.posRank),
        left.lastYearPosRank != null ? `#${left.lastYearPosRank}` : undefined,
        `${lastHint} positional PPR finish`
      ),
      withPrior(
        fmtPos(q?.position, right?.posRank),
        right?.lastYearPosRank != null ? `#${right.lastYearPosRank}` : undefined,
        `${lastHint} positional PPR finish`
      ),
      left.posRank,
      right?.posRank,
      'low'
    ),
    pair(
      'Proj',
      'proj',
      cell(p.expectedPoints != null ? String(Math.round(p.expectedPoints)) : '—'),
      cell(q?.expectedPoints != null ? String(Math.round(q.expectedPoints)) : '—'),
      p.expectedPoints,
      q?.expectedPoints,
      'high'
    ),
    pair(
      'SOS',
      'sos',
      cell(p.sosRank != null ? `#${p.sosRank}` : '—'),
      cell(q?.sosRank != null ? `#${q.sosRank}` : '—'),
      p.sosRank,
      q?.sosRank,
      'low'
    ),
    pair(
      'ECR',
      'ecr',
      cell(p.ecr != null ? String(p.ecr) : '—'),
      cell(q?.ecr != null ? String(q.ecr) : '—'),
      p.ecr,
      q?.ecr,
      'low'
    ),
    pair(
      'ESPN − ECR',
      'espnMinusEcr',
      cell(p.espnMinusEcr == null ? '—' : `${p.espnMinusEcr > 0 ? '+' : ''}${p.espnMinusEcr.toFixed(1)}`),
      cell(q?.espnMinusEcr == null ? '—' : `${q.espnMinusEcr > 0 ? '+' : ''}${q.espnMinusEcr.toFixed(1)}`),
      p.espnMinusEcr,
      q?.espnMinusEcr,
      'high'
    ),
    pair(
      'Sleeper gap',
      'sleeperGap',
      cell(p.ecrMinusAdp == null ? '—' : `${p.ecrMinusAdp > 0 ? '+' : ''}${p.ecrMinusAdp.toFixed(1)}`),
      cell(q?.ecrMinusAdp == null ? '—' : `${q.ecrMinusAdp > 0 ? '+' : ''}${q.ecrMinusAdp.toFixed(1)}`),
      p.ecrMinusAdp,
      q?.ecrMinusAdp,
      'low'
    ),
    pair('Landmine', 'landmine', cell(fmtNum(p.landmine)), cell(fmtNum(q?.landmine)), p.landmine, q?.landmine, 'low'),
    pair(
      'ESPN ADP vs Sleeper',
      'adpGap',
      cell(p.espnMinusSleeper == null ? '—' : `${p.espnMinusSleeper > 0 ? '+' : ''}${p.espnMinusSleeper.toFixed(0)}`),
      cell(q?.espnMinusSleeper == null ? '—' : `${q.espnMinusSleeper > 0 ? '+' : ''}${q.espnMinusSleeper.toFixed(0)}`),
      p.espnMinusSleeper,
      q?.espnMinusSleeper,
      'high'
    ),
    pair(
      'QB',
      'qb',
      cell(left.qbName ? `${left.qbName}${left.qbRank != null ? ` · QB${left.qbRank}` : ''}` : '—'),
      cell(right?.qbName ? `${right.qbName}${right.qbRank != null ? ` · QB${right.qbRank}` : ''}` : '—'),
      left.qbRank,
      right?.qbRank,
      'low'
    ),
    pair(
      'Years with QB',
      'yearsQb',
      cell(left.yearsWithQb != null ? `${left.yearsWithQb}` : '—'),
      cell(right?.yearsWithQb != null ? `${right.yearsWithQb}` : '—'),
      left.yearsWithQb,
      right?.yearsWithQb,
      'high'
    ),
    pair(
      'Offense rank',
      'offense',
      withPrior(
        fmtRank(left.offenseRank),
        left.offenseRankPrev != null ? `#${left.offenseRankPrev}` : undefined,
        `${lastHint} offense rank`
      ),
      withPrior(
        fmtRank(right?.offenseRank),
        right?.offenseRankPrev != null ? `#${right.offenseRankPrev}` : undefined,
        `${lastHint} offense rank`
      ),
      left.offenseRank,
      right?.offenseRank,
      'low'
    ),
    pair(
      'O-line rank',
      'oline',
      withPrior(
        fmtRank(left.olineRank),
        left.olineRankPrev != null ? `#${left.olineRankPrev}` : undefined,
        `${lastHint} O-line rank`
      ),
      withPrior(
        fmtRank(right?.olineRank),
        right?.olineRankPrev != null ? `#${right.olineRankPrev}` : undefined,
        `${lastHint} O-line rank`
      ),
      left.olineRank,
      right?.olineRank,
      'low'
    ),
    pair(
      left.thisSeason ? `${left.thisSeason} YTD PPR` : 'This year PPR',
      'tyPts',
      cell(fmtNum(left.thisYearPoints, 1)),
      cell(fmtNum(right?.thisYearPoints, 1)),
      left.thisYearPoints,
      right?.thisYearPoints,
      'high'
    ),
    pair(
      left.thisSeason ? `${left.thisSeason} YTD avg/g` : 'This year avg/g',
      'tyAvg',
      cell(fmtNum(left.thisYearAvg, 1)),
      cell(fmtNum(right?.thisYearAvg, 1)),
      left.thisYearAvg,
      right?.thisYearAvg,
      'high'
    ),
    pair(
      left.lastSeason ? `${left.lastSeason} PPR pts` : 'Last year PPR',
      'lyPts',
      withPrior(
        fmtNum(left.lastYearPoints, 1),
        left.priorYearPoints != null ? fmtNum(left.priorYearPoints, 1) : undefined,
        `${twoBackHint} PPR points`
      ),
      withPrior(
        fmtNum(right?.lastYearPoints, 1),
        right?.priorYearPoints != null ? fmtNum(right.priorYearPoints, 1) : undefined,
        `${twoBackHint} PPR points`
      ),
      left.lastYearPoints,
      right?.lastYearPoints,
      'high'
    ),
    pair(
      left.lastSeason ? `${left.lastSeason} avg/g` : 'Last year avg/g',
      'lyAvg',
      withPrior(
        fmtNum(left.lastYearAvg, 1),
        left.priorYearAvg != null ? fmtNum(left.priorYearAvg, 1) : undefined,
        `${twoBackHint} avg per game`
      ),
      withPrior(
        fmtNum(right?.lastYearAvg, 1),
        right?.priorYearAvg != null ? fmtNum(right.priorYearAvg, 1) : undefined,
        `${twoBackHint} avg per game`
      ),
      left.lastYearAvg,
      right?.lastYearAvg,
      'high'
    ),
  ];
}

interface Props {
  leftName: string;
  round?: number;
  onClose: () => void;
  closeLabel?: string;
  solo?: boolean;
  board?: RouteBoardPlayer[];
  boardLoading?: boolean;
  variant?: 'dialog' | 'page';
}

function DepthChart({
  card,
}: {
  card: PlayerCompare;
}) {
  const chart = card.depthChart ?? [];
  if (chart.length === 0) return null;
  const team = card.depthChartTeam ?? card.player.nflTeam ?? '';
  const pos = card.player.position;
  const posClass = `pos-${pos.replace('/', '')}`;
  return (
    <div className="depth-chart">
      <h3>
        {team} {pos} depth
      </h3>
      <p className="depth-chart-note">ESPN rank order on this roster</p>
      <ol>
        {chart.map((entry) => {
          const badge = statusBadge(entry.status);
          const self = entry.playerName === card.player.playerName;
          return (
            <li
              key={entry.playerName}
              className={`depth-chart-row${self ? ' is-self' : ''}`}
            >
              <span className={`pos-pill ${posClass}`}>
                {pos}
                {entry.depth}
              </span>
              <span className="depth-chart-name">{entry.playerName}</span>
              <span className="depth-chart-meta">
                {badge && (
                  <span className="status-badge" title={badge.title}>
                    {badge.label}
                  </span>
                )}
                <span className="depth-chart-rank">#{entry.rank}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function PlayerCompareDialog({
  leftName,
  round,
  onClose,
  closeLabel,
  solo = false,
  board = [],
  boardLoading = false,
  variant = 'dialog',
}: Props) {
  const [left, setLeft] = useState<PlayerCompare | null>(null);
  const [right, setRight] = useState<PlayerCompare | null>(null);
  const [query, setQuery] = useState('');
  const [pickName, setPickName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    getPlayerCompare(leftName)
      .then((data) => {
        if (!cancelled) setLeft(data.card);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load that player.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leftName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupedBoard(
      board.filter((p) => {
        if (p.playerName === leftName) return false;
        if (!q) return true;
        return (
          p.playerName.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q) ||
          String(p.rank).includes(q)
        );
      })
    );
  }, [board, leftName, query]);

  useEffect(() => {
    const names = options.flatMap((g) => g.players.map((p) => p.playerName));
    if (names.length > 0 && !names.includes(pickName)) setPickName(names[0]);
  }, [options, pickName]);

  async function confirmRight() {
    if (!pickName) return;
    setBusy(true);
    setError(null);
    try {
      const data = await getPlayerCompare(pickName);
      setRight(data.card);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that player.');
    } finally {
      setBusy(false);
    }
  }

  function changePlayer() {
    setRight(null);
    setQuery('');
    setError(null);
  }

  const rows = left ? rowsFor(left, right) : [];
  const page = variant === 'page';
  const dismiss = closeLabel ?? (page ? 'Back to search' : 'Close');
  const title = solo ? (left?.player.playerName ?? leftName) : `Compare R${round} pick`;
  const subtitle = solo
    ? round != null
      ? `R${round} pick.`
      : ''
    : `${leftName} on the left. Search anyone on the board for the right side.`;

  const body = (
    <>
        <h2 id="compare-dialog-title">{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        <div className={`compare-heads${solo ? ' solo' : ''}`}>
          <div className="compare-head">
            <strong>{left?.player.playerName ?? leftName}</strong>
            <span>
              {left
                ? `${left.player.position} · ${left.player.nflTeam ?? 'FA'} · ESPN #${left.player.rank}`
                : busy
                  ? 'Loading…'
                  : ''}
            </span>
          </div>
          {!solo && (
          <div className="compare-head compare-head-pick">
            {right ? (
              <>
                <div className="compare-head-id">
                  <strong>{right.player.playerName}</strong>
                  <span>
                    {`${right.player.position} · ${right.player.nflTeam ?? 'FA'} · ESPN #${right.player.rank}`}
                  </span>
                </div>
                <button
                  type="button"
                  className="button secondary small compare-change"
                  onClick={changePlayer}
                  disabled={busy}
                >
                  Change player
                </button>
              </>
            ) : (
              <>
                <strong>Compare to</strong>
                <span>Search and confirm a player</span>
                <div className="compare-pick-tools">
                  <label className="swap-field">
                    Search
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Name, position, or rank"
                      autoFocus
                      disabled={busy || boardLoading}
                    />
                  </label>
                  <label className="swap-field">
                    Available players
                    <select
                      value={pickName}
                      onChange={(e) => setPickName(e.target.value)}
                      disabled={busy || boardLoading || board.length === 0}
                    >
                      {options.map((group) => (
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
                  {error && <p className="swap-error">{error}</p>}
                  <button
                    type="button"
                    className="button"
                    onClick={() => void confirmRight()}
                    disabled={busy || boardLoading || !pickName || board.length === 0}
                  >
                    {busy ? 'Loading…' : 'Confirm'}
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>

        {left && (
          <div className={`compare-split${solo ? ' solo' : ''}`}>
            <div className="compare-split-stats">
              <table className="compare-table">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <ValueCell val={row.left} tone={row.leftTone} />
                      {!solo && <ValueCell val={row.right} tone={row.rightTone} />}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={`depth-charts${right ? ' pair' : ''}`}>
                <DepthChart card={left} />
                {right && <DepthChart card={right} />}
              </div>
              {left.takeaways && left.takeaways.length > 0 && (
                <div className="player-takeaways">
                  <h3>Expert takeaways</h3>
                  {left.takeaways.map((t) => (
                    <p key={t.id}>
                      {t.claim}
                      {t.sources.length > 0 && (
                        <span className="player-takeaway-src">{t.sources.join(', ')}</span>
                      )}
                    </p>
                  ))}
                </div>
              )}
            </div>
            {solo && <PlayerGameLog name={leftName} />}
          </div>
        )}

        {(solo || right) && error && <p className="swap-error">{error}</p>}
        {!page && (
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
              {dismiss}
            </button>
          </div>
        )}
    </>
  );

  if (page) {
    return (
      <section className="compare-dialog solo compare-page" aria-labelledby="compare-dialog-title">
        {body}
      </section>
    );
  }

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onClose()} role="presentation">
      <div
        className={`dialog compare-dialog${solo ? ' solo' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
