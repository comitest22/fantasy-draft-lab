/**
 * Enrichment status / instructions.
 *
 * - adp.csv: pre-draft rankings (imported from "* Rankings.docx")
 * - fantasy-points.csv: actual season fantasy points (NOT in ranking docs)
 *
 * Import rankings:
 *   npm run enrichment:import-rankings -- "C:/Users/jrose/Downloads"
 */
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data/enrichment');

async function main(): Promise<void> {
  const pointsPath = path.join(DATA_DIR, 'fantasy-points.csv');
  const adpPath = path.join(DATA_DIR, 'adp.csv');

  const points = await fs.readFile(pointsPath, 'utf-8');
  const adp = await fs.readFile(adpPath, 'utf-8');

  const pointsRows = points.trim().split('\n').length - 1;
  const adpRows = adp.trim().split('\n').length - 1;

  const adpSeasons = new Set(
    adp
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[1])
  );
  const pointsSeasons = new Set(
    points
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[1])
  );

  console.log('Enrichment data status:');
  console.log(`  adp.csv: ${adpRows} players across seasons ${[...adpSeasons].sort().join(', ')}`);
  console.log(
    `  fantasy-points.csv: ${pointsRows} players across seasons ${[...pointsSeasons].sort().join(', ') || '(none)'}`
  );
  console.log('');
  console.log('Notes:');
  console.log('  - Rankings docs update ADP / reach-steal grading.');
  console.log('  - Hit/bust grading also needs actual fantasy points per season.');
  console.log('  - Auction $ values in ranking docs are ignored.');
  console.log('');
  console.log('Re-import rankings from Downloads:');
  console.log('  npm run enrichment:import-rankings -- "C:/Users/you/Downloads"');
  console.log('');
  console.log('Add actual season points manually:');
  console.log('  Append rows to data/enrichment/fantasy-points.csv');
  console.log('  Columns: playerName,season,position,nflTeam,fantasyPoints,gamesPlayed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
