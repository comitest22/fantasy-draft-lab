import type { SurvivorSeasonCell, SurvivorSeasonRow } from '../types';

export interface SurvivorPathSlot {
  week: number;
  team: string;
  teamName: string;
  opp: string;
  pct: number;
  result?: 'W' | 'L' | null;
}

export interface SurvivorPath {
  slots: Array<SurvivorPathSlot | null>;
  survive: number | null;
}

const INF = 1e9;

export function cellPct(cell: SurvivorSeasonCell | undefined, invert: boolean): number | null {
  if (!cell || cell.bye) return null;
  if (cell.result === 'W') return invert ? 0 : 100;
  if (cell.result === 'L') return invert ? 100 : 0;
  const n = invert ? cell.losePct : cell.winPct;
  return n == null ? null : n;
}

function cellOf(row: SurvivorSeasonRow | undefined, week: number): SurvivorSeasonCell | undefined {
  return row?.cells.find((c) => c.week === week);
}

function product(slots: Array<SurvivorPathSlot | null>): number | null {
  let p = 1;
  let n = 0;
  for (const s of slots) {
    if (!s) continue;
    if (s.pct <= 0) return null;
    p *= s.pct / 100;
    n += 1;
  }
  return n === 0 ? null : p;
}

function isPlayed(cell: SurvivorSeasonCell | undefined): boolean {
  return cell?.result === 'W' || cell?.result === 'L';
}

function slotFrom(
  row: SurvivorSeasonRow,
  week: number,
  invert: boolean,
  opts?: { includePlayed?: boolean },
): SurvivorPathSlot | null {
  const cell = cellOf(row, week);
  if (!opts?.includePlayed && isPlayed(cell)) return null;
  const pct = cellPct(cell, invert);
  if (pct == null) return null;
  return { week, team: row.team, teamName: row.teamName, opp: cell?.opp ?? '', pct, result: cell?.result ?? null };
}

/**
 * Min-cost assignment (Hungarian). `cost[job][worker]` with jobs <= workers.
 * Returns the worker index assigned to each job.
 */
export function minCostAssignment(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  if (n === 0 || m === 0) return [];
  if (n > m) throw new Error('minCostAssignment needs at least as many workers as jobs');

  const u = Array(n + 1).fill(0);
  const v = Array(m + 1).fill(0);
  const p = Array(m + 1).fill(0);
  const way = Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(m + 1).fill(INF);
    const used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] !== 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function weekCountOf(rows: SurvivorSeasonRow[]): number {
  return Math.max(18, ...rows.flatMap((row) => row.cells.map((cell) => cell.week)));
}

export function bpaLocks(
  chosen: string[],
  lockedCount: number,
  rows: SurvivorSeasonRow[],
  currentWeek = 0,
): Array<string | null> {
  const weekCount = weekCountOf(rows);
  const locks: Array<string | null> = Array.from({ length: weekCount }, () => null);
  for (let week = 1; week <= weekCount; week++) {
    const team = chosen[week - 1] ?? '';
    if (!team) continue;
    if (week <= lockedCount || (currentWeek > 0 && week < currentWeek)) locks[week - 1] = team;
  }
  return locks;
}

export function optimizePath(
  rows: SurvivorSeasonRow[],
  invert: boolean,
  week1Team: string | null,
  weekLocks: Array<string | null> = [],
): SurvivorPath {
  const weekCount = weekCountOf(rows);
  const slots: Array<SurvivorPathSlot | null> = Array.from({ length: weekCount }, () => null);
  const used = new Set<string>();
  const locks = weekLocks.slice();
  if (week1Team && !locks[0]) locks[0] = week1Team;

  for (let week = 1; week <= Math.max(locks.length, 1); week++) {
    const team = locks[week - 1];
    if (!team || used.has(team)) continue;
    const row = rows.find((r) => r.team === team);
    const slot = row ? slotFrom(row, week, invert, { includePlayed: true }) : null;
    used.add(team);
    if (slot) slots[week - 1] = slot;
    else {
      slots[week - 1] = {
        week,
        team,
        teamName: row?.teamName ?? team,
        opp: cellOf(row, week)?.opp ?? '',
        pct: 0,
      };
    }
  }

  const workers = rows.filter((row) => !used.has(row.team));
  const jobs = Array.from({ length: weekCount }, (_, i) => i + 1).filter((week) => {
    if (slots[week - 1]) return false;
    return workers.some((row) => slotFrom(row, week, invert));
  });
  if (jobs.length === 0 || workers.length === 0) {
    return { slots, survive: product(slots) };
  }

  const padded = workers.slice();
  while (padded.length < jobs.length) {
    padded.push({ team: `__pad${padded.length}`, teamName: '', futureValue: 0, cells: [] });
  }

  const cost = jobs.map((week) =>
    padded.map((row) => {
      const slot = slotFrom(row, week, invert);
      if (!slot || slot.pct <= 0) return INF;
      return -Math.log(slot.pct / 100);
    }),
  );

  const assigned = minCostAssignment(cost);
  for (let job = 0; job < jobs.length; job++) {
    const worker = assigned[job];
    if (worker == null || worker < 0) continue;
    if (cost[job][worker] >= INF / 2) continue;
    const week = jobs[job];
    const slot = slotFrom(padded[worker], week, invert);
    if (slot) slots[week - 1] = slot;
  }

  return { slots, survive: product(slots) };
}

interface TicketState {
  slots: Array<SurvivorPathSlot | null>;
  used: Set<string>;
  lockedWeeks: Set<number>;
}

function playableWeeks(rows: SurvivorSeasonRow[], invert: boolean, weekCount: number): number[] {
  const weeks: number[] = [];
  for (let week = 1; week <= weekCount; week++) {
    if (rows.some((row) => slotFrom(row, week, invert))) weeks.push(week);
  }
  return weeks;
}

function emptyWeeks(ticket: TicketState, weeks: number[]): number[] {
  return weeks.filter((week) => !ticket.slots[week - 1]);
}

function weekTakenByOther(tickets: TicketState[], skip: number, week: number, team: string): boolean {
  if (week === 1) return false;
  return tickets.some((ticket, i) => i !== skip && ticket.slots[week - 1]?.team === team);
}

function jointProduct(tickets: TicketState[]): number {
  let p = 1;
  for (const ticket of tickets) {
    const next = product(ticket.slots);
    if (next == null) return 0;
    p *= next;
  }
  return p;
}

function bestCellFor(
  tickets: TicketState[],
  index: number,
  rows: SurvivorSeasonRow[],
  invert: boolean,
  weeks: number[],
  allowShare: boolean,
): SurvivorPathSlot | null {
  const ticket = tickets[index];
  let best: SurvivorPathSlot | null = null;
  for (const week of emptyWeeks(ticket, weeks)) {
    for (const row of rows) {
      if (ticket.used.has(row.team)) continue;
      const slot = slotFrom(row, week, invert);
      if (!slot) continue;
      if (!allowShare && weekTakenByOther(tickets, index, week, row.team)) continue;
      if (
        !best ||
        slot.pct > best.pct + 1e-12 ||
        (Math.abs(slot.pct - best.pct) <= 1e-12 && (slot.week < best.week || (slot.week === best.week && slot.team < best.team)))
      ) {
        best = slot;
      }
    }
  }
  return best;
}

function assignCell(ticket: TicketState, slot: SurvivorPathSlot): void {
  ticket.slots[slot.week - 1] = slot;
  ticket.used.add(slot.team);
}

function improveJoint(
  tickets: TicketState[],
  invert: boolean,
  byTeam: Map<string, SurvivorSeasonRow>,
): void {
  for (let pass = 0; pass < 24; pass++) {
    let improved = false;
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      for (let a = 0; a < ticket.slots.length; a++) {
        for (let b = a + 1; b < ticket.slots.length; b++) {
          const sa = ticket.slots[a];
          const sb = ticket.slots[b];
          if (!sa || !sb) continue;
          if (ticket.lockedWeeks.has(sa.week) || ticket.lockedWeeks.has(sb.week)) continue;
          const rowA = byTeam.get(sa.team);
          const rowB = byTeam.get(sb.team);
          if (!rowA || !rowB) continue;
          const aAtB = slotFrom(rowA, sb.week, invert);
          const bAtA = slotFrom(rowB, sa.week, invert);
          if (!aAtB || !bAtA) continue;
          if (weekTakenByOther(tickets, i, aAtB.week, aAtB.team)) continue;
          if (weekTakenByOther(tickets, i, bAtA.week, bAtA.team)) continue;
          const before = (sa.pct / 100) * (sb.pct / 100);
          const after = (aAtB.pct / 100) * (bAtA.pct / 100);
          if (after > before + 1e-12) {
            ticket.slots[a] = bAtA;
            ticket.slots[b] = aAtB;
            improved = true;
          }
        }
      }
    }
    for (let w = 2; w <= tickets[0]?.slots.length; w++) {
      for (let i = 0; i < tickets.length; i++) {
        for (let j = i + 1; j < tickets.length; j++) {
          const a = tickets[i].slots[w - 1];
          const b = tickets[j].slots[w - 1];
          if (!a || !b) continue;
          if (tickets[i].lockedWeeks.has(w) || tickets[j].lockedWeeks.has(w)) continue;
          if (tickets[i].used.has(b.team) || tickets[j].used.has(a.team)) continue;
          const rowA = byTeam.get(a.team);
          const rowB = byTeam.get(b.team);
          if (!rowA || !rowB) continue;
          const aAtJ = slotFrom(rowA, w, invert);
          const bAtI = slotFrom(rowB, w, invert);
          if (!aAtJ || !bAtI) continue;
          const before = jointProduct(tickets);
          tickets[i].used.delete(a.team);
          tickets[j].used.delete(b.team);
          tickets[i].slots[w - 1] = bAtI;
          tickets[j].slots[w - 1] = aAtJ;
          tickets[i].used.add(bAtI.team);
          tickets[j].used.add(aAtJ.team);
          const after = jointProduct(tickets);
          if (after > before + 1e-15) {
            improved = true;
          } else {
            tickets[i].used.delete(bAtI.team);
            tickets[j].used.delete(aAtJ.team);
            tickets[i].slots[w - 1] = a;
            tickets[j].slots[w - 1] = b;
            tickets[i].used.add(a.team);
            tickets[j].used.add(b.team);
          }
        }
      }
    }
    if (!improved) break;
  }
}

function fillJoint(rows: SurvivorSeasonRow[], invert: boolean, locksPerTicket: Array<Array<string | null>>): SurvivorPath[] {
  const weekCount = weekCountOf(rows);
  const byTeam = new Map(rows.map((row) => [row.team, row]));
  const tickets: TicketState[] = locksPerTicket.map((locks) => {
    const slots: Array<SurvivorPathSlot | null> = Array.from({ length: weekCount }, () => null);
    const used = new Set<string>();
    const lockedWeeks = new Set<number>();
    for (let week = 1; week <= locks.length; week++) {
      const team = locks[week - 1];
      if (!team || used.has(team)) continue;
      const row = byTeam.get(team);
      const slot = row ? slotFrom(row, week, invert, { includePlayed: true }) : null;
      used.add(team);
      lockedWeeks.add(week);
      if (slot) slots[week - 1] = slot;
      else {
        slots[week - 1] = {
          week,
          team,
          teamName: row?.teamName ?? team,
          opp: cellOf(row, week)?.opp ?? '',
          pct: 0,
        };
      }
    }
    return { slots, used, lockedWeeks };
  });

  const weeks = playableWeeks(rows, invert, weekCount);

  for (let guard = 0; guard < 8000; guard++) {
    const needy = tickets.map((_, i) => i).filter((i) => emptyWeeks(tickets[i], weeks).length > 0);
    if (needy.length === 0) break;
    needy.sort((a, b) => {
      const fa = weeks.length - emptyWeeks(tickets[a], weeks).length;
      const fb = weeks.length - emptyWeeks(tickets[b], weeks).length;
      if (fa !== fb) return fa - fb;
      const pa = product(tickets[a].slots) ?? 1;
      const pb = product(tickets[b].slots) ?? 1;
      if (Math.abs(pa - pb) > 1e-15) return pa - pb;
      return a - b;
    });
    let placed = false;
    for (const i of needy) {
      const slot = bestCellFor(tickets, i, rows, invert, weeks, false);
      if (!slot) continue;
      assignCell(tickets[i], slot);
      placed = true;
      break;
    }
    if (placed) continue;
    const slot = bestCellFor(tickets, needy[0], rows, invert, weeks, true);
    if (!slot) break;
    assignCell(tickets[needy[0]], slot);
  }

  improveJoint(tickets, invert, byTeam);
  return tickets.map((ticket) => ({ slots: ticket.slots, survive: product(ticket.slots) }));
}

function normalizeLocks(entryLocks: string | null | Array<string | null>): Array<string | null> {
  return Array.isArray(entryLocks) ? entryLocks : entryLocks ? [entryLocks] : [];
}

export function buildEntryPaths(
  rows: SurvivorSeasonRow[],
  invert: boolean,
  entryLocks: Array<string | null | Array<string | null>>,
): { paths: SurvivorPath[] } {
  const locks = entryLocks.map(normalizeLocks);
  if (locks.length <= 1) {
    return { paths: [optimizePath(rows, invert, locks[0]?.[0] ?? null, locks[0] ?? [])] };
  }
  return { paths: fillJoint(rows, invert, locks) };
}

export function formatRelative(survive: number | null, best: number | null): string {
  if (survive == null || best == null || best <= 0) return '—';
  const rel = (survive / best) * 100;
  if (rel >= 99.95) return '100%';
  if (rel >= 10) return `${rel.toFixed(0)}%`;
  return `${rel.toFixed(1)}%`;
}

export function formatSurviveProduct(survive: number | null): string {
  if (survive == null) return '—';
  const pct = survive * 100;
  const pctLabel = pct >= 10 ? `${pct.toFixed(1)}%` : `${pct.toFixed(2)}%`;
  if (survive <= 0) return pctLabel;
  const ones = Math.round(1 / survive);
  if (ones < 2) return pctLabel;
  return `${pctLabel} (1 in ${ones.toLocaleString('en-US')})`;
}
