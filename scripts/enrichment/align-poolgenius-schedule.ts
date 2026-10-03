/**
 * One-shot: realign poolgenius-survivor-2026.json season cells to nfl-schedule-2026.csv.
 * Does not call PoolGenius (no new trial). Safe to re-run.
 */
import fs from 'fs/promises';
import path from 'path';
import {
  alignFutureToSchedule,
  formatGameScore,
  normalizePgFutureCell,
  resultFromScores,
  type PgFutureCell,
  type PgScheduleWeek,
} from '../../server/src/analysis/pgFuture';

const OUT = path.resolve(__dirname, '../../data/enrichment/poolgenius-survivor-2026.json');
const SCHED = path.resolve(__dirname, '../../data/enrichment/nfl-schedule-2026.csv');

async function loadSchedule(): Promise<Map<string, PgScheduleWeek[]>> {
  const text = await fs.readFile(SCHED, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const headers = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const teamIdx = idx('team');
  const weekIdx = idx('week');
  const oppIdx = idx('opponent');
  const homeIdx = idx('home');
  const statusIdx = idx('status');
  const teamScoreIdx = idx('teamscore');
  const oppScoreIdx = idx('oppscore');
  const out = new Map<string, PgScheduleWeek[]>();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const team = (cols[teamIdx] ?? '').trim().toUpperCase();
    const week = Number(cols[weekIdx]);
    if (!team || !Number.isFinite(week)) continue;
    const oppRaw = (cols[oppIdx] ?? '').trim().toUpperCase();
    const bye = !oppRaw || oppRaw === 'BYE';
    const status = (cols[statusIdx] ?? '').trim().toUpperCase();
    const away = Number(cols[homeIdx]) === 0;
    let result: 'W' | 'L' | null = null;
    let score: string | null = null;
    if (!bye && status === 'FINAL') {
      result = resultFromScores(Number(cols[teamScoreIdx]), Number(cols[oppScoreIdx]));
      score = formatGameScore(Number(cols[teamScoreIdx]), Number(cols[oppScoreIdx]));
    }
    const list = out.get(team) ?? [];
    list.push({
      week,
      opp: bye ? 'BYE' : away ? `@${oppRaw}` : oppRaw,
      bye,
      result,
      score,
    });
    out.set(team, list);
  }
  return out;
}

type Snap = {
  opponent: string;
  home: boolean;
  matchupLabel: string;
  pgWinPct: number | null;
  marketWinPct: number | null;
  moneyline: string;
  spread: number | null;
  popularityPct: number | null;
  ev: number | null;
  gameNotes: string[];
};

async function main(): Promise<void> {
  const schedule = await loadSchedule();
  const raw = JSON.parse(await fs.readFile(OUT, 'utf8')) as {
    week?: number;
    teams: Array<{
      team: string;
      opponent: string;
      home: boolean;
      matchupLabel: string;
      pgWinPct: number | null;
      marketWinPct: number | null;
      moneyline: string;
      spread: number | null;
      popularityPct: number | null;
      ev: number | null;
      gameNotes: string[];
      future: PgFutureCell[];
      weekBoards?: Record<string, Snap>;
    }>;
  };
  let fixed = 0;
  let snapped = 0;
  const currentWeek = raw.week ?? 0;
  for (const team of raw.teams) {
    const before = team.future.map((c) => `${c.week}:${c.opp}`).join('|');
    team.future = alignFutureToSchedule(
      team.future.map((c) => normalizePgFutureCell(c)),
      schedule.get(team.team) ?? [],
    );
    const after = team.future.map((c) => `${c.week}:${c.opp}`).join('|');
    if (before !== after) fixed++;
    if (currentWeek > 0) {
      const key = String(currentWeek);
      team.weekBoards = { ...(team.weekBoards ?? {}) };
      if (!team.weekBoards[key]) {
        team.weekBoards[key] = {
          opponent: team.opponent,
          home: team.home,
          matchupLabel: team.matchupLabel,
          pgWinPct: team.pgWinPct,
          marketWinPct: team.marketWinPct,
          moneyline: team.moneyline,
          spread: team.spread,
          popularityPct: team.popularityPct,
          ev: team.ev,
          gameNotes: team.gameNotes ?? [],
        };
        snapped++;
      }
    }
  }
  await fs.writeFile(OUT, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  const sea = raw.teams.find((t) => t.team === 'SEA');
  console.log(
    `Aligned ${fixed}/${raw.teams.length} teams; snapped week ${currentWeek} boards for ${snapped} teams → ${path.relative(process.cwd(), OUT)}`,
  );
  if (sea) {
    for (const w of [1, 2, 3, 4, 5]) {
      const c = sea.future.find((x) => x.week === w);
      console.log(`  SEA W${w}: ${c?.opp} ${c?.winPct ?? '—'}% ${c?.result ?? ''} ${c?.score ?? ''}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
