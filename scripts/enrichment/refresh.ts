/**
 * Enrichment status / instructions.
 *
 * - adp.csv: pre-draft rankings (from "* Rankings.docx")
 * - fantasy-points.csv: actual season PPR points (from nflverse)
 * - draft-picks.csv: NFL draft year for rookie detection (from nflverse)
 *
 * Commands:
 *   npm run enrichment:import-rankings -- "C:/Users/jrose/Downloads"
 *   npm run enrichment:import-fantasy-points
 *   npm run enrichment:import-draft-picks
 */
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data/enrichment');

async function main(): Promise<void> {
  const pointsPath = path.join(DATA_DIR, 'fantasy-points.csv');
  const adpPath = path.join(DATA_DIR, 'adp.csv');
  const draftPath = path.join(DATA_DIR, 'draft-picks.csv');

  const points = await fs.readFile(pointsPath, 'utf-8');
  const adp = await fs.readFile(adpPath, 'utf-8');
  let draftRows = 0;
  try {
    const draft = await fs.readFile(draftPath, 'utf-8');
    draftRows = draft.trim().split('\n').length - 1;
  } catch {
    draftRows = 0;
  }

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
  console.log(`  draft-picks.csv: ${draftRows} skill-position draftees (rookie detection)`);
  console.log('');
  console.log('Sources:');
  console.log('  - ADP: ESPN pre-draft ranking docs (auction $ ignored)');
  console.log('  - Fantasy points: nflverse fantasy_points_ppr (regular season)');
  console.log('  - Draft picks: nflverse draft_picks (NFL draft year = rookie season)');
  console.log('');
  console.log('Refresh:');
  console.log('  npm run enrichment:import-rankings -- "C:/Users/you/Downloads"');
  console.log('  npm run enrichment:import-fantasy-points');
  console.log('  npm run enrichment:import-draft-picks');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
