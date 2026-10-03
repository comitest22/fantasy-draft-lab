/** PoolGenius season-grid cells: upcoming `85% MIA`, completed `W @LA` / `L SF`. */

export type PgResult = 'W' | 'L';

export type PgFutureCell = {
  week: number;
  winPct: number | null;
  opp: string;
  bye: boolean;
  result: PgResult | null;
  score?: string | null;
  locked?: boolean;
};

export function isConvertedResultPct(winPct: number | null | undefined, result: PgResult | null | undefined): boolean {
  if (winPct == null || result == null) return false;
  return (result === 'W' && winPct === 100) || (result === 'L' && winPct === 0);
}

export function isKeptProjection(winPct: number | null | undefined, result: PgResult | null | undefined): boolean {
  if (winPct == null || !Number.isFinite(winPct)) return false;
  return !isConvertedResultPct(winPct, result);
}

export function stripResultOpp(raw?: string): string {
  return (raw ?? '')
    .replace(/^(W|L)\s+/i, '')
    .trim();
}

export function formatGameScore(teamScore?: number | null, oppScore?: number | null): string | null {
  if (teamScore == null || oppScore == null || !Number.isFinite(teamScore) || !Number.isFinite(oppScore)) {
    return null;
  }
  return `${teamScore}-${oppScore}`;
}

export function resultFromScores(teamScore?: number | null, oppScore?: number | null): PgResult | null {
  if (teamScore == null || oppScore == null) return null;
  if (teamScore > oppScore) return 'W';
  if (teamScore < oppScore) return 'L';
  return null;
}

export function normalizePgFutureCell(cell: {
  week: number;
  winPct: number | null;
  opp: string;
  bye?: boolean;
  score?: string | null;
  locked?: boolean;
}): PgFutureCell {
  const oppRaw = (cell.opp ?? '').trim();
  if (cell.bye || /^bye$/i.test(oppRaw)) {
    return { week: cell.week, winPct: null, opp: 'BYE', bye: true, result: null, score: null, locked: false };
  }

  const tagged = oppRaw.match(/^(W|L)\s+(.*)$/i);
  if (tagged) {
    const result = tagged[1].toUpperCase() as PgResult;
    const winPct = isKeptProjection(cell.winPct, result) ? cell.winPct : null;
    return {
      week: cell.week,
      winPct,
      opp: tagged[2].trim(),
      bye: false,
      result,
      score: cell.score ?? null,
      locked: Boolean(cell.locked && winPct != null),
    };
  }

  return {
    week: cell.week,
    winPct: cell.winPct,
    opp: oppRaw,
    bye: false,
    result: null,
    score: cell.score ?? null,
    locked: Boolean(cell.locked),
  };
}

export type PgFinalGame = {
  result: PgResult;
  score: string;
  opp?: string;
};

export type PgScheduleWeek = {
  week: number;
  /** `@WAS`, `LAC`, or `BYE`. */
  opp: string;
  bye: boolean;
  result?: PgResult | null;
  score?: string | null;
};

/** Opponent key for matching PoolGenius cells to the NFL schedule (ignores @ and (N)). */
export function normalizeOppKey(opp: string): string {
  return stripResultOpp(opp)
    .replace(/\(N\)/gi, '')
    .replace(/^@/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Remap PoolGenius season columns onto real NFL weeks by matching opponents.
 * Their grid is often shifted a week after games finalize; schedule is source of truth for opp/W/L.
 */
export function alignFutureToSchedule(
  future: PgFutureCell[],
  schedule: PgScheduleWeek[],
): PgFutureCell[] {
  const pool = future
    .map((cell, index) => ({ cell: normalizePgFutureCell(cell), index }))
    .filter(({ cell }) => !cell.bye && Boolean(normalizeOppKey(cell.opp)));
  const used = new Set<number>();
  const byWeek = new Map(schedule.map((row) => [row.week, row]));

  return Array.from({ length: 18 }, (_, i) => i + 1).map((week) => {
    const sw = byWeek.get(week);
    if (!sw || sw.bye || /^bye$/i.test(sw.opp)) {
      return { week, winPct: null, opp: 'BYE', bye: true, result: null, score: null, locked: false };
    }

    const key = normalizeOppKey(sw.opp);
    const matches = pool
      .filter(({ cell, index }) => !used.has(index) && normalizeOppKey(cell.opp) === key)
      .sort((a, b) => Math.abs(a.cell.week - week) - Math.abs(b.cell.week - week));
    const hit = matches[0];
    if (hit) used.add(hit.index);

    const src = hit?.cell;
    const fallback = future.find((cell) => cell.week === week);
    const fallbackNorm = fallback ? normalizePgFutureCell(fallback) : undefined;
    const result = sw.result ?? src?.result ?? null;
    const winPct =
      (src && isKeptProjection(src.winPct, result) ? src.winPct : null) ??
      (fallbackNorm && isKeptProjection(fallbackNorm.winPct, result) ? fallbackNorm.winPct : null);
    const score = sw.score ?? src?.score ?? null;

    return {
      week,
      winPct,
      opp: sw.opp,
      bye: false,
      result,
      score,
      locked: Boolean(result != null && winPct != null),
    };
  });
}

/** Freeze the last projected % on finished weeks; later weeks keep the fresh PoolGenius numbers. */
export function lockCompletedFuture(
  fresh: PgFutureCell[],
  previous: PgFutureCell[] | undefined,
  finals: Map<number, PgFinalGame>,
): PgFutureCell[] {
  return fresh.map((cell) => {
    const prev = previous?.find((row) => row.week === cell.week);
    const game = finals.get(cell.week);
    if (cell.bye) {
      return { week: cell.week, winPct: null, opp: 'BYE', bye: true, result: null, score: null, locked: false };
    }

    // Schedule finals win on result/score; PoolGenius W/L text is often on the wrong week column.
    const result = game?.result ?? cell.result ?? prev?.result ?? null;
    const finished = result != null || Boolean(game);
    if (!finished) {
      return {
        week: cell.week,
        winPct: cell.winPct,
        opp: cell.opp,
        bye: false,
        result: null,
        score: null,
        locked: false,
      };
    }

    const kept =
      (prev?.locked && isKeptProjection(prev.winPct, prev.result) ? prev.winPct : null) ??
      (isKeptProjection(prev?.winPct, prev?.result) ? prev?.winPct ?? null : null) ??
      (isKeptProjection(cell.winPct, result) ? cell.winPct : null);

    return {
      week: cell.week,
      winPct: kept,
      // Prefer aligned/schedule opp labels (with @); bare finals abbrev is fallback only.
      opp: stripResultOpp(cell.opp) || stripResultOpp(prev?.opp) || stripResultOpp(game?.opp) || cell.opp,
      bye: false,
      result,
      score: game?.score ?? prev?.score ?? cell.score ?? null,
      locked: kept != null,
    };
  });
}
