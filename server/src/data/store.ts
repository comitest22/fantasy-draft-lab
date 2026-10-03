import path from 'path';
import fs from 'fs/promises';
import type { DraftFile, LeagueConfig } from '../types';
import { sortBySeason } from '../utils/sort';

const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../../data');

export function getDataDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : DEFAULT_DATA_DIR;
}

export function draftsDir(): string {
  return path.join(getDataDir(), 'drafts');
}

export function enrichmentDir(): string {
  return path.join(getDataDir(), 'enrichment');
}

export function leagueConfigPath(): string {
  return path.join(getDataDir(), 'league-config.json');
}

export function sotDir(): string {
  return path.resolve(__dirname, '../../../docs/sot');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function listDraftSeasons(): Promise<number[]> {
  const dir = draftsDir();
  await ensureDir(dir);
  const files = await fs.readdir(dir);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => parseInt(f.replace('.json', ''), 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}

export async function readDraft(season: number): Promise<DraftFile | null> {
  const filePath = path.join(draftsDir(), `${season}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as DraftFile;
  } catch {
    return null;
  }
}

export async function writeDraft(draft: DraftFile): Promise<void> {
  const filePath = path.join(draftsDir(), `${draft.season}.json`);
  await writeJsonFile(filePath, draft);
}

export async function deleteDraft(season: number): Promise<boolean> {
  const filePath = path.join(draftsDir(), `${season}.json`);
  try {
    await fs.unlink(filePath);
  } catch {
    return false;
  }

  const config = await readLeagueConfig();
  delete config.seasons[String(season)];
  await writeLeagueConfig(config);

  return true;
}

export async function readLeagueConfig(): Promise<LeagueConfig> {
  return readJsonFile<LeagueConfig>(leagueConfigPath(), {
    leagueSize: 10,
    scoring: 'ppr',
    draftType: 'snake',
    rounds: 14,
    roster: { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, dst: 1, k: 1, bench: 5 },
    goodEraEnd: 2021,
    badEraStart: 2022,
    upcomingDraftSlot: 8,
    seasons: {},
  });
}

export async function writeLeagueConfig(config: LeagueConfig): Promise<void> {
  await writeJsonFile(leagueConfigPath(), config);
}

export async function readAllDrafts(): Promise<DraftFile[]> {
  const seasons = await listDraftSeasons();
  const drafts: DraftFile[] = [];
  for (const season of seasons) {
    const draft = await readDraft(season);
    if (draft) drafts.push(draft);
  }
  return sortBySeason(drafts, 'asc');
}
