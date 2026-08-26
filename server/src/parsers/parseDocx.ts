import mammoth from 'mammoth';
import { parseEspnDraftText } from './espnDocxParser';
import type { DraftFile } from '../types';

export async function parseEspnDocxBuffer(
  buffer: Buffer,
  season: number,
  leagueSize = 10
): Promise<{
  draft: DraftFile;
  errors: string[];
  warnings: string[];
}> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  const parsed = parseEspnDraftText(text, season, { leagueSize });

  const draft: DraftFile = {
    season,
    leagueSize,
    rounds: parsed.rounds,
    picks: parsed.picks,
    fantasyTeamNames: parsed.fantasyTeamNames,
    importedAt: new Date().toISOString(),
  };

  return {
    draft,
    errors: parsed.errors,
    warnings: parsed.warnings,
  };
}

export async function parseEspnDocxFile(
  filePath: string,
  season: number,
  leagueSize = 10
): Promise<{
  draft: DraftFile;
  errors: string[];
  warnings: string[];
}> {
  const fs = await import('fs/promises');
  const buffer = await fs.readFile(filePath);
  return parseEspnDocxBuffer(buffer, season, leagueSize);
}
