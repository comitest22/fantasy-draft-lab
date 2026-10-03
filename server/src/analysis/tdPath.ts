export function survivalP(chance?: number | null): number {
  const n = chance == null || !Number.isFinite(chance) ? 30 : chance;
  return Math.min(0.72, Math.max(0.08, n / 100));
}

export function outcomeP(player?: { tdChance?: number; scoredTd?: boolean | null } | null): number {
  if (player?.scoredTd === true) return 1;
  if (player?.scoredTd === false) return 0;
  return survivalP(player?.tdChance);
}

export function week1Survival(a?: number | null, b?: number | null): number {
  return 1 - (1 - survivalP(a)) * (1 - survivalP(b));
}

export function weekSurvival(
  week: number,
  primary?: { tdChance?: number; scoredTd?: boolean | null } | null,
  primary2?: { tdChance?: number; scoredTd?: boolean | null } | null,
): number {
  if (week === 1) return 1 - (1 - outcomeP(primary)) * (1 - outcomeP(primary2));
  return outcomeP(primary);
}

export type TdPathPlayer = {
  playerName: string;
  nflTeam?: string;
  tdChance?: number;
  opp?: string;
  scoredTd?: boolean | null;
};

export type TdPrimarySlots = {
  primary: TdPathPlayer | null;
  primary2: TdPathPlayer | null;
};

export type AssignOpts = {
  locked?: Map<number, TdPrimarySlots>;
  banned?: Iterable<string>;
};

function gameId(player: TdPathPlayer | null | undefined): string | null {
  if (!player?.nflTeam) return null;
  const opp = (player.opp ?? '').replace(/^@/, '').replace(/\s*\(.*\)\s*$/, '').replace(/^(vs|at)\s+/i, '').trim();
  if (!opp) return player.nflTeam;
  return [player.nflTeam, opp].sort().join('|');
}

function byChance(a: TdPathPlayer, b: TdPathPlayer): number {
  const diff = (b.tdChance ?? 0) - (a.tdChance ?? 0);
  return diff || a.playerName.localeCompare(b.playerName);
}

function openWeek(pool: TdPathPlayer[], used: Set<string>): TdPathPlayer[] {
  return pool.filter((p) => !used.has(p.playerName) && p.nflTeam).sort(byChance);
}

function bestPair(open: TdPathPlayer[]): { a: TdPathPlayer | null; b: TdPathPlayer | null; value: number } {
  if (open.length === 0) return { a: null, b: null, value: survivalP(undefined) };
  if (open.length === 1) return { a: open[0], b: null, value: survivalP(open[0].tdChance) };
  let best = {
    a: open[0],
    b: open[1],
    value: week1Survival(open[0].tdChance, open[1].tdChance),
  };
  for (let i = 0; i < open.length; i++) {
    const a = open[i];
    const gid = gameId(a);
    for (let j = i + 1; j < open.length; j++) {
      const b = open[j];
      if (gid && gameId(b) === gid) continue;
      if (a.nflTeam && b.nflTeam === a.nflTeam) continue;
      const value = week1Survival(a.tdChance, b.tdChance);
      if (value > best.value + 1e-9 || (Math.abs(value - best.value) < 1e-9 && a.playerName < best.a.playerName)) {
        best = { a, b, value };
      }
    }
  }
  if (best.a && best.b && gameId(best.a) && gameId(best.a) === gameId(best.b)) {
    const other = open.find((p) => p.playerName !== best.a?.playerName && gameId(p) !== gameId(best.a));
    if (other) best = { a: best.a, b: other, value: week1Survival(best.a.tdChance, other.tdChance) };
  }
  return best;
}

function bestPartner(locked: TdPathPlayer, open: TdPathPlayer[]): TdPathPlayer | null {
  const gid = gameId(locked);
  let best: TdPathPlayer | null = null;
  let bestVal = -1;
  for (const b of open) {
    if (b.playerName === locked.playerName) continue;
    if (locked.nflTeam && b.nflTeam === locked.nflTeam) continue;
    if (gid && gameId(b) === gid) continue;
    const value = week1Survival(locked.tdChance, b.tdChance);
    if (value > bestVal + 1e-9 || (Math.abs(value - bestVal) < 1e-9 && (!best || b.playerName < best.playerName))) {
      best = b;
      bestVal = value;
    }
  }
  return best;
}

function weekPeak(week: number, open: TdPathPlayer[], existing?: TdPrimarySlots): number {
  if (week !== 1) {
    if (existing?.primary) return survivalP(existing.primary.tdChance);
    return survivalP(open[0]?.tdChance);
  }
  if (existing?.primary && existing.primary2) {
    return week1Survival(existing.primary.tdChance, existing.primary2.tdChance);
  }
  if (existing?.primary) {
    return week1Survival(existing.primary.tdChance, bestPartner(existing.primary, open)?.tdChance);
  }
  if (existing?.primary2) {
    return week1Survival(bestPartner(existing.primary2, open)?.tdChance, existing.primary2.tdChance);
  }
  return bestPair(open).value;
}

function eligibleIn(player: TdPathPlayer, pool: TdPathPlayer[]): boolean {
  return pool.some((p) => p.playerName === player.playerName);
}

function pickFrom(pool: TdPathPlayer[], name: string | undefined): TdPathPlayer | null {
  if (!name) return null;
  return pool.find((p) => p.playerName === name) ?? null;
}

export function pathSurvivalProduct(slots: Map<number, TdPrimarySlots>, weeks = 18): number {
  let product = 1;
  for (let week = 1; week <= weeks; week++) {
    const row = slots.get(week);
    if (!row) continue;
    product *= weekSurvival(week, row.primary, row.primary2);
  }
  return product;
}

function slotKey(week: number, which: 'primary' | 'primary2'): string {
  return `${week}:${which}`;
}

function needsFill(week: number, row: TdPrimarySlots | undefined, poolLen: number): boolean {
  if (poolLen === 0) return false;
  if (!row?.primary) return true;
  if (week === 1 && !row.primary2) return true;
  return false;
}

/** Hardest remaining week first, then pairwise swaps that raise the 18-week product. */
export function assignPrimaries(
  byWeek: Map<number, TdPathPlayer[]>,
  weeks = 18,
  opts?: AssignOpts,
): Map<number, TdPrimarySlots> {
  const used = new Set(opts?.banned ? [...opts.banned] : []);
  const assigned = new Map<number, TdPrimarySlots>();
  const frozen = new Set<string>();

  for (const [week, row] of opts?.locked ?? []) {
    const next: TdPrimarySlots = {
      primary: row.primary ?? null,
      primary2: week === 1 ? row.primary2 ?? null : null,
    };
    if (next.primary) {
      used.add(next.primary.playerName);
      frozen.add(slotKey(week, 'primary'));
    }
    if (week === 1 && next.primary2) {
      used.add(next.primary2.playerName);
      frozen.add(slotKey(1, 'primary2'));
    }
    assigned.set(week, next);
  }

  const pending = new Set(
    Array.from({ length: weeks }, (_, i) => i + 1).filter((w) =>
      needsFill(w, assigned.get(w), (byWeek.get(w) ?? []).length),
    ),
  );

  while (pending.size > 0) {
    let hardest = -1;
    let hardestValue = Infinity;
    for (const week of pending) {
      const open = openWeek(byWeek.get(week) ?? [], used);
      const value = weekPeak(week, open, assigned.get(week));
      if (value < hardestValue - 1e-9 || (Math.abs(value - hardestValue) < 1e-9 && (hardest < 0 || week < hardest))) {
        hardest = week;
        hardestValue = value;
      }
    }
    if (hardest < 0) break;
    pending.delete(hardest);
    const open = openWeek(byWeek.get(hardest) ?? [], used);
    const existing = assigned.get(hardest);
    if (hardest === 1) {
      if (existing?.primary && !existing.primary2) {
        const partner = bestPartner(existing.primary, open);
        if (partner) used.add(partner.playerName);
        assigned.set(1, { primary: existing.primary, primary2: partner });
      } else if (existing?.primary2 && !existing.primary) {
        const partner = bestPartner(existing.primary2, open);
        if (partner) used.add(partner.playerName);
        assigned.set(1, { primary: partner, primary2: existing.primary2 });
      } else {
        const pair = bestPair(open);
        if (pair.a) used.add(pair.a.playerName);
        if (pair.b) used.add(pair.b.playerName);
        assigned.set(1, { primary: pair.a, primary2: pair.b });
      }
    } else {
      const primary = existing?.primary ?? open[0] ?? null;
      if (primary && !existing?.primary) used.add(primary.playerName);
      assigned.set(hardest, { primary, primary2: null });
    }
  }

  improveBySwaps(assigned, byWeek, weeks, frozen);
  return assigned;
}

function improveBySwaps(
  assigned: Map<number, TdPrimarySlots>,
  byWeek: Map<number, TdPathPlayer[]>,
  weeks: number,
  frozen: Set<string>,
): void {
  let changed = true;
  let guard = 0;
  while (changed && guard < 4) {
    changed = false;
    guard += 1;
    let current = pathSurvivalProduct(assigned, weeks);
    const slots: Array<{ week: number; which: 'primary' | 'primary2' }> = [];
    for (let week = 1; week <= weeks; week++) {
      if (!assigned.get(week)?.primary) continue;
      slots.push({ week, which: 'primary' });
      if (week === 1 && assigned.get(1)?.primary2) slots.push({ week: 1, which: 'primary2' });
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const left = slots[i];
        const right = slots[j];
        if (frozen.has(slotKey(left.week, left.which)) || frozen.has(slotKey(right.week, right.which))) continue;
        const aRow = assigned.get(left.week);
        const bRow = assigned.get(right.week);
        if (!aRow || !bRow) continue;
        const a = left.which === 'primary2' ? aRow.primary2 : aRow.primary;
        const b = right.which === 'primary2' ? bRow.primary2 : bRow.primary;
        if (!a || !b) continue;
        const aPool = byWeek.get(left.week) ?? [];
        const bPool = byWeek.get(right.week) ?? [];
        if (!eligibleIn(b, aPool) || !eligibleIn(a, bPool)) continue;
        const aNext = pickFrom(aPool, b.playerName);
        const bNext = pickFrom(bPool, a.playerName);
        if (!aNext || !bNext) continue;

        const next = cloneSlots(assigned);
        putSlot(next, left.week, left.which, aNext);
        putSlot(next, right.week, right.which, bNext);
        if (left.week === 1 && sameGame(next.get(1)?.primary, next.get(1)?.primary2)) continue;
        if (right.week === 1 && sameGame(next.get(1)?.primary, next.get(1)?.primary2)) continue;
        if (duplicatePrimary(next)) continue;
        const product = pathSurvivalProduct(next, weeks);
        if (product > current + 1e-9) {
          assigned.clear();
          for (const [week, row] of next) assigned.set(week, row);
          current = product;
          changed = true;
        }
      }
    }
  }
}

function sameGame(a: TdPathPlayer | null | undefined, b: TdPathPlayer | null | undefined): boolean {
  const ga = gameId(a);
  const gb = gameId(b);
  return Boolean(ga && gb && ga === gb);
}

function duplicatePrimary(slots: Map<number, TdPrimarySlots>): boolean {
  const names = new Set<string>();
  for (const row of slots.values()) {
    for (const p of [row.primary, row.primary2]) {
      if (!p) continue;
      if (names.has(p.playerName)) return true;
      names.add(p.playerName);
    }
  }
  return false;
}

function putSlot(
  slots: Map<number, TdPrimarySlots>,
  week: number,
  which: 'primary' | 'primary2',
  player: TdPathPlayer | null,
): void {
  const prev = slots.get(week) ?? { primary: null, primary2: null };
  slots.set(week, which === 'primary2' ? { ...prev, primary2: player } : { ...prev, primary: player });
}

function cloneSlots(slots: Map<number, TdPrimarySlots>): Map<number, TdPrimarySlots> {
  return new Map([...slots.entries()].map(([week, row]) => [week, { ...row }]));
}

export function pickAlternate(
  pool: TdPathPlayer[],
  primaries: TdPathPlayer[],
  reservedPrimaries: Set<string>,
): TdPathPlayer | null {
  const takenNames = new Set(primaries.map((p) => p.playerName));
  const takenTeams = new Set(primaries.map((p) => p.nflTeam).filter(Boolean) as string[]);
  const takenGames = new Set(primaries.map((p) => gameId(p)).filter(Boolean) as string[]);
  const leftover = pool.filter((p) => !reservedPrimaries.has(p.playerName) && !takenNames.has(p.playerName));
  const ranked = leftover.sort(byChance);
  return (
    ranked.find((p) => p.nflTeam && !takenTeams.has(p.nflTeam) && !takenGames.has(gameId(p) ?? '')) ??
    ranked.find((p) => p.nflTeam && !takenTeams.has(p.nflTeam)) ??
    ranked[0] ??
    null
  );
}
