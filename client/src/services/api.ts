import type {
  DraftFile,
  EraComparison,
  LeagueConfig,
  SeasonAnalysis,
  StrategyRecommendation,
  SotDocument,
  ContenderPlaybook,
  DraftRouteBook,
  DraftRoute,
  PlayerCompare,
  PlayerGameLog,
  RouteBoardPlayer,
  SosBoard,
  PlayerNewsItem,
  PlayerNewsArticle,
  CheatSheet,
  CheatSheetScoring,
  SurvivorBoard,
  SurvivorMode,
  TdStreakBoard,
  MyTeamRosterView,
  FreeAgentsView,
  LeaguePlayerAvailability,
  EspnTeamSummary,
  MyTeamPlayer,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

function isGet(init?: RequestInit): boolean {
  const method = (init?.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (!(err instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|API restarting/i.test(err.message);
}

function shouldRetry(err: unknown): boolean {
  if (isNetworkError(err)) return true;
  return err instanceof Error && /^Request failed: 50[0234]$/.test(err.message);
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  // Longer gaps on network errors so nodemon restarts (~2–4s) can finish without a request storm.
  const attempts = isGet(init) ? 3 : 1;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}${url}`, { ...init, signal: controller.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      last = err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('The server took too long to respond. Refresh and try again.');
      }
      if (attempt === attempts - 1 || !shouldRetry(err)) throw err;
      const delayMs = isNetworkError(err) ? 1500 * (attempt + 1) : 400 * (attempt + 1);
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw last;
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
  playbook?: ContenderPlaybook;
}> {
  return fetchJson('/api/analysis/overview');
}

export function getTrends(): Promise<{
  analyses: SeasonAnalysis[];
  eraComparison: EraComparison;
  playbook: ContenderPlaybook;
  valueByRound: Array<{ season: number; rounds: Record<number, number[]> }>;
}> {
  return fetchJson('/api/analysis/trends');
}

export function getStrategy(
  teams?: number,
  format?: string
): Promise<{
  recommendations: StrategyRecommendation[];
  eraComparison: EraComparison;
  sotDocs: SotDocument[];
  playbook: ContenderPlaybook;
  routes: DraftRouteBook;
}> {
  const q = new URLSearchParams();
  if (teams != null) q.set('teams', String(teams));
  if (format) q.set('format', format);
  const suffix = q.toString() ? `?${q}` : '';
  return fetchJson(`/api/analysis/strategy${suffix}`);
}

export function replayRoute(body: {
  slot: number;
  opening?: string;
  locks?: Array<{ round: number; playerName: string }>;
  teams?: number;
  format?: string;
}): Promise<{ route: DraftRoute; board?: RouteBoardPlayer[] }> {
  return fetchJson('/api/analysis/routes/replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getRouteBoard(): Promise<{ board: RouteBoardPlayer[] }> {
  return fetchJson('/api/analysis/routes/board');
}

export function getSearchBoard(): Promise<{ board: RouteBoardPlayer[] }> {
  return fetchJson('/api/analysis/routes/search-board');
}

export function getPlayerCompare(name: string): Promise<{ card: PlayerCompare }> {
  return fetchJson(`/api/analysis/routes/compare?name=${encodeURIComponent(name)}`);
}

export function getPlayerGameLog(name: string, season?: number): Promise<{ log: PlayerGameLog }> {
  const qs = new URLSearchParams({ name });
  if (season != null) qs.set('season', String(season));
  return fetchJson(`/api/analysis/routes/gamelog?${qs.toString()}`, undefined, 35000);
}

export function getPlayerNews(name: string): Promise<{ items: PlayerNewsItem[] }> {
  return fetchJson(`/api/analysis/routes/news?name=${encodeURIComponent(name)}`, undefined, 35000);
}

export function getPlayerNewsArticle(url: string): Promise<{ article: PlayerNewsArticle }> {
  return fetchJson(
    `/api/analysis/routes/news/article?url=${encodeURIComponent(url)}`,
    undefined,
    35000
  );
}

export function getSosBoard(): Promise<SosBoard> {
  return fetchJson('/api/analysis/sos');
}

export function getCheatSheet(scoring: CheatSheetScoring = 'ppr'): Promise<CheatSheet> {
  return fetchJson(`/api/analysis/cheatsheet?scoring=${scoring}`, undefined, 35000);
}

export function getSurvivorBoard(mode: SurvivorMode, week?: number): Promise<SurvivorBoard> {
  const qs = new URLSearchParams({ mode });
  if (week != null) qs.set('week', String(week));
  return fetchJson(`/api/analysis/survivor?${qs.toString()}`);
}

export function getTdStreakBoard(): Promise<TdStreakBoard> {
  return fetchJson('/api/analysis/td-streak', undefined, 35000);
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

export function getMyTeam(
  season?: number,
  opts?: { stats?: boolean }
): Promise<MyTeamRosterView> {
  const params = new URLSearchParams();
  if (season != null) params.set('season', String(season));
  if (opts?.stats) params.set('stats', '1');
  const qs = params.toString() ? `?${params}` : '';
  return fetchJson(`/api/team${qs}`);
}

export function getFreeAgents(
  season?: number,
  opts?: { position?: string; limit?: number; includeSos?: boolean }
): Promise<FreeAgentsView> {
  const params = new URLSearchParams();
  if (season != null) params.set('season', String(season));
  if (opts?.position && opts.position !== 'ALL') params.set('position', opts.position);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.includeSos) params.set('includeSos', '1');
  const qs = params.toString() ? `?${params}` : '';
  return fetchJson(`/api/team/free-agents${qs}`);
}

export function getLeaguePlayerAvailability(
  name: string,
  season?: number
): Promise<LeaguePlayerAvailability> {
  const params = new URLSearchParams({ name });
  if (season != null) params.set('season', String(season));
  return fetchJson(`/api/team/availability?${params}`);
}

export function getEspnTeamDefaults(): Promise<{
  leagueId: number;
  season: number;
  preferredTeamName: string | null;
  hasSavedAuth: boolean;
}> {
  return fetchJson('/api/team/defaults');
}

export function previewEspnTeam(payload: {
  leagueId: number;
  season: number;
  teamId?: number;
  espnS2?: string;
  swid?: string;
}): Promise<{
  leagueId: number;
  season: number;
  teams: EspnTeamSummary[];
  suggestedTeamId: number | null;
  selectedTeamId: number | null;
  roster: MyTeamPlayer[];
  teamName: string | null;
}> {
  return fetchJson('/api/team/espn/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function confirmEspnTeam(payload: {
  leagueId: number;
  season: number;
  teamId: number;
  espnS2?: string;
  swid?: string;
}): Promise<MyTeamRosterView> {
  return fetchJson('/api/team/espn/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function refreshEspnTeam(payload?: {
  season?: number;
  espnS2?: string;
  swid?: string;
}): Promise<MyTeamRosterView> {
  return fetchJson('/api/team/espn/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
}
