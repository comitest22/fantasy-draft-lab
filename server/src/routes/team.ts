import { Router, Request, Response } from 'express';
import {
  listMyTeamSeasons,
  readEspnAuth,
  readLeagueConfig,
  readMyTeam,
  writeEspnAuth,
  writeLeagueConfig,
  writeMyTeam,
} from '../data/store';
import {
  DEFAULT_ESPN_LEAGUE_ID,
  EspnLeagueError,
  buildMyTeamFile,
  fetchEspnLeague,
  findEspnTeam,
  listEspnTeams,
  rosterForTeam,
  suggestTeamId,
  type EspnAuth,
} from '../services/espnLeague';
import { enrichMyTeam } from '../services/myTeamEnrich';
import {
  fetchEspnFreeAgents,
  lookupEspnLeagueAvailability,
} from '../services/espnFreeAgents';
import { enrichmentStore } from '../data/enrichment';

const router = Router();

function resolveSeason(raw?: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) return n;
  }
  return enrichmentStore.latestRankingSeason() ?? new Date().getFullYear();
}

function resolveLeagueId(raw?: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) return n;
  }
  return DEFAULT_ESPN_LEAGUE_ID;
}

async function resolveAuth(body: {
  espnS2?: string;
  swid?: string;
}): Promise<EspnAuth> {
  const fromBody = {
    espnS2: body.espnS2?.trim() ?? '',
    swid: body.swid?.trim() ?? '',
  };
  if (fromBody.espnS2 && fromBody.swid) return fromBody;

  const fromEnv = {
    espnS2: process.env.ESPN_S2?.trim() ?? '',
    swid: process.env.ESPN_SWID?.trim() ?? '',
  };
  if (fromEnv.espnS2 && fromEnv.swid) return fromEnv;

  const fromFile = await readEspnAuth();
  if (fromFile) return fromFile;

  throw new EspnLeagueError(
    'ESPN cookies required: paste espn_s2 and SWID, or set ESPN_S2 / ESPN_SWID in .env.',
    401
  );
}

function sendEspnError(res: Response, err: unknown): void {
  if (err instanceof EspnLeagueError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: String(err) });
}

router.get('/defaults', async (_req: Request, res: Response) => {
  try {
    const season = enrichmentStore.latestRankingSeason() ?? new Date().getFullYear();
    const config = await readLeagueConfig();
    const preferredName = config.seasons[String(season)]?.userTeamName;
    const hasAuthFile = !!(await readEspnAuth());
    const hasAuthEnv = !!(process.env.ESPN_S2?.trim() && process.env.ESPN_SWID?.trim());
    res.json({
      leagueId: DEFAULT_ESPN_LEAGUE_ID,
      season,
      preferredTeamName: preferredName ?? null,
      hasSavedAuth: hasAuthFile || hasAuthEnv,
    });
  } catch (err) {
    sendEspnError(res, err);
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const season = resolveSeason(req.query.season);
    let team = await readMyTeam(season);
    if (!team) {
      const seasons = await listMyTeamSeasons();
      if (seasons.length > 0 && req.query.season == null) {
        team = await readMyTeam(seasons[0]);
      }
    }
    if (!team) {
      res.status(404).json({ error: 'No imported team yet. Import from ESPN under Import.' });
      return;
    }
    const includeStats =
      req.query.stats === '1' || req.query.stats === 'true' || req.query.stats === 'yes';
    res.json(await enrichMyTeam(team, { stats: includeStats }));
  } catch (err) {
    sendEspnError(res, err);
  }
});

router.get('/free-agents', async (req: Request, res: Response) => {
  try {
    const season = resolveSeason(req.query.season);
    let team = await readMyTeam(season);
    if (!team) {
      const seasons = await listMyTeamSeasons();
      if (seasons.length > 0 && req.query.season == null) {
        team = await readMyTeam(seasons[0]);
      }
    }
    if (!team) {
      res.status(404).json({ error: 'No imported team yet. Import from ESPN under Import.' });
      return;
    }
    const auth = await resolveAuth({});
    const limitRaw = req.query.limit;
    const limit =
      limitRaw != null && String(limitRaw).trim()
        ? parseInt(String(limitRaw), 10)
        : undefined;
    const includeSosRaw = req.query.includeSos;
    const includeSos =
      includeSosRaw === '1' ||
      includeSosRaw === 'true' ||
      includeSosRaw === 'yes'
        ? true
        : includeSosRaw === '0' ||
            includeSosRaw === 'false' ||
            includeSosRaw === 'no'
          ? false
          : undefined;
    res.json(
      await fetchEspnFreeAgents({
        leagueId: team.leagueId,
        season: team.season,
        auth,
        teamName: team.teamName,
        position: typeof req.query.position === 'string' ? req.query.position : undefined,
        limit: limit != null && !Number.isNaN(limit) ? limit : undefined,
        includeSos,
      })
    );
  } catch (err) {
    sendEspnError(res, err);
  }
});

/** League pool status for a bio name: FA / Waivers / Owned (+ mine). */
router.get('/availability', async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name query required' });
      return;
    }
    const season = resolveSeason(req.query.season);
    let team = await readMyTeam(season);
    if (!team) {
      const seasons = await listMyTeamSeasons();
      if (seasons.length > 0 && req.query.season == null) {
        team = await readMyTeam(seasons[0]);
      }
    }
    if (!team) {
      res.status(404).json({ error: 'No imported team yet. Import from ESPN under Import.' });
      return;
    }
    const auth = await resolveAuth({});
    res.json(
      await lookupEspnLeagueAvailability({
        leagueId: team.leagueId,
        season: team.season,
        auth,
        teamId: team.teamId,
        myRosterNames: team.players.map((p) => p.name),
        playerName: name,
      })
    );
  } catch (err) {
    sendEspnError(res, err);
  }
});

router.post('/espn/preview', async (req: Request, res: Response) => {
  try {
    const leagueId = resolveLeagueId(req.body?.leagueId);
    const season = resolveSeason(req.body?.season);
    const teamIdRaw = req.body?.teamId;
    const teamId =
      teamIdRaw != null && teamIdRaw !== ''
        ? parseInt(String(teamIdRaw), 10)
        : null;

    const auth = await resolveAuth(req.body ?? {});
    const payload = await fetchEspnLeague(leagueId, season, auth);
    const teams = listEspnTeams(payload);

    if (teams.length === 0) {
      throw new EspnLeagueError(
        'League returned no teams. Confirm the league ID, season, and cookies.',
        404
      );
    }

    const config = await readLeagueConfig();
    const preferredName = config.seasons[String(season)]?.userTeamName;
    const suggestedTeamId = suggestTeamId(teams, preferredName);
    const selectedId =
      teamId != null && !Number.isNaN(teamId) ? teamId : suggestedTeamId;
    const rosterInfo =
      selectedId != null ? rosterForTeam(payload, selectedId) : null;

    res.json({
      leagueId,
      season,
      teams,
      suggestedTeamId,
      roster: rosterInfo?.players ?? [],
      teamName: rosterInfo?.teamName ?? null,
      selectedTeamId: selectedId,
    });
  } catch (err) {
    sendEspnError(res, err);
  }
});

router.post('/espn/confirm', async (req: Request, res: Response) => {
  try {
    const leagueId = resolveLeagueId(req.body?.leagueId);
    const season = resolveSeason(req.body?.season);
    const teamId = parseInt(String(req.body?.teamId ?? ''), 10);
    if (Number.isNaN(teamId)) {
      throw new EspnLeagueError('teamId is required to confirm import.');
    }

    const auth = await resolveAuth(req.body ?? {});
    const payload = await fetchEspnLeague(leagueId, season, auth);
    const team = findEspnTeam(payload, teamId);
    if (!team) {
      throw new EspnLeagueError(`Team ${teamId} not found in league ${leagueId}.`, 404);
    }

    const previous = await readMyTeam(season);
    const snapshot = buildMyTeamFile({ leagueId, season, team, previous });
    await writeMyTeam(snapshot);

    if (req.body?.espnS2?.trim() && req.body?.swid?.trim()) {
      await writeEspnAuth({
        espnS2: String(req.body.espnS2).trim(),
        swid: String(req.body.swid).trim(),
      });
    }

    const config = await readLeagueConfig();
    const seasonKey = String(season);
    const entry = config.seasons[seasonKey] ?? {};
    if (!entry.userTeamName) {
      config.seasons[seasonKey] = { ...entry, userTeamName: snapshot.teamName };
      await writeLeagueConfig(config);
    }

    res.json(await enrichMyTeam(snapshot));
  } catch (err) {
    sendEspnError(res, err);
  }
});

router.post('/espn/refresh', async (req: Request, res: Response) => {
  try {
    const seasonHint = resolveSeason(req.body?.season);
    let existing = await readMyTeam(seasonHint);
    if (!existing) {
      const seasons = await listMyTeamSeasons();
      if (seasons[0] != null) existing = await readMyTeam(seasons[0]);
    }
    if (!existing) {
      throw new EspnLeagueError(
        'No imported team to refresh. Import from ESPN under Import first.',
        404
      );
    }

    const auth = await resolveAuth(req.body ?? {});
    const payload = await fetchEspnLeague(
      existing.leagueId,
      existing.season,
      auth
    );
    const team = findEspnTeam(payload, existing.teamId);
    if (!team) {
      throw new EspnLeagueError(
        `Saved team ${existing.teamId} not found in league ${existing.leagueId}. Re-import.`,
        404
      );
    }

    const snapshot = buildMyTeamFile({
      leagueId: existing.leagueId,
      season: existing.season,
      team,
      previous: existing,
    });
    await writeMyTeam(snapshot);

    if (req.body?.espnS2?.trim() && req.body?.swid?.trim()) {
      await writeEspnAuth({
        espnS2: String(req.body.espnS2).trim(),
        swid: String(req.body.swid).trim(),
      });
    }

    res.json(await enrichMyTeam(snapshot));
  } catch (err) {
    sendEspnError(res, err);
  }
});

export default router;
