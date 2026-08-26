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
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    const dir = enrichmentDir();
    const pointsRows = await readCsv(path.join(dir, 'fantasy-points.csv'));
    const adpRows = await readCsv(path.join(dir, 'adp.csv'));

    if (pointsRows.length > 1) {
      const headers = pointsRows[0].map((h) => h.toLowerCase());
      const nameIdx = headers.indexOf('playername');
      const seasonIdx = headers.indexOf('season');
      const posIdx = headers.indexOf('position');
      const teamIdx = headers.indexOf('nflteam');
      const ptsIdx = headers.indexOf('fantasypoints');
      const gpIdx = headers.indexOf('gamesplayed');

      for (const row of pointsRows.slice(1)) {
        this.points.push({
          playerName: row[nameIdx],
          season: parseInt(row[seasonIdx], 10),
          position: row[posIdx] as Position,
          nflTeam: row[teamIdx] ?? '',
          fantasyPoints: parseFloat(row[ptsIdx]) || 0,
          gamesPlayed: gpIdx >= 0 ? parseInt(row[gpIdx], 10) || undefined : undefined,
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

    this.loaded = true;
  }

  getFantasyPoints(playerName: string, season: number): number | undefined {
    const key = normalizeName(playerName);
    const match = this.points.find(
      (p) => p.season === season && normalizeName(p.playerName) === key
    );
    if (match) return match.fantasyPoints;

    const fuzzy = this.points.find(
      (p) =>
        p.season === season &&
        (normalizeName(p.playerName).includes(key) || key.includes(normalizeName(p.playerName)))
    );
    return fuzzy?.fantasyPoints;
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

  getExpectedPointsAtAdp(adp: number, season: number): number {
    const nearby = this.adp
      .filter((a) => a.season === season && a.expectedPoints != null)
      .sort((a, b) => Math.abs(a.adp - adp) - Math.abs(b.adp - adp));
    if (nearby.length > 0 && nearby[0].expectedPoints != null) {
      return nearby[0].expectedPoints;
    }
    return estimateExpectedPoints(adp);
  }
}

function estimateExpectedPoints(adp: number): number {
  if (adp <= 12) return 220;
  if (adp <= 24) return 190;
  if (adp <= 48) return 160;
  if (adp <= 72) return 130;
  if (adp <= 96) return 100;
  if (adp <= 120) return 75;
  return 50;
}

export const enrichmentStore = new EnrichmentStore();

export { normalizeName };
