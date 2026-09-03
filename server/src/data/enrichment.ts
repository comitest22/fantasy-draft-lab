import path from 'path';
import fs from 'fs/promises';
import type { AdpEntry, PlayerEnrichment, Position } from '../types';
import { enrichmentDir } from '../data/store';

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function readCsv(filePath: string): Promise<string[][]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map(parseCsvLine);
  } catch {
    return [];
  }
}

export class EnrichmentStore {
  private points: PlayerEnrichment[] = [];
  private adp: AdpEntry[] = [];
  /** `${season}::${normalizedName}` -> overall PPR finish (1 = highest scorer) */
  private eosRankByKey = new Map<string, number>();
  /** normalized player name -> NFL draft year (rookie season) */
  private draftYearByName = new Map<string, number>();
  /** normalized player name -> first season with fantasy points (UDFA heuristic) */
  private firstPointsSeasonByName = new Map<string, number>();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    const dir = enrichmentDir();
    const pointsRows = await readCsv(path.join(dir, 'fantasy-points.csv'));
    const adpRows = await readCsv(path.join(dir, 'adp.csv'));
    const draftRows = await readCsv(path.join(dir, 'draft-picks.csv'));

    if (pointsRows.length > 1) {
      const headers = pointsRows[0].map((h) => h.toLowerCase());
      const nameIdx = headers.indexOf('playername');
      const seasonIdx = headers.indexOf('season');
      const posIdx = headers.indexOf('position');
      const teamIdx = headers.indexOf('nflteam');
      const ptsIdx = headers.indexOf('fantasypoints');
      const gpIdx = headers.indexOf('gamesplayed');

      for (const row of pointsRows.slice(1)) {
        const playerName = row[nameIdx];
        const season = parseInt(row[seasonIdx], 10);
        this.points.push({
          playerName,
          season,
          position: row[posIdx] as Position,
          nflTeam: row[teamIdx] ?? '',
          fantasyPoints: parseFloat(row[ptsIdx]) || 0,
          gamesPlayed: gpIdx >= 0 ? parseInt(row[gpIdx], 10) || undefined : undefined,
        });

        const key = normalizeName(playerName);
        const prev = this.firstPointsSeasonByName.get(key);
        if (prev == null || season < prev) {
          this.firstPointsSeasonByName.set(key, season);
        }
      }

      const bySeason = new Map<number, PlayerEnrichment[]>();
      for (const p of this.points) {
        const list = bySeason.get(p.season) ?? [];
        list.push(p);
        bySeason.set(p.season, list);
      }
      for (const [season, list] of bySeason) {
        list.sort((a, b) => b.fantasyPoints - a.fantasyPoints);
        list.forEach((p, i) => {
          this.eosRankByKey.set(`${season}::${normalizeName(p.playerName)}`, i + 1);
        });
      }
    }

    if (adpRows.length > 1) {
      const headers = adpRows[0].map((h) => h.toLowerCase());
      const nameIdx = headers.indexOf('playername');
      const seasonIdx = headers.indexOf('season');
      const posIdx = headers.indexOf('position');
      const adpIdx = headers.indexOf('adp');
      const expIdx = headers.indexOf('expectedpoints');

      for (const row of adpRows.slice(1)) {
        this.adp.push({
          playerName: row[nameIdx],
          season: parseInt(row[seasonIdx], 10),
          position: row[posIdx] as Position,
          adp: parseFloat(row[adpIdx]) || 999,
          expectedPoints: expIdx >= 0 ? parseFloat(row[expIdx]) || undefined : undefined,
        });
      }
    }

    if (draftRows.length > 1) {
      const headers = draftRows[0].map((h) => h.toLowerCase());
      const nameIdx = headers.indexOf('playername');
      const yearIdx = headers.indexOf('draftyear');

      for (const row of draftRows.slice(1)) {
        const playerName = row[nameIdx];
        const draftYear = parseInt(row[yearIdx], 10);
        if (!playerName || !Number.isFinite(draftYear)) continue;
        const key = normalizeName(playerName);
        const prev = this.draftYearByName.get(key);
        // Keep earliest draft year if duplicates appear
        if (prev == null || draftYear < prev) {
          this.draftYearByName.set(key, draftYear);
        }
      }
    }

    this.loaded = true;
  }

  private findPoints(playerName: string, season: number): PlayerEnrichment | undefined {
    const key = normalizeName(playerName);
    const match = this.points.find(
      (p) => p.season === season && normalizeName(p.playerName) === key
    );
    if (match) return match;

    return this.points.find(
      (p) =>
        p.season === season &&
        (normalizeName(p.playerName).includes(key) || key.includes(normalizeName(p.playerName)))
    );
  }

  getFantasyPoints(playerName: string, season: number): number | undefined {
    return this.findPoints(playerName, season)?.fantasyPoints;
  }

  /** End-of-season overall PPR rank (1 = highest scorer). */
  getEosRank(playerName: string, season: number): number | undefined {
    const key = `${season}::${normalizeName(playerName)}`;
    const exact = this.eosRankByKey.get(key);
    if (exact != null) return exact;

    const match = this.findPoints(playerName, season);
    if (!match) return undefined;
    return this.eosRankByKey.get(`${season}::${normalizeName(match.playerName)}`);
  }

  getAdp(playerName: string, season: number): AdpEntry | undefined {
    const key = normalizeName(playerName);
    const match = this.adp.find(
      (a) => a.season === season && normalizeName(a.playerName) === key
    );
    if (match) return match;

    return this.adp.find(
      (a) =>
        a.season === season &&
        (normalizeName(a.playerName).includes(key) || key.includes(normalizeName(a.playerName)))
    );
  }

  getDraftYear(playerName: string): number | undefined {
    const key = normalizeName(playerName);
    const exact = this.draftYearByName.get(key);
    if (exact != null) return exact;

    for (const [name, year] of this.draftYearByName) {
      if (name.includes(key) || key.includes(name)) return year;
    }
    return undefined;
  }

  /**
   * Rookie if NFL draft year matches season, else fallback:
   * first season appearing in fantasy-points equals this season (covers many UDFAs).
   * D/ST and kickers without draft data are not marked via the points heuristic alone
   * when the name looks like a team defense.
   */
  isRookie(playerName: string, season: number, position?: string): boolean {
    if (position === 'D/ST') return false;

    const draftYear = this.getDraftYear(playerName);
    if (draftYear != null) return draftYear === season;

    const firstPoints = this.firstPointsSeasonByName.get(normalizeName(playerName));
    if (firstPoints != null) return firstPoints === season;

    // Fuzzy first-points lookup
    const key = normalizeName(playerName);
    for (const [name, year] of this.firstPointsSeasonByName) {
      if (name.includes(key) || key.includes(name)) return year === season;
    }
    return false;
  }
}

export const enrichmentStore = new EnrichmentStore();

export { normalizeName };
