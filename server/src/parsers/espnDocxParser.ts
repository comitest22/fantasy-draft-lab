import type { DraftPick, Position } from '../types';

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'];

export interface ParseResult {
  picks: Omit<DraftPick, 'season'>[];
  fantasyTeamNames: string[];
  rounds: number;
  errors: string[];
  warnings: string[];
}

export interface ParseOptions {
  leagueSize?: number;
}

const ROUND_HEADER = /^Round\s+(\d+)$/i;
const HEADER_ROW = /^NO\.$|^Player$|^Team$/i;

/**
 * Parse player string like "Adrian Peterson Min, RB" or "Seahawks D/ST Sea, D/ST"
 */
export function parsePlayerString(raw: string): {
  playerName: string;
  nflTeam: string;
  position: Position;
} | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s+([A-Za-z.]+),\s*(QB|RB|WR|TE|K|D\/ST)$/);
  if (!match) return null;

  const [, namePart, nflTeam, pos] = match;
  return {
    playerName: namePart.trim(),
    nflTeam: nflTeam.trim(),
    position: pos as Position,
  };
}

export function computeOverallPick(
  round: number,
  pickInRound: number,
  leagueSize: number
): number {
  if (round % 2 === 1) {
    return (round - 1) * leagueSize + pickInRound;
  }
  return round * leagueSize - pickInRound + 1;
}

export function inferDraftSlots(
  picks: Array<Omit<DraftPick, 'season' | 'draftSlot'>>,
  leagueSize: number
): Map<string, number> {
  const roundOne = picks.filter((p) => p.round === 1);
  const slotByTeam = new Map<string, number>();
  for (const pick of roundOne) {
    slotByTeam.set(pick.fantasyTeamName, pick.pickInRound);
  }
  return slotByTeam;
}

export function assignDraftSlots(
  picks: Array<Omit<DraftPick, 'season' | 'draftSlot'>>,
  leagueSize: number
): Array<Omit<DraftPick, 'season'>> {
  const slotByTeam = inferDraftSlots(picks, leagueSize);
  return picks.map((pick) => ({
    ...pick,
    draftSlot: slotByTeam.get(pick.fantasyTeamName),
  }));
}

export function parseEspnDraftText(
  text: string,
  season: number,
  options: ParseOptions = {}
): {
  picks: DraftPick[];
  fantasyTeamNames: string[];
  rounds: number;
  errors: string[];
  warnings: string[];
} {
  const leagueSize = options.leagueSize ?? 10;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const errors: string[] = [];
  const warnings: string[] = [];
  const rawPicks: Array<Omit<DraftPick, 'season' | 'draftSlot'>> = [];
  const fantasyTeamSet = new Set<string>();

  let currentRound = 0;
  let i = 0;

  while (i < lines.length) {
    const roundMatch = lines[i].match(ROUND_HEADER);
    if (roundMatch) {
      currentRound = parseInt(roundMatch[1], 10);
      i++;
      if (i < lines.length && HEADER_ROW.test(lines[i])) i++;
      if (i < lines.length && HEADER_ROW.test(lines[i])) i++;
      if (i < lines.length && HEADER_ROW.test(lines[i])) i++;
      continue;
    }

    if (currentRound === 0) {
      i++;
      continue;
    }

    const pickNoStr = lines[i];
    const playerStr = lines[i + 1];
    const teamStr = lines[i + 2];

    if (!pickNoStr || !playerStr || !teamStr) {
      if (i >= lines.length - 2) break;
      errors.push(`Incomplete pick block near line ${i + 1}: "${pickNoStr}"`);
      i++;
      continue;
    }

    const pickInRound = parseInt(pickNoStr, 10);
    if (Number.isNaN(pickInRound)) {
      errors.push(`Invalid pick number at line ${i + 1}: "${pickNoStr}"`);
      i++;
      continue;
    }

    const parsed = parsePlayerString(playerStr);
    if (!parsed) {
      errors.push(`Could not parse player at round ${currentRound}, pick ${pickInRound}: "${playerStr}"`);
      i += 3;
      continue;
    }

    fantasyTeamSet.add(teamStr);
    rawPicks.push({
      round: currentRound,
      pickInRound,
      overallPick: computeOverallPick(currentRound, pickInRound, leagueSize),
      playerName: parsed.playerName,
      nflTeam: parsed.nflTeam,
      position: parsed.position,
      fantasyTeamName: teamStr,
    });

    i += 3;
  }

  const withSlots = assignDraftSlots(rawPicks, leagueSize);
  const picks: DraftPick[] = withSlots.map((p) => ({ ...p, season }));

  const roundNumbers = [...new Set(picks.map((p) => p.round))].sort((a, b) => a - b);
  const rounds = roundNumbers.length > 0 ? Math.max(...roundNumbers) : 0;

  if (picks.length === 0) {
    errors.push('No draft picks were found in this file.');
  }

  // Validate structure against what was actually found (supports 13- or 14-round seasons).
  for (const r of roundNumbers) {
    const roundPicks = picks.filter((p) => p.round === r);
    if (roundPicks.length !== leagueSize) {
      warnings.push(`Round ${r} has ${roundPicks.length} picks (expected ${leagueSize})`);
    }
  }

  for (let r = 1; r <= rounds; r++) {
    if (!roundNumbers.includes(r)) {
      warnings.push(`Missing Round ${r} in parsed draft`);
    }
  }

  const expectedPicks = leagueSize * rounds;
  if (rounds > 0 && picks.length !== expectedPicks) {
    warnings.push(
      `Parsed ${picks.length} picks across ${rounds} rounds (expected ${expectedPicks} for a ${leagueSize}-team draft)`
    );
  }

  return {
    picks,
    fantasyTeamNames: Array.from(fantasyTeamSet).sort(),
    rounds,
    errors,
    warnings,
  };
}

export function parseEspnDraftTextOnly(text: string, options?: ParseOptions): ParseResult {
  const result = parseEspnDraftText(text, 0, options);
  return {
    picks: result.picks.map(({ season: _s, ...rest }) => rest),
    fantasyTeamNames: result.fantasyTeamNames,
    rounds: result.rounds,
    errors: result.errors,
    warnings: result.warnings,
  };
}

export { POSITIONS };
