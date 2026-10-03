/**
 * Match ESPN final standings to local drafts, print top-team strategy stats,
 * and write teamStandings into league-config.json.
 *
 * Usage: npx tsx scripts/enrichment/analyze-top-teams.ts
 */
import fs from 'fs';
import path from 'path';
import { enrichmentStore } from '../../server/src/data/enrichment';
import { gradeDraftPicks, computeDraftGrade, computeRates } from '../../server/src/analysis/valueOverADP';
import { getFirstRoundForPosition } from '../../server/src/analysis/positionalTiming';
import type { DraftFile, LeagueConfig, Position } from '../../server/src/types';

const ROOT = path.resolve(__dirname, '../..');
const STANDINGS_PATH = path.join(ROOT, 'data/enrichment/espn-standings.json');
const CONFIG_PATH = path.join(ROOT, 'data/league-config.json');
const DRAFTS_DIR = path.join(ROOT, 'data/drafts');
const OUT_PATH = path.join(ROOT, 'data/enrichment/top-team-analysis.json');

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchName(espnName: string, draftNames: string[]): string | null {
  const target = norm(espnName);
  const exact = draftNames.find((n) => norm(n) === target);
  if (exact) return exact;
  const fuzzy = draftNames.find((n) => {
    const d = norm(n);
    return d.includes(target) || target.includes(d);
  });
  return fuzzy ?? null;
}

type StandingTeam = {
  teamId: number;
  name: string;
  abbrev: string;
  finalStanding: number | null;
  playoffSeed: number | null;
  wins: number | null;
  losses: number | null;
  pointsFor: number | null;
};

function loadDraft(season: number): DraftFile {
  return JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, `${season}.json`), 'utf8'));
}

function draftSlotFor(draft: DraftFile, teamName: string): number | null {
  const r1 = draft.picks.find((p) => p.round === 1 && p.fantasyTeamName === teamName);
  return r1?.draftSlot ?? r1?.pickInRound ?? null;
}

function firstPicks(draft: DraftFile, teamName: string, n: number) {
  return draft.picks
    .filter((p) => p.fantasyTeamName === teamName)
    .sort((a, b) => a.overallPick - b.overallPick)
    .slice(0, n)
    .map((p) => ({
      round: p.round,
      overall: p.overallPick,
      pos: p.position,
      player: p.playerName,
    }));
}

function stack(draft: DraftFile, teamName: string): Record<string, number> {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, 'D/ST': 0 };
  for (const p of draft.picks.filter((x) => x.fantasyTeamName === teamName)) {
    counts[p.position] = (counts[p.position] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  await enrichmentStore.load();

  const standingsFile = JSON.parse(fs.readFileSync(STANDINGS_PATH, 'utf8')) as {
    seasons: Record<string, { year: number; teams: StandingTeam[] }>;
  };
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as LeagueConfig;

  const seasons: any[] = [];
  const unmatched: string[] = [];
  const owners: Record<number, { titles: number; top3: number; finishes: number[]; slots: number[] }> = {};

  for (const year of Object.keys(standingsFile.seasons).map(Number).sort((a, b) => a - b)) {
    const draft = loadDraft(year);
    const draftNames = [...new Set(draft.picks.map((p) => p.fantasyTeamName))];
    const espnTeams = standingsFile.seasons[String(year)].teams;

    const teamStandings: Record<string, number> = {};
    const mapped: any[] = [];

    for (const t of espnTeams) {
      const draftName = matchName(t.name, draftNames);
      if (!draftName) {
        unmatched.push(`${year}: ESPN "${t.name}" not in draft (${draftNames.join(' | ')})`);
        continue;
      }
      if (t.finalStanding != null) teamStandings[draftName] = t.finalStanding;

      const slot = draftSlotFor(draft, draftName);
      const graded = gradeDraftPicks(draft.picks, draftName);
      const rates = computeRates(graded);
      const userPicks = graded.filter((p) => p.isUserPick);
      const early = userPicks.filter((p) => p.round <= 3);
      const earlyPos = early.map((p) => p.position);

      const row = {
        year,
        teamId: t.teamId,
        espnName: t.name.trim(),
        draftName,
        standing: t.finalStanding,
        seed: t.playoffSeed,
        record: `${t.wins}-${t.losses}`,
        pointsFor: t.pointsFor != null ? Math.round(t.pointsFor) : null,
        draftSlot: slot,
        firstPlayer: firstPicks(draft, draftName, 1)[0]?.player ?? null,
        firstThree: firstPicks(draft, draftName, 3)
          .map((p) => `${p.pos} ${p.player}`)
          .join(' / '),
        firstThreePos: firstPicks(draft, draftName, 3)
          .map((p) => p.pos)
          .join('-'),
        rb1Round: getFirstRoundForPosition(graded, draftName, 'RB' as Position),
        wr1Round: getFirstRoundForPosition(graded, draftName, 'WR' as Position),
        qb1Round: getFirstRoundForPosition(graded, draftName, 'QB' as Position),
        te1Round: getFirstRoundForPosition(graded, draftName, 'TE' as Position),
        stack: stack(draft, draftName),
        draftGrade: computeDraftGrade(graded),
        hitRate: Math.round(rates.hitRate * 100),
        bustRate: Math.round(rates.bustRate * 100),
        reachRate: Math.round(rates.reachRate * 100),
        totalValue: Math.round(rates.totalValue),
        earlyPos,
      };
      mapped.push(row);

      if (!owners[t.teamId]) owners[t.teamId] = { titles: 0, top3: 0, finishes: [], slots: [] };
      if (t.finalStanding === 1) owners[t.teamId].titles += 1;
      if (t.finalStanding != null && t.finalStanding <= 3) owners[t.teamId].top3 += 1;
      if (t.finalStanding != null) owners[t.teamId].finishes.push(t.finalStanding);
      if (slot != null) owners[t.teamId].slots.push(slot);
    }

    if (config.seasons[String(year)]) {
      config.seasons[String(year)].teamStandings = teamStandings;
    }

    seasons.push({
      year,
      userTeam: config.seasons[String(year)]?.userTeamName,
      teams: mapped.sort((a, b) => (a.standing ?? 99) - (b.standing ?? 99)),
    });
  }

  const allTeams = seasons.flatMap((s) => s.teams);
  const top3 = allTeams.filter((t) => t.standing != null && t.standing <= 3);
  const champs = allTeams.filter((t) => t.standing === 1);
  const bottom3 = allTeams.filter((t) => t.standing != null && t.standing >= 8);
  const userRows = allTeams.filter((t) => {
    const cfg = config.seasons[String(t.year)];
    return cfg?.userTeamName && t.draftName === cfg.userTeamName;
  });

  function avg(nums: number[]): number {
    const xs = nums.filter((n) => n != null && !Number.isNaN(n));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  }

  function slotFinish(rows: typeof allTeams) {
    const bySlot: Record<number, { n: number; avgFinish: number; titles: number; top3: number }> = {};
    for (const r of rows) {
      if (r.draftSlot == null || r.standing == null) continue;
      if (!bySlot[r.draftSlot]) bySlot[r.draftSlot] = { n: 0, avgFinish: 0, titles: 0, top3: 0 };
      bySlot[r.draftSlot].n += 1;
      bySlot[r.draftSlot].avgFinish += r.standing;
      if (r.standing === 1) bySlot[r.draftSlot].titles += 1;
      if (r.standing <= 3) bySlot[r.draftSlot].top3 += 1;
    }
    return Object.entries(bySlot)
      .map(([slot, v]) => ({
        slot: Number(slot),
        n: v.n,
        avgFinish: +(v.avgFinish / v.n).toFixed(2),
        titles: v.titles,
        top3: v.top3,
        top3Rate: +((v.top3 / v.n) * 100).toFixed(0),
      }))
      .sort((a, b) => a.slot - b.slot);
  }

  function posOpen(rows: typeof allTeams) {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const key = r.firstThreePos;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([pattern, n]) => ({ pattern, n, pct: +((n / rows.length) * 100).toFixed(0) }));
  }

  const summary = {
    unmatched,
    slotVsFinish: slotFinish(allTeams),
    top3SlotVsFinish: slotFinish(top3),
    champOpeners: champs.map((c) => ({
      year: c.year,
      team: c.espnName,
      slot: c.draftSlot,
      firstThree: c.firstThree,
      rb1: c.rb1Round,
      wr1: c.wr1Round,
      qb1: c.qb1Round,
      grade: c.draftGrade,
    })),
    top3Openers: posOpen(top3),
    leagueOpeners: posOpen(allTeams),
    bottom3Openers: posOpen(bottom3),
    avgTiming: {
      top3: {
        rb1: +avg(top3.map((t) => t.rb1Round)).toFixed(2),
        wr1: +avg(top3.map((t) => t.wr1Round)).toFixed(2),
        qb1: +avg(top3.map((t) => t.qb1Round)).toFixed(2),
        te1: +avg(top3.map((t) => t.te1Round)).toFixed(2),
        grade: +avg(top3.map((t) => t.draftGrade)).toFixed(1),
        hitRate: +avg(top3.map((t) => t.hitRate)).toFixed(1),
        bustRate: +avg(top3.map((t) => t.bustRate)).toFixed(1),
        reachRate: +avg(top3.map((t) => t.reachRate)).toFixed(1),
        slot: +avg(top3.map((t) => t.draftSlot)).toFixed(2),
      },
      user: {
        rb1: +avg(userRows.map((t) => t.rb1Round)).toFixed(2),
        wr1: +avg(userRows.map((t) => t.wr1Round)).toFixed(2),
        qb1: +avg(userRows.map((t) => t.qb1Round)).toFixed(2),
        te1: +avg(userRows.map((t) => t.te1Round)).toFixed(2),
        grade: +avg(userRows.map((t) => t.draftGrade)).toFixed(1),
        hitRate: +avg(userRows.map((t) => t.hitRate)).toFixed(1),
        bustRate: +avg(userRows.map((t) => t.bustRate)).toFixed(1),
        reachRate: +avg(userRows.map((t) => t.reachRate)).toFixed(1),
        slot: +avg(userRows.map((t) => t.draftSlot)).toFixed(2),
        avgFinish: +avg(userRows.map((t) => t.standing)).toFixed(2),
      },
      league: {
        rb1: +avg(allTeams.map((t) => t.rb1Round)).toFixed(2),
        wr1: +avg(allTeams.map((t) => t.wr1Round)).toFixed(2),
        qb1: +avg(allTeams.map((t) => t.qb1Round)).toFixed(2),
        te1: +avg(allTeams.map((t) => t.te1Round)).toFixed(2),
        grade: +avg(allTeams.map((t) => t.draftGrade)).toFixed(1),
      },
    },
    repeatWinners: Object.entries(owners)
      .map(([id, o]) => ({
        teamId: Number(id),
        titles: o.titles,
        top3: o.top3,
        avgFinish: +avg(o.finishes).toFixed(2),
        avgSlot: +avg(o.slots).toFixed(2),
        names: [...new Set(allTeams.filter((t) => t.teamId === Number(id)).map((t) => t.espnName))],
      }))
      .sort((a, b) => b.titles - a.titles || b.top3 - a.top3),
    userYearByYear: userRows.map((t) => ({
      year: t.year,
      standing: t.standing,
      slot: t.draftSlot,
      firstThree: t.firstThree,
      grade: t.draftGrade,
    })),
    seasons,
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log('unmatched', unmatched.length ? unmatched : 'none');
  console.log(JSON.stringify(summary.slotVsFinish, null, 2));
  console.log('--- timing ---');
  console.log(JSON.stringify(summary.avgTiming, null, 2));
  console.log('--- openers top3 vs league ---');
  console.log('top3', summary.top3Openers);
  console.log('league', summary.leagueOpeners);
  console.log('--- champs ---');
  console.log(JSON.stringify(summary.champOpeners, null, 2));
  console.log('--- owners ---');
  console.log(JSON.stringify(summary.repeatWinners, null, 2));
  console.log('Wrote', OUT_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
