import type {
  DraftFile,
  EraComparison,
  LeagueConfig,
  SeasonAnalysis,
  StrategyRecommendation,
  SotDocument,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listDrafts(): Promise<{ seasons: number[]; config: LeagueConfig }> {
  return fetchJson('/api/drafts');
}

export function getDraftSeason(season: number): Promise<{
  draft: DraftFile;
  analysis: SeasonAnalysis;
}> {
  return fetchJson(`/api/drafts/${season}`);
}

export function deleteSeason(season: number): Promise<{ ok: boolean; season: number }> {
  return fetchJson(`/api/drafts/${season}`, { method: 'DELETE' });
}

export function previewImport(
  file: File,
  season: number
): Promise<{ draft: DraftFile; errors: string[]; warnings: string[] }> {
  const form = new FormData();
  form.append('file', file);
  form.append('season', String(season));
  return fetchJson('/api/drafts/import/preview', { method: 'POST', body: form });
}

export function confirmImport(payload: {
  draft: DraftFile;
  userTeamName?: string;
  finalStanding?: number;
  notes?: string;
}): Promise<{ ok: boolean; season: number }> {
  return fetchJson('/api/drafts/import/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getOverview(): Promise<{
  analyses: SeasonAnalysis[];
  eraComparison: EraComparison;
}> {
  return fetchJson('/api/analysis/overview');
}

export function getTrends(): Promise<{
  analyses: SeasonAnalysis[];
  eraComparison: EraComparison;
  valueByRound: Array<{ season: number; rounds: Record<number, number[]> }>;
}> {
  return fetchJson('/api/analysis/trends');
}

export function getStrategy(): Promise<{
  recommendations: StrategyRecommendation[];
  eraComparison: EraComparison;
  sotDocs: SotDocument[];
}> {
  return fetchJson('/api/analysis/strategy');
}

export function getLeagueConfig(): Promise<LeagueConfig> {
  return fetchJson('/api/drafts/config/league');
}

export function updateLeagueConfig(config: LeagueConfig): Promise<{ ok: boolean }> {
  return fetchJson('/api/drafts/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}
