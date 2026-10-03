/**
 * Tuesday after MNF and Friday after TNF (also on-demand).
 *
 *   npm run enrichment:weekly
 */
import path from 'path';

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  console.log(`\n== ${name} ==`);
  const started = Date.now();
  await fn();
  console.log(`   done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

export async function run(): Promise<void> {
  const season = 2026;
  await step('schedule + through-week D/O ranks', async () => {
    const mod = await import('./fetch-sos-schedule');
    await mod.run(season);
  });
  await step('ESPN ranks + player status', async () => {
    const mod = await import('./fetch-espn-ranks');
    await mod.run(season);
  });
  await step('fantasy points through current season', async () => {
    const mod = await import('./import-fantasy-points');
    await mod.run(2014, season);
  });
  await step('anytime-TD + vs-position defense', async () => {
    const mod = await import('./build-td-matchups');
    await mod.run(season);
  });
  await step('PoolGenius current week', async () => {
    try {
      const mod = await import('./fetch-poolgenius');
      await mod.run();
    } catch (err) {
      console.warn(`   PoolGenius skipped: ${(err as Error).message}`);
    }
  });
  await step('game context (travel/weather/road)', async () => {
    const mod = await import('./fetch-game-context');
    await mod.run(season);
  });
  await step('rebuild consensus units/ECR', async () => {
    const mod = await import('./build-consensus');
    await mod.run();
  });
  console.log(`\nWeekly enrichment finished. Data dir: ${path.resolve(__dirname, '../../data/enrichment')}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
