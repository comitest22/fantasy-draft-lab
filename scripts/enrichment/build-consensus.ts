/**
 * Merge consensus raw CSVs into ranked files the app loads.
 *
 * Reads data/enrichment/consensus/raw/*.csv (no HTML scrape).
 * Writes:
 *   consensus-ranks-2026.csv
 *   consensus-sos-2026.csv
 *   consensus-units-2026.csv
 *   consensus-meta.json
 *
 *   npm run enrichment:build-consensus
 */
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data/enrichment');
const RAW_DIR = path.join(DATA_DIR, 'consensus', 'raw');
const SEASON = 2026;

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

function num(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = parseFloat(value.replace(/^"+|"+$/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function colIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const exact = normalized.indexOf(key);
    if (exact >= 0) return exact;
    const partial = normalized.findIndex((h) => h.includes(key));
    if (partial >= 0) return partial;
  }
  return -1;
}

const TEAM_ALIASES: Record<string, string> = {
  LAR: 'LA',
  STL: 'LA',
  JAC: 'JAX',
  WSH: 'WAS',
  GBP: 'GB',
  GNB: 'GB',
  SFO: 'SF',
  TAM: 'TB',
  NWE: 'NE',
  NOR: 'NO',
  KAN: 'KC',
  LVR: 'LV',
  OAK: 'LV',
  ARZ: 'ARI',
  SD: 'LAC',
};

function canonicalTeam(team?: string): string | undefined {
  if (!team) return undefined;
  const key = team.toUpperCase().replace(/[^A-Z]/g, '');
  if (!key) return undefined;
  return TEAM_ALIASES[key] ?? key;
}

function csvCell(value: string | number | undefined): string {
  if (value == null || value === '') return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map NFL rank 1 (easiest/best) … 32 → the same 1–5 scale as DraftEdge SOS. */
function rankToFive(rank: number): number {
  return round1(5 - ((rank - 1) * 4) / 31);
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

async function loadTeamRanks(filePath: string): Promise<Map<string, number>> {
  const rows = await readCsv(filePath);
  const out = new Map<string, number>();
  if (rows.length < 2) return out;
  const headers = rows[0];
  const teamIdx = colIndex(headers, 'team');
  const rankIdx = colIndex(headers, 'rank', 'overall', 'olinerank', 'oline', 'offenserank', 'offense');
  if (teamIdx < 0 || rankIdx < 0) return out;
  for (const row of rows.slice(1)) {
    const team = canonicalTeam(row[teamIdx]);
    const rank = num(row[rankIdx]);
    if (!team || rank == null) continue;
    out.set(team, rank);
  }
  return out;
}

async function averageTeamRanks(files: string[]): Promise<Map<string, number>> {
  const loaded = await Promise.all(files.map((f) => loadTeamRanks(f)));
  const teams = new Set<string>();
  for (const map of loaded) for (const team of map.keys()) teams.add(team);
  const out = new Map<string, number>();
  for (const team of teams) {
    const vals = loaded.map((m) => m.get(team)).filter((n): n is number => n != null);
    const avg = mean(vals);
    if (avg == null) continue;
    out.set(team, round1(avg));
  }
  return out;
}

interface RankRow {
  playerName: string;
  pos: string;
  team: string;
  ecr: number;
  ecrPos?: number;
  ecrBest?: number;
  ecrWorst?: number;
  ecrStdev?: number;
  experts?: number;
}

async function buildRanks(): Promise<{ rows: RankRow[]; source: string }> {
  const exportPath = path.join(RAW_DIR, `fantasypros-ecr-ppr-${SEASON}.csv`);
  const exported = await readCsv(exportPath);
  if (exported.length > 1) {
    const headers = exported[0];
    const nameIdx = colIndex(headers, 'playername', 'player', 'name');
    const posIdx = colIndex(headers, 'pos', 'position');
    const teamIdx = colIndex(headers, 'team');
    const ecrIdx = colIndex(headers, 'ecr', 'rank', 'overall');
    const ecrPosIdx = colIndex(headers, 'ecrpos', 'posrank');
    const bestIdx = colIndex(headers, 'ecrbest', 'best');
    const worstIdx = colIndex(headers, 'ecrworst', 'worst');
    const stdevIdx = colIndex(headers, 'ecrstdev', 'stdev', 'std');
    const expertsIdx = colIndex(headers, 'experts');
    const rows: RankRow[] = [];
    for (const row of exported.slice(1)) {
      const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
      const ecr = num(row[ecrIdx]);
      if (!playerName || ecr == null) continue;
      rows.push({
        playerName,
        pos: row[posIdx] ?? '',
        team: canonicalTeam(row[teamIdx]) ?? '',
        ecr,
        ecrPos: num(row[ecrPosIdx]),
        ecrBest: num(row[bestIdx]),
        ecrWorst: num(row[worstIdx]),
        ecrStdev: num(row[stdevIdx]),
        experts: num(row[expertsIdx]),
      });
    }
    return { rows, source: `FantasyPros PPR ECR export (${path.basename(exportPath)})` };
  }

  const siteRows = await readCsv(path.join(DATA_DIR, `site-ranks-espn-ppr-${SEASON}.csv`));
  const headers = siteRows[0] ?? [];
  const nameIdx = colIndex(headers, 'name', 'playername', 'player');
  const posIdx = colIndex(headers, 'pos', 'position');
  const teamIdx = colIndex(headers, 'team');
  const fpIdx = colIndex(headers, 'fantasypros');
  const espnIdx = colIndex(headers, 'espn');
  const rows: RankRow[] = [];
  for (const row of siteRows.slice(1)) {
    const playerName = row[nameIdx]?.replace(/^"+|"+$/g, '').trim();
    const ecr = num(row[fpIdx]);
    if (!playerName || ecr == null) continue;
    const espn = num(row[espnIdx]);
    const best = espn != null ? Math.min(ecr, espn) : ecr;
    const worst = espn != null ? Math.max(ecr, espn) : ecr;
    rows.push({
      playerName,
      pos: row[posIdx] ?? '',
      team: canonicalTeam(row[teamIdx]) ?? '',
      ecr,
      ecrBest: best,
      ecrWorst: worst,
      ecrStdev: round2((worst - best) / 3),
      experts: 130,
    });
  }

  const byPos = new Map<string, RankRow[]>();
  for (const row of rows) {
    const list = byPos.get(row.pos) ?? [];
    list.push(row);
    byPos.set(row.pos, list);
  }
  for (const list of byPos.values()) {
    list.sort((a, b) => a.ecr - b.ecr);
    list.forEach((row, i) => {
      row.ecrPos = i + 1;
    });
  }

  return {
    rows,
    source: `Seeded from site-ranks-espn-ppr-${SEASON}.csv FantasyPros column (drop a FantasyPros ECR CSV in consensus/raw to replace)`,
  };
}

async function buildSos(): Promise<{ rows: string[][]; sources: string[] }> {
  const draftEdge = await readCsv(path.join(DATA_DIR, `sos-${SEASON}.csv`));
  const fpa = await readCsv(path.join(RAW_DIR, `sos-fpa-${SEASON}.csv`));
  const deByTeam = new Map<string, { overall: number; qb?: number; rb?: number; wr?: number; te?: number }>();
  if (draftEdge.length > 1) {
    const headers = draftEdge[0];
    const teamIdx = colIndex(headers, 'team');
    const overallIdx = colIndex(headers, 'overall');
    const qbIdx = colIndex(headers, 'qb');
    const rbIdx = colIndex(headers, 'rb');
    const wrIdx = colIndex(headers, 'wr');
    const teIdx = colIndex(headers, 'te');
    for (const row of draftEdge.slice(1)) {
      const team = canonicalTeam(row[teamIdx]);
      const overall = num(row[overallIdx]);
      if (!team || overall == null) continue;
      deByTeam.set(team, {
        team,
        overall,
        qb: qbIdx >= 0 ? num(row[qbIdx]) : undefined,
        rb: rbIdx >= 0 ? num(row[rbIdx]) : undefined,
        wr: wrIdx >= 0 ? num(row[wrIdx]) : undefined,
        te: teIdx >= 0 ? num(row[teIdx]) : undefined,
      } as { overall: number; qb?: number; rb?: number; wr?: number; te?: number });
    }
  }

  const fpaByTeam = new Map<string, { overall: number; qb?: number; rb?: number; wr?: number; te?: number }>();
  if (fpa.length > 1) {
    const headers = fpa[0];
    const teamIdx = colIndex(headers, 'team');
    const overallIdx = colIndex(headers, 'overall');
    const qbIdx = colIndex(headers, 'qb');
    const rbIdx = colIndex(headers, 'rb');
    const wrIdx = colIndex(headers, 'wr');
    const teIdx = colIndex(headers, 'te');
    for (const row of fpa.slice(1)) {
      const team = canonicalTeam(row[teamIdx]);
      const overall = num(row[overallIdx]);
      if (!team || overall == null) continue;
      fpaByTeam.set(team, {
        overall: rankToFive(overall),
        qb: qbIdx >= 0 && num(row[qbIdx]) != null ? rankToFive(num(row[qbIdx])!) : undefined,
        rb: rbIdx >= 0 && num(row[rbIdx]) != null ? rankToFive(num(row[rbIdx])!) : undefined,
        wr: wrIdx >= 0 && num(row[wrIdx]) != null ? rankToFive(num(row[wrIdx])!) : undefined,
        te: teIdx >= 0 && num(row[teIdx]) != null ? rankToFive(num(row[teIdx])!) : undefined,
      });
    }
  }

  const teams = new Set([...deByTeam.keys(), ...fpaByTeam.keys()]);
  const header = ['team', 'overall', 'qb', 'rb', 'wr', 'te'];
  const rows: string[][] = [header];
  for (const team of [...teams].sort()) {
    const de = deByTeam.get(team);
    const fp = fpaByTeam.get(team);
    const mix = (a?: number, b?: number) => {
      const vals = [a, b].filter((n): n is number => n != null);
      return vals.length ? round1(mean(vals)!) : '';
    };
    rows.push([
      team,
      String(mix(de?.overall, fp?.overall)),
      String(mix(de?.qb ?? de?.overall, fp?.qb ?? fp?.overall)),
      String(mix(de?.rb ?? de?.overall, fp?.rb ?? fp?.overall)),
      String(mix(de?.wr ?? de?.overall, fp?.wr ?? fp?.overall)),
      String(mix(de?.te ?? de?.overall, fp?.te ?? fp?.overall)),
    ]);
  }
  return {
    rows,
    sources: [
      `DraftEdge remaining-slate 1–5 (sos-${SEASON}.csv)`,
      `FPA 1–32 board mapped to 1–5 (consensus/raw/sos-fpa-${SEASON}.csv)`,
    ],
  };
}

async function buildUnits(): Promise<{ rows: string[][]; sources: string[] }> {
  const anPath = path.join(DATA_DIR, `team-ranks-${SEASON}.csv`);
  const anRows = await readCsv(anPath);
  const anOff = new Map<string, number>();
  const anOl = new Map<string, number>();
  if (anRows.length > 1) {
    const headers = anRows[0];
    const teamIdx = colIndex(headers, 'team');
    const offIdx = colIndex(headers, 'offenserank', 'offense');
    const olIdx = colIndex(headers, 'olinerank', 'oline');
    for (const row of anRows.slice(1)) {
      const team = canonicalTeam(row[teamIdx]);
      if (!team) continue;
      const off = num(row[offIdx]);
      const ol = num(row[olIdx]);
      if (off != null) anOff.set(team, off);
      if (ol != null) anOl.set(team, ol);
    }
  }

  const pffOl = await loadTeamRanks(path.join(RAW_DIR, `pff-oline-${SEASON}.csv`));
  const sharpOl = await loadTeamRanks(path.join(RAW_DIR, `sharp-oline-${SEASON}.csv`));
  const publicOff = await loadTeamRanks(path.join(RAW_DIR, `public-offense-${SEASON}.csv`));
  const dline = await loadTeamRanks(path.join(RAW_DIR, `dline-${SEASON}.csv`));
  const power = await averageTeamRanks([
    path.join(RAW_DIR, `espn-power-${SEASON}.csv`),
    path.join(RAW_DIR, `cbs-power-${SEASON}.csv`),
    path.join(RAW_DIR, `nfl-power-${SEASON}.csv`),
  ]);

  const teams = new Set<string>([
    ...anOff.keys(),
    ...anOl.keys(),
    ...pffOl.keys(),
    ...sharpOl.keys(),
    ...publicOff.keys(),
    ...dline.keys(),
    ...power.keys(),
  ]);

  const header = ['team', 'oline', 'dline', 'offense', 'power'];
  const rows: string[][] = [header];
  for (const team of [...teams].sort()) {
    const oline = mean(
      [anOl.get(team), pffOl.get(team), sharpOl.get(team)].filter((n): n is number => n != null)
    );
    const offense = mean(
      [anOff.get(team), publicOff.get(team)].filter((n): n is number => n != null)
    );
    rows.push([
      team,
      oline != null ? String(round1(oline)) : '',
      dline.has(team) ? String(dline.get(team)) : '',
      offense != null ? String(round1(offense)) : '',
      power.has(team) ? String(round1(power.get(team)!)) : '',
    ]);
  }

  return {
    rows,
    sources: [
      `Action Network offense/OL (team-ranks-${SEASON}.csv)`,
      `PFF OL (consensus/raw/pff-oline-${SEASON}.csv)`,
      `Sharp OL (consensus/raw/sharp-oline-${SEASON}.csv)`,
      `Public offense ranks (consensus/raw/public-offense-${SEASON}.csv)`,
      `D-line ranks (consensus/raw/dline-${SEASON}.csv)`,
      'Power: ESPN / CBS / NFL.com 1–32 averages',
    ],
  };
}

async function writeCsv(filePath: string, rows: string[][]): Promise<void> {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
  await fs.writeFile(filePath, body, 'utf-8');
}

export async function run(): Promise<void> {
  const ranks = await buildRanks();
  ranks.rows.sort((a, b) => a.ecr - b.ecr || a.playerName.localeCompare(b.playerName));
  const rankCsv: string[][] = [
    ['playerName', 'pos', 'team', 'ecr', 'ecrPos', 'ecrBest', 'ecrWorst', 'ecrStdev', 'experts'],
    ...ranks.rows.map((r) => [
      r.playerName,
      r.pos,
      r.team,
      String(r.ecr),
      r.ecrPos != null ? String(r.ecrPos) : '',
      r.ecrBest != null ? String(r.ecrBest) : '',
      r.ecrWorst != null ? String(r.ecrWorst) : '',
      r.ecrStdev != null ? String(r.ecrStdev) : '',
      r.experts != null ? String(r.experts) : '',
    ]),
  ];
  await writeCsv(path.join(DATA_DIR, `consensus-ranks-${SEASON}.csv`), rankCsv);

  const sos = await buildSos();
  await writeCsv(path.join(DATA_DIR, `consensus-sos-${SEASON}.csv`), sos.rows);

  const units = await buildUnits();
  await writeCsv(path.join(DATA_DIR, `consensus-units-${SEASON}.csv`), units.rows);

  const meta = {
    season: SEASON,
    builtAt: new Date().toISOString(),
    ranks: { file: `consensus-ranks-${SEASON}.csv`, source: ranks.source, count: ranks.rows.length },
    sos: { file: `consensus-sos-${SEASON}.csv`, sources: sos.sources },
    units: { file: `consensus-units-${SEASON}.csv`, sources: units.sources },
    rawDir: 'data/enrichment/consensus/raw',
  };
  await fs.writeFile(path.join(DATA_DIR, 'consensus-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf-8');

  console.log(`Wrote consensus-ranks-${SEASON}.csv (${ranks.rows.length} players)`);
  console.log(`  ${ranks.source}`);
  console.log(`Wrote consensus-sos-${SEASON}.csv (${sos.rows.length - 1} teams)`);
  console.log(`Wrote consensus-units-${SEASON}.csv (${units.rows.length - 1} teams)`);
  console.log('Wrote consensus-meta.json');
}

const invokedDirectly = /build-consensus/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
