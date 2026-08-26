import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  listDraftSeasons,
  readDraft,
  writeDraft,
  deleteDraft,
  readLeagueConfig,
  writeLeagueConfig,
  readAllDrafts,
} from '../data/store';
import { parseEspnDocxBuffer } from '../parsers/parseDocx';
import { analyzeSeason, compareEras } from '../analysis/eraCompare';
import {
  generateStrategyRecommendations,
  loadSotDocuments,
  attachSotCitations,
} from '../analysis/strategy';
import type { LeagueConfig, SeasonConfig } from '../types';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const seasons = await listDraftSeasons();
    const config = await readLeagueConfig();
    res.json({ seasons, config });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:season', async (req: Request, res: Response) => {
  try {
    const season = parseInt(req.params.season, 10);
    if (Number.isNaN(season)) {
      res.status(400).json({ error: 'Invalid season' });
      return;
    }
    const draft = await readDraft(season);
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    const config = await readLeagueConfig();
    const analysis = await analyzeSeason(draft, config);
    res.json({ draft, analysis });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/:season', async (req: Request, res: Response) => {
  try {
    const season = parseInt(req.params.season, 10);
    if (Number.isNaN(season)) {
      res.status(400).json({ error: 'Invalid season' });
      return;
    }

    const existing = await readDraft(season);
    if (!existing) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    const deleted = await deleteDraft(season);
    if (!deleted) {
      res.status(500).json({ error: 'Failed to delete draft' });
      return;
    }

    res.json({ ok: true, season });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const season = parseInt(String(req.body.season), 10);
    if (Number.isNaN(season)) {
      res.status(400).json({ error: 'Season is required' });
      return;
    }
    const config = await readLeagueConfig();
    const { draft, errors, warnings } = await parseEspnDocxBuffer(
      req.file.buffer,
      season,
      config.leagueSize
    );
    res.json({ draft, errors, warnings });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/import/confirm', async (req: Request, res: Response) => {
  try {
    const { draft, userTeamName, finalStanding, notes } = req.body;
    if (!draft?.season) {
      res.status(400).json({ error: 'Draft payload required' });
      return;
    }
    await writeDraft(draft);
    const config = await readLeagueConfig();
    const seasonKey = String(draft.season);
    const seasonConfig: SeasonConfig = {
      ...(config.seasons[seasonKey] ?? {}),
      ...(userTeamName ? { userTeamName } : {}),
      ...(finalStanding != null ? { finalStanding: Number(finalStanding) } : {}),
      ...(notes ? { notes } : {}),
    };
    config.seasons[seasonKey] = seasonConfig;
    await writeLeagueConfig(config);
    res.json({ ok: true, season: draft.season });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.put('/config', async (req: Request, res: Response) => {
  try {
    const config = req.body as LeagueConfig;
    await writeLeagueConfig(config);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/config/league', async (_req: Request, res: Response) => {
  try {
    const config = await readLeagueConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
