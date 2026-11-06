/**
 * Major starter injuries + backup / rookie starts for survivor context overlay.
 * Uses ESPN injury status + YTD usage / fantasy points to spot QB (and key skill) holes.
 */

export type InjurySeverity = 'out' | 'doubtful';

export interface SkillPlayerSnap {
  playerName: string;
  position: 'QB' | 'RB' | 'WR';
  status?: string;
  /** YTD fantasy points this season (higher = more established). */
  fantasyPoints?: number;
  /** Games played this season. */
  games?: number;
  /** Snap % when available. */
  snapPct?: number;
  /** Carry share (RB) or target share (WR). */
  sharePct?: number;
  /** Site / ESPN overall rank (lower better); used as QB1 tiebreak. */
  rank?: number;
  rookie?: boolean;
  /** Career regular-season games with fantasy points (all seasons). */
  careerGames?: number;
}

export interface StarterAvailabilityInput {
  team: string;
  opponent?: string;
  teamPlayers: SkillPlayerSnap[];
  oppPlayers: SkillPlayerSnap[];
}

const OUT_STATUSES = new Set([
  'OUT',
  'INJURY_RESERVE',
  'IR',
  'SUSPENSION',
  'SUSPENDED',
  'PUP',
  'RESERVE/INJURED',
  'RESERVE/SUSPENDED',
  'RESERVE/PUP',
  'EXEMPT',
  'COVID-19',
  'INACTIVE',
]);

const DOUBTFUL_STATUSES = new Set(['DOUBTFUL']);

export function injurySeverity(status?: string): InjurySeverity | null {
  if (!status) return null;
  const key = status.trim().toUpperCase().replace(/\s+/g, ' ');
  if (OUT_STATUSES.has(key) || key.startsWith('RESERVE/')) return 'out';
  if (DOUBTFUL_STATUSES.has(key)) return 'doubtful';
  return null;
}

export function isUnavailable(status?: string): boolean {
  return injurySeverity(status) != null;
}

export function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || full;
}

function isVeteranQb(p: SkillPlayerSnap): boolean {
  return !p.rookie && (p.careerGames ?? 0) >= 20;
}

/** Prefer the real QB1: veterans / better site rank over a backup with a tiny FP edge. */
function sortEstablishedQb(a: SkillPlayerSnap, b: SkillPlayerSnap): number {
  const aVet = isVeteranQb(a);
  const bVet = isVeteranQb(b);
  if (aVet !== bVet) return aVet ? -1 : 1;

  const aRank = a.rank ?? 9999;
  const bRank = b.rank ?? 9999;
  if (aRank !== bRank && (a.rank != null || b.rank != null)) {
    // Meaningful rank gap beats a small YTD FP bump (Jalon 35.4 vs Baker 35.1).
    if (Math.abs(aRank - bRank) >= 20 || a.rank == null || b.rank == null) {
      return aRank - bRank;
    }
  }

  const career = (b.careerGames ?? 0) - (a.careerGames ?? 0);
  if (Math.abs(career) >= 15) return career;

  const fp = (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0);
  if (Math.abs(fp) >= 8) return fp;

  if (aRank !== bRank) return aRank - bRank;
  return (b.snapPct ?? 0) - (a.snapPct ?? 0);
}

function sortEstablishedSkill(a: SkillPlayerSnap, b: SkillPlayerSnap): number {
  const fp = (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0);
  if (fp !== 0) return fp;
  const share = (b.sharePct ?? 0) - (a.sharePct ?? 0);
  if (share !== 0) return share;
  const snap = (b.snapPct ?? 0) - (a.snapPct ?? 0);
  if (snap !== 0) return snap;
  return (a.rank ?? 9999) - (b.rank ?? 9999);
}

function sortLikelyStarter(
  a: SkillPlayerSnap,
  b: SkillPlayerSnap,
  pos: SkillPlayerSnap['position'],
  /** When true, the established starter is out — prefer who is actually taking snaps. */
  backupMode = false,
): number {
  if (backupMode) {
    const snap = (b.snapPct ?? 0) - (a.snapPct ?? 0);
    if (Math.abs(snap) >= 5) return snap;
    const fp = (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0);
    if (fp !== 0) return fp;
    return (a.rank ?? 9999) - (b.rank ?? 9999);
  }
  if (pos === 'QB') {
    // Healthy veteran QB1 stays ahead of a backup with similar recent snaps.
    const aVet = isVeteranQb(a);
    const bVet = isVeteranQb(b);
    if (aVet !== bVet) return aVet ? -1 : 1;
    const aRank = a.rank ?? 9999;
    const bRank = b.rank ?? 9999;
    if (aRank !== bRank && Math.abs(aRank - bRank) >= 20) return aRank - bRank;
  }
  const snap = (b.snapPct ?? 0) - (a.snapPct ?? 0);
  if (Math.abs(snap) >= 15) return snap;
  return pos === 'QB' ? sortEstablishedQb(a, b) : sortEstablishedSkill(a, b);
}

function atPos(players: SkillPlayerSnap[], pos: SkillPlayerSnap['position']): SkillPlayerSnap[] {
  return players.filter((p) => p.position === pos);
}

function establishedStarter(players: SkillPlayerSnap[], pos: SkillPlayerSnap['position']): SkillPlayerSnap | undefined {
  const list = atPos(players, pos)
    .slice()
    .sort(pos === 'QB' ? sortEstablishedQb : sortEstablishedSkill);
  return list[0];
}

function likelyStarter(
  players: SkillPlayerSnap[],
  pos: SkillPlayerSnap['position'],
  backupMode = false,
): SkillPlayerSnap | undefined {
  const available = atPos(players, pos).filter((p) => !isUnavailable(p.status));
  if (available.length === 0) return undefined;
  return available.slice().sort((a, b) => sortLikelyStarter(a, b, pos, backupMode))[0];
}

function isInexperiencedBackup(p: SkillPlayerSnap): boolean {
  if (p.rookie) return true;
  const career = p.careerGames ?? 0;
  const seasonGames = p.games ?? 0;
  if (career > 0 && career < 12) return true;
  return career < 20 && seasonGames <= 2;
}

export type ContextAbout = 'self' | 'opp';

export interface AvailabilityFactor {
  id: string;
  label: string;
  /** Win-mode signed points (>0 helps this side win). */
  points: number;
  about: ContextAbout;
}

/**
 * Build ± overlay factors for one team's week (win-mode sign: negative = worse to pick to win).
 * Opponent injuries flip the other way (opp QB out helps this side).
 */
export function starterAvailabilityFactors(input: StarterAvailabilityInput): AvailabilityFactor[] {
  const factors: AvailabilityFactor[] = [];
  pushTeamHole(factors, input.teamPlayers, 'own');
  pushTeamHole(factors, input.oppPlayers, 'opp');
  return factors;
}

function pushTeamHole(
  factors: AvailabilityFactor[],
  players: SkillPlayerSnap[],
  side: 'own' | 'opp',
): void {
  const sign = side === 'own' ? -1 : 1;
  const about: ContextAbout = side === 'own' ? 'self' : 'opp';
  const prefix = side === 'own' ? '' : 'Opp ';

  const qbEst = establishedStarter(players, 'QB');
  const qbOut = Boolean(qbEst && isUnavailable(qbEst.status));
  const qbLikely = likelyStarter(players, 'QB', qbOut);
  if (qbEst && qbOut && qbLikely && qbLikely.playerName !== qbEst.playerName) {
    const sev = injurySeverity(qbEst.status);
    const base = sev === 'doubtful' ? 1.6 : 2.2;
    const starterLabel = qbLikely.rookie
      ? `rookie ${lastName(qbLikely.playerName)} starting`
      : `${lastName(qbLikely.playerName)} starting`;
    factors.push({
      id: `${side}QbOut`,
      label: `${prefix}QB out (${lastName(qbEst.playerName)}) · ${starterLabel}`,
      points: sign * base,
      about,
    });
    if (qbLikely.rookie || isInexperiencedBackup(qbLikely)) {
      factors.push({
        id: `${side}QbBackup`,
        label: qbLikely.rookie
          ? `${prefix}Rookie QB start (${lastName(qbLikely.playerName)})`
          : `${prefix}Inexperienced QB (${lastName(qbLikely.playerName)})`,
        points: sign * 0.8,
        about,
      });
    }
  } else if (
    qbEst?.rookie &&
    qbLikely &&
    qbLikely.playerName === qbEst.playerName &&
    !isUnavailable(qbLikely.status)
  ) {
    // Only when the *established* QB1 is the healthy rookie — not a backup with a FP blip.
    factors.push({
      id: `${side}RookieQb`,
      label: `${prefix}Rookie QB start (${lastName(qbLikely.playerName)})`,
      points: sign * 1.2,
      about,
    });
  }

  for (const pos of ['RB', 'WR'] as const) {
    const est = establishedStarter(players, pos);
    if (!est || !isUnavailable(est.status)) continue;
    const lead =
      (est.fantasyPoints ?? 0) >= 40 ||
      (est.sharePct ?? 0) >= 35 ||
      (est.snapPct ?? 0) >= 55;
    if (!lead) continue;
    const sev = injurySeverity(est.status);
    const pts = pos === 'RB' ? (sev === 'doubtful' ? 0.6 : 0.9) : sev === 'doubtful' ? 0.5 : 0.8;
    factors.push({
      id: `${side}${pos}Out`,
      label: `${prefix}${pos}1 out (${lastName(est.playerName)})`,
      points: sign * pts,
      about,
    });
  }
}

export function availabilityAdjustment(input: StarterAvailabilityInput): {
  adj: number;
  notes: string[];
  factors: AvailabilityFactor[];
} {
  const factors = starterAvailabilityFactors(input);
  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  return {
    adj: Math.round(raw * 10) / 10,
    notes: factors.filter((f) => f.points !== 0).map((f) => f.label),
    factors,
  };
}
