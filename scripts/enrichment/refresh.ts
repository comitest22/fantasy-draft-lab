/**
 * Enrichment status / instructions.
 *
 * - adp.csv: pre-draft rankings (from "* Rankings.docx")
 * - fantasy-points.csv: actual season PPR points (from nflverse)
 *
 * Commands:
 *   npm run enrichment:import-rankings -- "C:/Users/jrose/Downloads"
 *   npm run enrichment:import-fantasy-points
 *   npm run enrichment:import-fantasy-points -- --from 2014 --to 2025
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
  console.log('Sources:');
  console.log('  - ADP: ESPN pre-draft ranking docs (auction $ ignored)');
  console.log('  - Fantasy points: nflverse fantasy_points_ppr (regular season)');
  console.log('');
  console.log('Refresh:');
  console.log('  npm run enrichment:import-rankings -- "C:/Users/you/Downloads"');
  console.log('  npm run enrichment:import-fantasy-points');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
