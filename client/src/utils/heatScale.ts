import type { CSSProperties } from 'react';

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** t = 0 bright accent green, t = 1 palette white (`--text`). */
export function heatStyle(t: number): CSSProperties {
  const clamped = Math.min(1, Math.max(0, t));
  // Ease toward white so mid ranks / typical win% are not stuck in mint.
  const x = Math.pow(clamped, 0.5);
  const r = mix(29, 226, x);
  const g = mix(175, 232, x);
  const b = mix(90, 240, x);
  return {
    background: `rgb(${r}, ${g}, ${b})`,
    // Dark text on all fills so easiest (bright green) stays readable.
    color: 'rgb(36, 48, 68)',
    borderColor: `rgb(${mix(34, 203, x)}, ${mix(197, 213, x)}, ${mix(94, 225, x)})`,
  };
}

/**
 * Rank 1 (easiest) is green fill; rank 32 (toughest) is white fill.
 * Toughest 10 (ranks 23–32) use red text; everything else stays dark.
 */
export function rankHeat(rank?: number): CSSProperties | undefined {
  if (rank == null) return undefined;
  const style = heatStyle((rank - 1) / 31);
  if (rank >= 23) {
    return { ...style, color: 'rgb(220, 38, 38)' };
  }
  return style;
}

/**
 * Overall player-board ranks (1 = best). Green → white across top `span` ranks;
 * red text once past ~75% of that span.
 */
export function playerRankHeat(rank?: number, span = 120): CSSProperties | undefined {
  if (rank == null) return undefined;
  const denom = Math.max(1, span - 1);
  const style = heatStyle(Math.min(1, Math.max(0, (rank - 1) / denom)));
  if (rank >= Math.round(span * 0.75)) {
    return { ...style, color: 'rgb(220, 38, 38)' };
  }
  return style;
}

/** Fantasy-relevant positional pool sizes (not SOS’s 32-team scale). */
const POSITIONAL_HEAT_SPAN: Record<string, number> = {
  QB: 36,
  RB: 72,
  WR: 96,
  TE: 36,
  K: 32,
  DST: 32,
  'D/ST': 32,
};

/** Most of the green lives in the top N at the position; after that → pale fast. */
const POSITIONAL_GREEN_FOCUS = 20;
/** Heat t at the focus boundary (0 = full green, 1 = white). */
const POSITIONAL_FOCUS_T = 0.45;

/**
 * Map positional rank → heat t. Top ~20 stay greener; ranks after that
 * ease toward white across the rest of the position pool (red past ~75%).
 */
function positionalHeatT(rank: number, span: number): number {
  const focus = Math.min(POSITIONAL_GREEN_FOCUS, span);
  if (rank <= 1) return 0;
  if (rank <= focus) {
    return ((rank - 1) / Math.max(1, focus - 1)) * POSITIONAL_FOCUS_T;
  }
  const rest = Math.max(1, span - focus);
  return POSITIONAL_FOCUS_T + (1 - POSITIONAL_FOCUS_T) * Math.min(1, (rank - focus) / rest);
}

/**
 * Positional player ranks (QB1 / WR26 / …). Same green→white fill as SOS,
 * but green is concentrated in the top ~20 at the position (WR26/WR42 read pale).
 */
export function positionalRankHeat(
  rank?: number,
  position?: string
): CSSProperties | undefined {
  if (rank == null) return undefined;
  const span = POSITIONAL_HEAT_SPAN[position ?? ''] ?? 72;
  const style = heatStyle(positionalHeatT(rank, span));
  if (rank >= Math.round(span * 0.75)) {
    return { ...style, color: 'rgb(220, 38, 38)' };
  }
  return style;
}

/** High pct is green; low pct is white. Stretched so ~80%+ is full green and ~40%- is full white. */
export function pctHeat(pct: number | null): CSSProperties | undefined {
  if (pct == null) return undefined;
  return heatStyle(Math.min(1, Math.max(0, (80 - pct) / 40)));
}

/**
 * ESPN OPRK text heat (1 = toughest). Same bands as lineup OPRK:
 * ≤8 strong red, 9–14 soft red, 22–24 soft green, ≥25 strong green, 15–21 neutral.
 */
export function oprkHeatClass(rank?: number | null): string {
  if (rank == null) return '';
  if (rank <= 8) return 'is-tough';
  if (rank <= 14) return 'is-tough-soft';
  if (rank >= 25) return 'is-easy';
  if (rank >= 22) return 'is-easy-soft';
  return '';
}
