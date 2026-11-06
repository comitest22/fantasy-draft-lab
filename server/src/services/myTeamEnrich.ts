import { describeGameWeather } from '../analysis/gameContext';
import { buildEspnStyleOprkSlate, buildPlayerSosSlate } from '../analysis/playerGameLog';
import { loadContextAssets } from '../analysis/survivor';
import { invertDefenseRank } from '../analysis/tdMatchup';
import { enrichmentStore } from '../data/enrichment';
import { readEspnAuth } from '../data/store';
import type { MyTeamFile, MyTeamPlayer, MyTeamRosterPlayer, MyTeamRosterView } from '../types';
import {
  buildEspnOprkSlateFromMatrix,
  espnOprkFor,
  fetchEspnOprkBundle,
  readCommittedEspnOprkBundle,
  type EspnOprkAverageMatrix,
  type EspnOprkMatrix,
} from './espnOprk';
import type { EspnAuth } from './espnLeague';
import {
  fetchEspnWeekScoring,
  mergeWeekScoring,
  readCommittedEspnWeekScoring,
  type EspnWeekPlayerScoring,
} from './espnWeekScoring';
import { attachSeasonStats } from './myTeamSeasonStats';
import {
  buildVsPosMatchup,
  loadWeeklyDefenseAllowed,
  type WeeklyDefenseAllowed,
} from './vsPosMatchup';

function resolveTeam(player: MyTeamPlayer, season: number): string {
  return player.nflTeam || enrichmentStore.rosterTeam(player.name, season) || '';
}

async function resolveAuth(): Promise<EspnAuth | null> {
  const fromEnv = {
    espnS2: process.env.ESPN_S2?.trim() ?? '',
    swid: process.env.ESPN_SWID?.trim() ?? '',
  };
  if (fromEnv.espnS2 && fromEnv.swid) return fromEnv;
  return readEspnAuth();
}

function fantasyWeatherLabel(label: string): string {
  return label.replace(/TD odds/g, 'fantasy scoring');
}

function attachWeather(
  team: string,
  week: number,
  game: { bye?: boolean; home?: boolean; opponent?: string } | undefined,
  assets: Awaited<ReturnType<typeof loadContextAssets>>
): MyTeamRosterPlayer['weather'] {
  if (!game || game.bye) return undefined;
  const homeTeam = game.home ? team : game.opponent;
  if (!homeTeam) return undefined;
  const key = homeTeam.toUpperCase();
  const venue = assets.venues[key];
  const forecast = assets.forecasts[`${week}:${key}`];
  const raw = describeGameWeather({
    roof: venue?.roof,
    stadium: venue?.name,
    forecast,
  });
  if (!raw) return undefined;
  return { kind: raw.kind, label: fantasyWeatherLabel(raw.label) };
}

function enrichPlayer(
  player: MyTeamPlayer,
  season: number,
  week: number,
  completedWeeks: number,
  espnMatrix: EspnOprkMatrix | null,
  espnAverages: EspnOprkAverageMatrix | null,
  weekly: WeeklyDefenseAllowed | null,
  weekScoring: Map<number, EspnWeekPlayerScoring> | null,
  assets: Awaited<ReturnType<typeof loadContextAssets>>
): MyTeamRosterPlayer {
  const team = resolveTeam(player, season);
  const status = player.status || enrichmentStore.getPlayerStatus(player.name);
  const game = team ? enrichmentStore.getScheduleGame(team, week) : undefined;
  const points = enrichmentStore.getSeasonPoints(player.name, season);
  const fpts = points?.fantasyPoints ?? enrichmentStore.getFantasyPoints(player.name, season);
  const gp = points?.gamesPlayed;
  const avg =
    fpts != null && gp != null && gp > 0 ? Math.round((fpts / gp) * 100) / 100 : undefined;
  const depth = enrichmentStore.getDepthPlayer(player.name, season);
  const posRank =
    enrichmentStore.getPositionalEosRank(player.name, season) ??
    enrichmentStore.getEspnPosRank(player.name, player.position);

  const resolvedTeam = team || player.nflTeam;
  const sosSlate = buildPlayerSosSlate(resolvedTeam, player.position);
  const oprkSlate = espnMatrix
    ? buildEspnOprkSlateFromMatrix(resolvedTeam, player.position, espnMatrix)
    : buildEspnStyleOprkSlate(resolvedTeam, player.position);

  let oppRank: number | undefined;
  if (espnMatrix && !game?.bye && game?.opponent) {
    oppRank = espnOprkFor(espnMatrix, player.position, game.opponent);
  }
  if (oppRank == null) {
    if (player.position === 'D/ST') {
      oppRank = invertDefenseRank(enrichmentStore.getOppOffenseRank(team, week));
    } else if (player.position !== 'K') {
      oppRank = invertDefenseRank(
        enrichmentStore.getOppPosDefenseRank(team, week, player.position)
      );
    }
  }

  const cleanStatus =
    status && status.toUpperCase() !== 'ACTIVE' && status.toUpperCase() !== 'HEALTHY'
      ? status
      : undefined;

  const scoring = weekScoring?.get(player.espnId);
  const weather = attachWeather(resolvedTeam, week, game, assets);
  const onBye = Boolean(game?.bye);
  const opponent = onBye ? undefined : game?.opponent;
  const vsMatchup = buildVsPosMatchup({
    opponent,
    bye: onBye,
    position: player.position,
    season,
    completedWeeks,
    ranks: espnMatrix,
    averages: espnAverages,
    weekly,
    oppRank,
  });

  return {
    ...player,
    nflTeam: resolvedTeam,
    status: cleanStatus,
    opponent,
    home: onBye ? undefined : game?.home,
    bye: onBye || undefined,
    kickoff: game?.kickoff,
    gameStatus: game?.status,
    teamScore: game?.teamScore,
    oppScore: game?.oppScore,
    weather,
    projectedPoints: scoring?.projectedPoints,
    weekScore: scoring?.weekScore,
    lastWeekPoints: scoring?.lastWeekPoints,
    oppRank,
    percentOwned: scoring?.percentOwned ?? depth?.percentOwned,
    posRank,
    fantasyPoints: fpts,
    gamesPlayed: gp,
    avgPoints: avg,
    sosSlate,
    oprkSlate,
    vsMatchup,
  };
}

export async function enrichMyTeam(
  team: MyTeamFile,
  opts?: { stats?: boolean }
): Promise<MyTeamRosterView> {
  await enrichmentStore.load();
  const week = enrichmentStore.currentWeek();
  const assets = await loadContextAssets();

  let espnMatrix: EspnOprkMatrix | null = null;
  let espnAverages: EspnOprkAverageMatrix | null = null;
  let liveScoring: Map<number, EspnWeekPlayerScoring> | null = null;
  try {
    const auth = await resolveAuth();
    if (auth) {
      const [bundle, scoring] = await Promise.all([
        fetchEspnOprkBundle(team.leagueId, team.season, auth, week).catch(() => null),
        fetchEspnWeekScoring(team.leagueId, team.season, auth, week, team.teamId).catch(
          () => null
        ),
      ]);
      if (bundle) {
        espnMatrix = bundle.ranks;
        espnAverages = bundle.averages;
      }
      liveScoring = scoring;
    }
  } catch {
    espnMatrix = null;
    espnAverages = null;
    liveScoring = null;
  }
  if (!espnMatrix) {
    const committed = await readCommittedEspnOprkBundle(team.season);
    if (committed) {
      espnMatrix = committed.ranks;
      espnAverages = committed.averages;
    }
  } else if (!espnAverages || espnAverages.size === 0) {
    const committed = await readCommittedEspnOprkBundle(team.season);
    if (committed?.averages) espnAverages = committed.averages;
  }
  const weekScoring = mergeWeekScoring(
    liveScoring,
    await readCommittedEspnWeekScoring(team.season)
  );
  const completedWeeks = enrichmentStore.completedWeeks();
  const weekly = await loadWeeklyDefenseAllowed(team.season);

  let players = team.players.map((p) =>
    enrichPlayer(
      p,
      team.season,
      week,
      completedWeeks,
      espnMatrix,
      espnAverages,
      weekly,
      weekScoring,
      assets
    )
  );
  if (opts?.stats) {
    players = await attachSeasonStats(players, team.season);
  }
  return {
    ...team,
    currentWeek: week,
    completedWeeks,
    players,
  };
}
