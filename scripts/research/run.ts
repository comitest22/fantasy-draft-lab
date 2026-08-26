/**
 * Research runner — generates or refreshes SOT docs using Cursor SDK.
 *
 * Usage:
 *   npm run research:sot -- --topic ppr-10-team-draft-strategy
 *   npm run research:sot -- --topic custom --prompt "Your research question"
 *
 * Requires CURSOR_API_KEY in .env
 */
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TOPICS: Record<string, { title: string; prompt: string; filename: string }> = {
  'ppr-10-team-draft-strategy': {
    title: 'PPR 10-Team Draft Strategy',
    filename: 'ppr-10-team-draft-strategy.md',
    prompt:
      'Research and write a comprehensive PPR 10-team snake draft strategy guide. Include round-by-round priorities, 10-team specific advice, and actionable rules. Format as markdown with YAML frontmatter (title, source, date, confidence, tags).',
  },
  'positional-scarcity-and-runs': {
    title: 'Positional Scarcity and Runs',
    filename: 'positional-scarcity-and-runs.md',
    prompt:
      'Research positional scarcity in PPR fantasy football and when to join or fade positional runs during a draft. Include a scarcity table and practical rules. Format as markdown with YAML frontmatter.',
  },
  'historical-bust-rates-by-round': {
    title: 'Historical Bust Rates by Round',
    filename: 'historical-bust-rates-by-round.md',
    prompt:
      'Research historical bust rates by draft round for RB, WR, QB, and TE in PPR redraft leagues. Include a table and risk management advice. Format as markdown with YAML frontmatter.',
  },
  'draft-slot-strategy': {
    title: 'Draft Slot Strategy (Snake)',
    filename: 'draft-slot-strategy.md',
    prompt:
      'Research draft slot strategy for 10-team snake drafts (early, middle, late picks). Include turn planning advice. Format as markdown with YAML frontmatter.',
  },
  'in-season-vs-draft-value': {
    title: 'In-Season vs Draft Value',
    filename: 'in-season-vs-draft-value.md',
    prompt:
      'Research why draft capital and draft quality matter throughout the fantasy season. Cover waiver impact, trade leverage, and the catch-up trap. Format as markdown with YAML frontmatter.',
  },
};

async function runWithCursorSdk(prompt: string): Promise<string> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error('CURSOR_API_KEY is required. Add it to .env');
  }

  const { Agent } = await import('@cursor/sdk');
  const model = process.env.RESEARCH_MODEL ?? 'composer-2.5';

  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: model },
    local: { cwd: path.resolve(__dirname, '../..') },
  });

  if (result.status !== 'completed' || !result.result) {
    throw new Error(`Research agent failed: ${result.status}`);
  }

  return result.result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const topicIdx = args.indexOf('--topic');
  const promptIdx = args.indexOf('--prompt');

  const topic = topicIdx >= 0 ? args[topicIdx + 1] : undefined;
  const customPrompt = promptIdx >= 0 ? args[promptIdx + 1] : undefined;

  if (!topic) {
    console.log('Available topics:');
    for (const [key, val] of Object.entries(TOPICS)) {
      console.log(`  ${key} — ${val.title}`);
    }
    console.log('\nUsage: npm run research:sot -- --topic <topic-key>');
    console.log('       npm run research:sot -- --topic custom --prompt "..."');
    return;
  }

  const sotDir = path.resolve(__dirname, '../../docs/sot');
  await fs.mkdir(sotDir, { recursive: true });

  let filename: string;
  let prompt: string;

  if (topic === 'custom') {
    if (!customPrompt) {
      throw new Error('--prompt is required when topic is custom');
    }
    filename = `custom-${Date.now()}.md`;
    prompt = customPrompt;
  } else {
    const config = TOPICS[topic];
    if (!config) {
      throw new Error(`Unknown topic: ${topic}. Run without --topic to list options.`);
    }
    filename = config.filename;
    prompt = config.prompt;
  }

  console.log(`Running research for: ${topic}`);
  const content = await runWithCursorSdk(prompt);
  const outPath = path.join(sotDir, filename);
  await fs.writeFile(outPath, content, 'utf-8');
  console.log(`Saved: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
