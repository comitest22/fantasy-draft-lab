/**
 * Refresh enrichment CSVs from external sources.
 * For v1, this validates existing files and prints instructions for manual updates.
 * Future: integrate nflverse / FantasyPros exports.
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

  console.log('Enrichment data status:');
  console.log(`  fantasy-points.csv: ${pointsRows} players`);
  console.log(`  adp.csv: ${adpRows} players`);
  console.log('');
  console.log('To add a new season:');
  console.log('  1. Append rows to data/enrichment/fantasy-points.csv');
  console.log('  2. Append rows to data/enrichment/adp.csv');
  console.log('  3. Re-run analysis in the dashboard');
  console.log('');
  console.log('Columns:');
  console.log('  fantasy-points: playerName,season,position,nflTeam,fantasyPoints,gamesPlayed');
  console.log('  adp: playerName,season,position,adp,expectedPoints');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
