import fs from 'fs/promises';
import path from 'path';
import type { StrategyRecommendation, SotDocument, EraComparison, SeasonAnalysis } from '../types';
import { sotDir } from '../data/store';

function parseFrontmatter(raw: string): {
  meta: Record<string, string | string[]>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value: string | string[] = line.slice(idx + 1).trim();
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^"|"$/g, ''));
    } else if (typeof value === 'string') {
      value = value.replace(/^"|"$/g, '');
    }
    meta[key] = value;
  }

  return { meta, content: match[2].trim() };
}

export async function loadSotDocuments(): Promise<SotDocument[]> {
  const dir = sotDir();
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const docs: SotDocument[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), 'utf-8');
    const { meta, content } = parseFrontmatter(raw);
    docs.push({
      slug: file.replace('.md', ''),
      title: (meta.title as string) ?? file,
      source: (meta.source as string) ?? 'unknown',
      date: (meta.date as string) ?? '',
      confidence: ((meta.confidence as string) ?? 'medium') as SotDocument['confidence'],
      tags: Array.isArray(meta.tags)
        ? meta.tags
        : typeof meta.tags === 'string'
          ? [meta.tags]
          : [],
      content,
    });
  }

  return docs;
}

export function generateStrategyRecommendations(
  analyses: SeasonAnalysis[],
  eraComparison: EraComparison,
  sotDocs: SotDocument[]
): StrategyRecommendation[] {
  const recs: StrategyRecommendation[] = [];

  if (eraComparison.insights.length > 0) {
    recs.push({
      id: 'era-draft-grade',
      title: 'Draft quality declined in recent years',
      detail: eraComparison.insights[0],
      severity: 'critical',
      sotRefs: ['in-season-vs-draft-value'],
    });
  }

  const reachInsight = eraComparison.insights.find((i) =>
    i.toLowerCase().includes('reach')
  );
  if (reachInsight) {
    recs.push({
      id: 'reduce-reaches',
      title: 'Reduce reaches early in the draft',
      detail: reachInsight,
      severity: 'warning',
      sotRefs: ['ppr-10-team-draft-strategy', 'draft-slot-strategy'],
    });
  }

  const qbInsight = eraComparison.insights.find((i) => i.includes('QB'));
  if (qbInsight) {
    recs.push({
      id: 'qb-timing',
      title: 'Revisit QB draft timing',
      detail: qbInsight,
      severity: 'warning',
      sotRefs: ['ppr-10-team-draft-strategy', 'positional-scarcity-and-runs'],
    });
  }

  const badEraAnalyses = analyses.filter((a) =>
    eraComparison.badEra.seasons.includes(a.season)
  );
  const highBustSeasons = badEraAnalyses.filter((a) => a.bustRate >= 0.25);
  if (highBustSeasons.length >= 2) {
    recs.push({
      id: 'bust-rate',
      title: 'High bust rate in recent drafts',
      detail: `Bust rate exceeded 25% in ${highBustSeasons.length} recent seasons. Prioritize safer early-round picks and avoid reaching on unproven players.`,
      severity: 'critical',
      sotRefs: ['historical-bust-rates-by-round'],
    });
  }

  const rbBad = eraComparison.badEra.positionalTiming.RB;
  const rbGood = eraComparison.goodEra.positionalTiming.RB;
  if (rbBad != null && rbGood != null && rbBad > rbGood + 0.5) {
    recs.push({
      id: 'rb-dead-zone',
      title: 'RB investment shifted later — verify value',
      detail: `Your first RB came ${(rbBad - rbGood).toFixed(1)} rounds later in bad years. In PPR, ensure you are not leaving value on the table at RB.`,
      severity: 'info',
      sotRefs: ['ppr-10-team-draft-strategy', 'positional-scarcity-and-runs'],
    });
  }

  if (recs.length < 3 && sotDocs.length > 0) {
    recs.push({
      id: 'sot-baseline',
      title: 'Follow PPR 10-team baseline strategy',
      detail:
        'Anchor early rounds with proven RB/WR value, wait on QB unless elite tier falls, and avoid reaching during positional runs.',
      severity: 'info',
      sotRefs: ['ppr-10-team-draft-strategy'],
    });
  }

  return recs.slice(0, 8);
}

export function attachSotCitations(
  recs: StrategyRecommendation[],
  sotDocs: SotDocument[]
): Array<StrategyRecommendation & { citations: SotDocument[] }> {
  return recs.map((rec) => ({
    ...rec,
    citations: (rec.sotRefs ?? [])
      .map((slug) => sotDocs.find((d) => d.slug === slug))
      .filter((d): d is SotDocument => d != null),
  }));
}
