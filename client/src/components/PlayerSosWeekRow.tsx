import { useLayoutEffect, useRef } from 'react';
import type { PlayerSosWeek } from '../types';
import { rankHeat } from '../utils/heatScale';

export type SosTrack = {
  id: string;
  label: string;
  /** Hover text for the track label (e.g. BLENDED explanation). */
  labelTitle?: string;
  weeks: PlayerSosWeek[];
  /**
   * How `rank` is stored:
   * - `easiest` (default): Source B — 1 = easiest (invert for OPRK-style display)
   * - `oprk`: already ESPN OPRK — 1 = toughest (display as-is)
   */
  scale?: 'easiest' | 'oprk';
};

function invertRank(rank: number, teams = 32): number {
  return teams + 1 - rank;
}

function SosWeekCell({
  cell,
  scale,
}: {
  cell: PlayerSosWeek;
  scale: 'easiest' | 'oprk';
}) {
  if (cell.bye || !cell.opponent) {
    return <span className="sos-match bye">BYE</span>;
  }
  const label = cell.home === false ? `@${cell.opponent}` : cell.opponent;
  const oprkStyle = scale === 'oprk';
  const shown =
    cell.rank == null ? undefined : oprkStyle ? cell.rank : invertRank(cell.rank);
  // Heat always uses easiest-first scale (1 = green).
  const heatRank =
    cell.rank == null ? undefined : oprkStyle ? invertRank(cell.rank) : cell.rank;
  return (
    <span
      className="sos-match"
      style={rankHeat(heatRank)}
      title={
        shown != null
          ? `${label} · matchup ${shown} (1 toughest, 32 easiest)`
          : label
      }
    >
      <span className="sos-match-opp">{label}</span>
      <span className="sos-match-n">{shown ?? '—'}</span>
    </span>
  );
}

function weekMap(weeks: PlayerSosWeek[]): Map<number, PlayerSosWeek> {
  return new Map(weeks.map((w) => [w.week, w]));
}

/** Remaining-slate SOS strip (current week → end); sticky league label at left. */
export default function PlayerSosWeekRow({
  weeks,
  currentWeek,
  tracks,
  active = true,
}: {
  /** Single-track weeks (used when `tracks` is omitted). */
  weeks?: PlayerSosWeek[];
  currentWeek: number;
  /** Multi-track layout (e.g. BLENDED + ESPN). Week headers shared across rows. */
  tracks?: SosTrack[];
  /** When false (collapsed expand), skip scroll pinning until opened. */
  active?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const resolvedTracks: SosTrack[] =
    tracks && tracks.length > 0
      ? tracks
      : weeks
        ? [{ id: 'default', label: '', weeks, scale: 'easiest' }]
        : [];

  const weekNums = [
    ...new Set(resolvedTracks.flatMap((t) => t.weeks.map((w) => w.week))),
  ]
    .filter((w) => w >= currentWeek)
    .sort((a, b) => a - b);

  const weeksSig = weekNums.join('|');

  useLayoutEffect(() => {
    if (!active) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Remaining slate starts at current week — keep scroller at the left.
    scroller.scrollLeft = 0;
  }, [active, currentWeek, weeksSig]);

  if (weekNums.length === 0) {
    return <p className="mt-sos-empty">No schedule weeks.</p>;
  }

  const maps = resolvedTracks.map((t) => ({ track: t, byWeek: weekMap(t.weeks) }));
  const multi = resolvedTracks.length > 1 || Boolean(resolvedTracks[0]?.label);

  return (
    <div
      className={`player-sos mt-player-sos${multi ? ' is-multi' : ''}`}
      aria-label="Upcoming schedule"
    >
      <div className="mt-sos-strip-kicker">Upcoming Schedule:</div>
      <div className="mt-sos-strip-body">
        {multi && (
          <div className="mt-sos-strip-rail">
            {/* Spacer matches week-number row so ESPN lines up with squares. */}
            <div className="mt-sos-rail-spacer" aria-hidden />
            {maps.map(({ track }) => (
              <div
                key={track.id}
                className="mt-sos-track-label mt-sos-rail-label"
                title={track.labelTitle ?? track.label}
              >
                {track.label}
              </div>
            ))}
          </div>
        )}
        <div className="player-sos-scroller" ref={scrollerRef}>
          <div className="mt-sos-grid">
            <div className="mt-sos-grid-head">
              {weekNums.map((week) => {
                const isCurrent = week === currentWeek;
                return (
                  <span
                    key={week}
                    className={`player-sos-week-n${isCurrent ? ' is-current' : ''}`}
                    title={isCurrent ? `Current week ${week}` : undefined}
                  >
                    <span className="surv-week-num">{week}</span>
                  </span>
                );
              })}
            </div>
            {maps.map(({ track, byWeek }) => (
              <div key={track.id} className="mt-sos-track">
                <div className="player-sos-row">
                  {weekNums.map((week) => {
                    const cell = byWeek.get(week);
                    return (
                      <div
                        key={week}
                        className={`player-sos-week${week === currentWeek ? ' is-current' : ''}`}
                      >
                        {cell ? (
                          <SosWeekCell cell={cell} scale={track.scale ?? 'easiest'} />
                        ) : (
                          <span className="sos-match bye">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
