import { buildPlayerGameLog } from '../analysis/playerGameLog';
import { enrichmentStore } from '../data/enrichment';
import type { MyTeamRosterPlayer, MyTeamSeasonStats, Position } from '../types';
import { rankSeasonStats } from './statPosRanks';

function add(sum: Record<string, number>, key: string, value: number | null | undefined): void {
  if (value == null || Number.isNaN(value)) return;
  sum[key] = (sum[key] ?? 0) + value;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** NFL passer rating (0–158.3) from season totals. */
function nflPasserRating(
  cmp?: number,
  att?: number,
  yds?: number,
  td?: number,
  ints?: number
): number | undefined {
  if (att == null || att <= 0 || cmp == null || yds == null) return undefined;
  const clamp = (n: number) => Math.min(2.375, Math.max(0, n));
  const a = clamp(((cmp / att) - 0.3) * 5);
  const b = clamp(((yds / att) - 3) * 0.25);
  const c = clamp(((td ?? 0) / att) * 20);
  const d = clamp(2.375 - (((ints ?? 0) / att) * 25));
  return Math.round(((a + b + c + d) / 6) * 1000) / 10;
}

async function statsFromGameLog(
  name: string,
  season: number,
  position: Position
): Promise<MyTeamSeasonStats | undefined> {
  if (position === 'D/ST') return undefined;
  const log = await buildPlayerGameLog(name, season);
  const usage = enrichmentStore.getPlayerUsage(name, season);
  if (!log && !usage) return undefined;

  const sum: Record<string, number> = {};
  let games = 0;
  if (log) {
    for (const row of log.rows) {
      if (row.bye) continue;
      let played = false;
      for (const [key, value] of Object.entries(row.cells)) {
        if (key === 'rushAvg' || key === 'recAvg' || key === 'fpts') continue;
        if (value != null) played = true;
        add(sum, key, value);
      }
      if (played) games += 1;
    }
  }
  if (games === 0 && usage) {
    // Fall back to fantasy-points games when gamelog is empty but usage exists.
    games = enrichmentStore.getSeasonPoints(name, season)?.gamesPlayed ?? 0;
  }

  if (position === 'QB') {
    const cmp = sum.cmp;
    const att = sum.att;
    const passTd = sum.passTd;
    const ints = sum.int;
    const rushTd = sum.rushTd;
    if (!log && !usage?.snapPct) return undefined;
    return {
      kind: 'QB',
      cmp,
      att,
      pct: cmp != null && att != null && att > 0 ? round1((cmp / att) * 100) : undefined,
      passYds: sum.passYds,
      passTd,
      int: ints,
      passerRating: nflPasserRating(cmp, att, sum.passYds, passTd, ints),
      fuml: sum.fuml,
      rushCar: sum.car,
      rushYds: sum.rushYds,
      rushTd,
      snapPct: usage?.snapPct,
    };
  }

  if (position === 'K') {
    if (!log) return undefined;
    return {
      kind: 'K',
      fg: sum.fg,
      fga: sum.fga,
      xp: sum.xp,
      xpa: sum.xpa,
    };
  }

  const rushCar = sum.car;
  const rushYds = sum.rushYds;
  const rec = sum.rec;
  const recYds = sum.recYds;
  const rushTd = sum.rushTd;
  const recTd = sum.recTd;
  const targets = sum.tgt ?? usage?.targets;
  const hasBox =
    Object.keys(sum).length > 0 ||
    usage?.snapPct != null ||
    usage?.airYards != null ||
    usage?.yac != null;
  if (!hasBox) return undefined;

  return {
    kind: 'FLEX',
    rushCar,
    rushYds,
    rushAvg: rushCar != null && rushYds != null && rushCar > 0 ? round1(rushYds / rushCar) : undefined,
    rushTd,
    rec,
    recYds,
    recAvg: rec != null && recYds != null && rec > 0 ? round1(recYds / rec) : undefined,
    recTd,
    targets,
    tgtPg: targets != null && games > 0 ? round1(targets / games) : undefined,
    totalTd: rushTd != null || recTd != null ? (rushTd ?? 0) + (recTd ?? 0) : undefined,
    fuml: sum.fuml,
    snapPct: usage?.snapPct,
    routePct: usage?.routePct,
    airYards: usage?.airYards,
    yac: usage?.yac,
    adot: usage?.adot,
    targetShare: usage?.targetShare,
    carryShare: usage?.carryShare,
  };
}

function dstStatsFromLog(log: Awaited<ReturnType<typeof buildPlayerGameLog>>): MyTeamSeasonStats | undefined {
  if (!log) return undefined;
  const sum: Record<string, number> = {};
  for (const row of log.rows) {
    if (row.bye) continue;
    for (const [key, value] of Object.entries(row.cells)) {
      if (key === 'fpts') continue;
      add(sum, key, value);
    }
  }
  if (Object.keys(sum).length === 0) return undefined;
  return {
    kind: 'DST',
    td: sum.td,
    int: sum.int,
    fr: sum.fr,
    sck: sum.sck,
    sfty: sum.sfty,
    blk: sum.blk,
    pa: sum.pa,
    ya: sum.ya,
  };
}

function dstStatsCsv(team: string | undefined, season: number): MyTeamSeasonStats | undefined {
  const def = enrichmentStore.getDefenseSeasonStats(team, season);
  if (!def) return undefined;
  return {
    kind: 'DST',
    pa: def.pa,
    ya: def.ya,
  };
}

export async function attachSeasonStats(
  players: MyTeamRosterPlayer[],
  season: number
): Promise<MyTeamRosterPlayer[]> {
  await enrichmentStore.load();
  return Promise.all(
    players.map(async (player) => {
      if (player.position === 'D/ST') {
        const log = await buildPlayerGameLog(player.name, season);
        const seasonStats = dstStatsFromLog(log) ?? dstStatsCsv(player.nflTeam, season);
        const statRanks = await rankSeasonStats(player.name, player.position, season, seasonStats, {
          fantasyPoints: player.fantasyPoints,
          avgPoints: player.avgPoints,
        });
        return {
          ...player,
          seasonStats,
          statRanks: Object.keys(statRanks).length ? statRanks : undefined,
        };
      }
      const seasonStats = await statsFromGameLog(player.name, season, player.position);
      const statRanks = await rankSeasonStats(
        player.name,
        player.position,
        season,
        seasonStats,
        {
          fantasyPoints: player.fantasyPoints,
          avgPoints: player.avgPoints,
        }
      );
      return {
        ...player,
        ...(seasonStats ? { seasonStats } : {}),
        statRanks: Object.keys(statRanks).length ? statRanks : undefined,
      };
    })
  );
}
