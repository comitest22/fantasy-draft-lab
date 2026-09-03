/**
 * Replace seasons in adp.csv with verified ESPN PPR overall boards
 * from data/enrichment/espn-ppr-overall/{year}.csv
 *
 * Usage:
 *   npm run enrichment:apply-rankings
 */
import fs from 'fs/promises';
import path from 'path';

const ADP_PATH = path.resolve(__dirname, '../../data/enrichment/adp.csv');
const OVERRIDE_DIR = path.resolve(__dirname, '../../data/enrichment/espn-ppr-overall');

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

async function main(): Promise<void> {
  const overrideNames = (await fs.readdir(OVERRIDE_DIR))
    .filter((f) => /^\d{4}\.csv$/i.test(f))
    .sort();

  if (overrideNames.length === 0) {
    throw new Error(`No {year}.csv files in ${OVERRIDE_DIR}`);
  }

  const adpRaw = await fs.readFile(ADP_PATH, 'utf-8');
  const adpLines = adpRaw.trim().split(/\r?\n/);
  const header = adpLines[0];
  const seasonIdx = parseCsvLine(header)
    .map((h) => h.toLowerCase())
    .indexOf('season');

  if (seasonIdx < 0) {
    throw new Error('adp.csv missing season column');
  }

  const overrideSeasons = new Set<number>();
  const overrideRows: string[] = [];

  for (const file of overrideNames) {
    const season = parseInt(file.slice(0, 4), 10);
    overrideSeasons.add(season);
    const raw = await fs.readFile(path.join(OVERRIDE_DIR, file), 'utf-8');
    const lines = raw.trim().split(/\r?\n/);
    const rows = lines.slice(1).filter((l) => l.trim().length > 0);
    console.log(`${file}: ${rows.length} players`);
    if (rows.length > 0) {
      const first = parseCsvLine(rows[0]);
      console.log(`  ${first[2] === 'WR' || first[2] === 'RB' || first[2] === 'QB' || first[2] === 'TE' ? `${first[3]}. ${first[0]} (${first[2]})` : rows[0]}`);
    }
    overrideRows.push(...rows);
  }

  const kept = adpLines.slice(1).filter((line) => {
    const season = parseInt(parseCsvLine(line)[seasonIdx], 10);
    return !overrideSeasons.has(season);
  });

  const merged = [...kept, ...overrideRows].sort((a, b) => {
    const aa = parseCsvLine(a);
    const bb = parseCsvLine(b);
    const seasonA = parseInt(aa[seasonIdx], 10);
    const seasonB = parseInt(bb[seasonIdx], 10);
    if (seasonA !== seasonB) return seasonA - seasonB;
    const adpA = parseFloat(aa[3]) || 0;
    const adpB = parseFloat(bb[3]) || 0;
    return adpA - adpB;
  });

  await fs.writeFile(ADP_PATH, [header, ...merged].join('\n') + '\n', 'utf-8');
  console.log(
    `\nWrote ${merged.length} rows -> ${ADP_PATH} (replaced seasons ${[...overrideSeasons].sort((a, b) => a - b).join(', ')})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
