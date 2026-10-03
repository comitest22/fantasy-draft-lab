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
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 155;
  return {
    background: `rgb(${r}, ${g}, ${b})`,
    color: light ? 'rgb(36, 48, 68)' : 'rgb(240, 253, 244)',
    borderColor: `rgb(${mix(34, 203, x)}, ${mix(197, 213, x)}, ${mix(94, 225, x)})`,
  };
}

/** Rank 1 (easiest) is green; rank 32 (toughest) is white. */
export function rankHeat(rank?: number): CSSProperties | undefined {
  if (rank == null) return undefined;
  return heatStyle((rank - 1) / 31);
}

/** High pct is green; low pct is white. Stretched so ~80%+ is full green and ~40%- is full white. */
export function pctHeat(pct: number | null): CSSProperties | undefined {
  if (pct == null) return undefined;
  return heatStyle(Math.min(1, Math.max(0, (80 - pct) / 40)));
}
