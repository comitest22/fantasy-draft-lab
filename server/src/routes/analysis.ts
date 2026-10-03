import { Router, Request, Response } from 'express';
import { readAllDrafts, readLeagueConfig } from '../data/store';
import { analyzeSeason, compareEras } from '../analysis/eraCompare';
import { buildContenderPlaybook } from '../analysis/contenderPlaybook';
import { buildDraftRouteBook, buildPlayerCompare, listRouteBoard, listSearchBoard, replayDraftRoute } from '../analysis/draftRoutes';
import { buildCheatSheet } from '../analysis/cheatSheet';
import { fetchPlayerNews, fetchPlayerNewsArticle } from '../analysis/playerNews';
import { buildPlayerGameLog } from '../analysis/playerGameLog';
import {
  generateStrategyRecommendations,
  loadSotDocuments,
  attachSotCitations,
} from '../analysis/strategy';
import { applyLeagueFormat, formatById, parseTeamSize } from '../analysis/leagueFormats';
import { sortBySeason } from '../utils/sort';
import { enrichmentStore } from '../data/enrichment';
import { buildSurvivorBoard, type SurvivorMode } from '../analysis/survivor';
import { buildTdStreakBoard } from '../analysis/tdStreak';

function leagueFormatFromRequest(req: Request, config: Awaited<ReturnType<typeof readLeagueConfig>>) {
  const teams = parseTeamSize(req.query.teams ?? req.body?.teams);
  const formatId = formatById(
    typeof req.query.format === 'string'
      ? req.query.format
      : typeof req.body?.format === 'string'
        ? req.body.format
        : undefined
  ).id;
  return { teams, formatId, config: applyLeagueFormat(config, teams, formatId) };
}

const router = Router();

router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const config = await readLeagueConfig();
    const drafts = await readAllDrafts();
    const analyses = [];
    for (const draft of drafts) {
      analyses.push(await analyzeSeason(draft, config));
    }
    const eraComparison = await compareEras(drafts, config, analyses);
    res.json({ analyses: sortBySeason(analyses, 'desc'), eraComparison });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sos', async (_req: Request, res: Response) => {
  try {
    await enrichmentStore.load();
    res.json(enrichmentStore.listSosBoard());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/survivor', async (req: Request, res: Response) => {
  try {
    const mode: SurvivorMode = req.query.mode === 'lose' ? 'lose' : 'win';
    const weekRaw = typeof req.query.week === 'string' ? Number(req.query.week) : undefined;
    const board = await buildSurvivorBoard(mode, Number.isFinite(weekRaw) && weekRaw ? weekRaw : undefined);
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/td-streak', async (_req: Request, res: Response) => {
  try {
    res.json(await buildTdStreakBoard());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/cheatsheet', async (req: Request, res: Response) => {
  try {
    const scoring = req.query.scoring === 'standard' ? 'standard' : 'ppr';
    const sheet = await buildCheatSheet(scoring);
    res.json(sheet);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/strategy', async (req: Request, res: Response) => {
  try {
    const base = await readLeagueConfig();
    const { teams, formatId, config } = leagueFormatFromRequest(req, base);
    const drafts = await readAllDrafts();
    const analyses = [];
    for (const draft of drafts) {
      analyses.push(await analyzeSeason(draft, base));
    }
    const eraComparison = await compareEras(drafts, base, analyses);
    const playbook = await buildContenderPlaybook(drafts, base);
    const routes = await buildDraftRouteBook(drafts, config, playbook);
    await enrichmentStore.load();
    const sotDocs = await loadSotDocuments();
    const recommendations = generateStrategyRecommendations(
      analyses,
      eraComparison,
      sotDocs,
      playbook,
      { teams, formatId, roster: config.roster! }
    );
    const withCitations = attachSotCitations(recommendations, sotDocs);
    res.json({
      recommendations: withCitations,
      eraComparison,
      sotDocs,
      playbook,
      routes,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/routes/replay', async (req: Request, res: Response) => {
  try {
    const slot = Number(req.body?.slot);
    if (!Number.isFinite(slot) || slot < 1) {
      res.status(400).json({ error: 'slot is required' });
      return;
    }
    const opening = typeof req.body?.opening === 'string' ? req.body.opening : undefined;
    const locks = Array.isArray(req.body?.locks)
      ? (req.body.locks as Array<{ round?: number; playerName?: string }>)
          .filter((l) => l && Number.isFinite(Number(l.round)) && typeof l.playerName === 'string')
          .map((l) => ({ round: Number(l.round), playerName: String(l.playerName) }))
      : [];
    const base = await readLeagueConfig();
    const { config } = leagueFormatFromRequest(req, base);
    const drafts = await readAllDrafts();
    const playbook = await buildContenderPlaybook(drafts, base);
    const route = await replayDraftRoute(drafts, config, playbook, { slot, opening, locks });
    const board = await listRouteBoard();
    res.json({ route, board });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/routes/board', async (_req: Request, res: Response) => {
  try {
    const board = await listRouteBoard();
    res.json({ board });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/routes/search-board', async (_req: Request, res: Response) => {
  try {
    const board = await listSearchBoard();
    res.json({ board });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/routes/compare', async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const card = await buildPlayerCompare(name);
    if (!card) {
      res.status(404).json({ error: 'Player not found on the board' });
      return;
    }
    res.json({ card });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/routes/gamelog', async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const seasonRaw = typeof req.query.season === 'string' ? Number(req.query.season) : undefined;
    const log = await buildPlayerGameLog(name, Number.isFinite(seasonRaw) ? seasonRaw : undefined);
    if (!log) {
      res.status(404).json({ error: 'Player not found on the board' });
      return;
    }
    res.json({ log });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/routes/news', async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const items = await fetchPlayerNews(name);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/routes/news/article', async (req: Request, res: Response) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const article = await fetchPlayerNewsArticle(url);
    res.json({ article });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/trends', async (_req: Request, res: Response) => {
  try {
    const config = await readLeagueConfig();
    const drafts = await readAllDrafts();
    const analyses = [];
    for (const draft of drafts) {
      analyses.push(await analyzeSeason(draft, config));
    }
    const eraComparison = await compareEras(drafts, config, analyses);
    const playbook = await buildContenderPlaybook(drafts, config);

    const valueByRound = sortBySeason(analyses, 'desc').map((a) => ({
      season: a.season,
      rounds: a.picks
        .filter((p) => p.isUserPick)
        .reduce<Record<number, number[]>>((acc, p) => {
          if (!acc[p.round]) acc[p.round] = [];
          if (p.valueScore != null) acc[p.round].push(p.valueScore);
          return acc;
        }, {}),
    }));

    res.json({
      analyses: sortBySeason(analyses, 'desc'),
      eraComparison,
      playbook,
      valueByRound,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
