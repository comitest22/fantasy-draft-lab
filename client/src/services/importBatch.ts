import { confirmImport } from '../services/api';
import type { DraftFile } from '../types';

export interface ConfirmImportPayload {
  draft: DraftFile;
  userTeamName?: string;
  finalStanding?: number;
  notes?: string;
}

export interface BatchConfirmResult {
  season: number;
  ok: boolean;
  error?: string;
}

export async function confirmImportBatch(
  items: ConfirmImportPayload[]
): Promise<BatchConfirmResult[]> {
  const results: BatchConfirmResult[] = [];

  for (const item of items) {
    try {
      await confirmImport(item);
      results.push({ season: item.draft.season, ok: true });
    } catch (err) {
      results.push({
        season: item.draft.season,
        ok: false,
        error: String(err),
      });
    }
  }

  return results;
}
