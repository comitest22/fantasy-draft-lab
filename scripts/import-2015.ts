/**
 * One-time script to import the 2015 sample draft from docx.
 * Usage: npx tsx scripts/import-2015.ts [path-to-docx]
 */
import path from 'path';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { parseEspnDocxFile } from '../server/src/parsers/parseDocx';
import { writeDraft, readLeagueConfig, writeLeagueConfig } from '../server/src/data/store';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  const docxPath =
    process.argv[2] ??
    path.resolve('C:/Users/jrose/Downloads/Untitled document.docx');

  console.log(`Importing 2015 draft from: ${docxPath}`);

  const { draft, errors, warnings } = await parseEspnDocxFile(docxPath, 2015, 10);

  if (errors.length > 0) {
    console.error('Errors:', errors);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('Warnings:', warnings);
  }

  await writeDraft(draft);

  const config = await readLeagueConfig();
  config.seasons['2015'] = {
    ...(config.seasons['2015'] ?? {}),
    notes: 'Imported from ESPN docx export',
  };
  await writeLeagueConfig(config);

  console.log(`Saved ${draft.picks.length} picks for ${draft.season}`);
  console.log(`Teams: ${draft.fantasyTeamNames.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
