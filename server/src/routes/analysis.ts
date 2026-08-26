import { Router, Request, Response } from 'express';
import { readAllDrafts, readLeagueConfig } from '../data/store';
import { analyzeSeason, compareEras } from '../analysis/eraCompare';
import {
  generateStrategyRecommendations,
  loadSotDocuments,
  attachSotCitations,
} from '../analysis/strategy';
import { sortBySeason } from '../utils/sort';

const router = Router();

router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const config = await readLeagueConfig();
    const drafts = await readAllDrafts();
    const analyses = [];
    for (const draft of drafts) {
      analyses.push(await analyzeSeason(draft, config));
    }
    const eraComparison = await compareEras(drafts, config);
    res.json({ analyses: sortBySeason(analyses, 'asc'), eraComparison });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/strategy', async (_req: Request, res: Response) => {
  try {
    const config = await readLeagueConfig();
    const drafts = await readAllDrafts();
    const analyses = [];
    for (const draft of drafts) {
      analyses.push(await analyzeSeason(draft, config));
    }
    const eraComparison = await compareEras(drafts, config);
    const sotDocs = await loadSotDocuments();
    const recommendations = generateStrategyRecommendations(
      analyses,
      eraComparison,
      sotDocs
    );
    const withCitations = attachSotCitations(recommendations, sotDocs);
    res.json({ recommendations: withCitations, eraComparison, sotDocs });
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
    const eraComparison = await compareEras(drafts, config);

    const valueByRound = sortBySeason(analyses, 'asc').map((a) => ({
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
      analyses: sortBySeason(analyses, 'asc'),
      eraComparison,
      valueByRound,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
