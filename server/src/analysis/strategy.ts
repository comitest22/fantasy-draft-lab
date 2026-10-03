import fs from 'fs/promises';
import path from 'path';
import type {
  StrategyRecommendation,
  SotDocument,
  EraComparison,
  SeasonAnalysis,
  ContenderPlaybook,
} from '../types';
import { sotDir } from '../data/store';
import { enrichmentStore } from '../data/enrichment';
import {
  formatById,
  formatLearnings,
  hasSuperflex,
  isDefaultLeagueFormat,
  rosterFromFormat,
} from './leagueFormats';
import type { RosterSettings } from '../types';

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
    if ((meta.kind as string) === 'app') continue;
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
  sotDocs: SotDocument[],
  playbook?: ContenderPlaybook,
  format?: { teams: number; formatId: string; roster: RosterSettings }
): StrategyRecommendation[] {
  const recs: StrategyRecommendation[] = [...(playbook?.learnings ?? [])];
  const fromPlaybook = recs.length > 0;
  const preset = formatById(format?.formatId);
  const roster = format?.roster ?? rosterFromFormat(preset);
  const teams = format?.teams ?? 10;
  const superflex = hasSuperflex(roster);

  const consensusRecs = enrichmentStore
    .listExpertTakeaways()
    .filter((t) => t.topic === 'strategy')
    .filter((t) => !(superflex && t.id === 'wait-qb-k-dst-2026'))
    .map((t) => ({
      id: t.id,
      title: t.id === 'hero-rb-2026' ? 'Hero RB, not rigid Zero RB' : t.claim.split('.')[0],
      detail: t.claim,
      severity: 'info' as const,
      sotRefs: ['ppr-10-team-draft-strategy', 'draft-slot-strategy'],
      sources: t.sources,
    }));
  recs.unshift(...consensusRecs);

  if (format && !isDefaultLeagueFormat(teams, preset.id)) {
    recs.unshift(...formatLearnings(teams, roster, preset.label));
  }

  const skipIds = new Set<string>();
  if (roster.wr !== 2 || roster.flex !== 1 || superflex) {
    skipIds.add('lineup-2rb-2wr');
    skipIds.add('copy-wr-open');
  }
  if (roster.wr >= 3) {
    skipIds.add('copy-wr-open');
    skipIds.add('copy-safer-early');
  }
  if (superflex) {
    skipIds.add('copy-wait-qb');
  }

  if (!fromPlaybook && eraComparison.insights.length > 0) {
    recs.push({
      id: 'era-draft-grade',
      title: 'Draft quality declined in recent years',
      detail: eraComparison.insights[0],
      severity: 'critical',
      sotRefs: ['in-season-vs-draft-value'],
    });
  }

  const recIds = new Set(recs.map((r) => r.id));

  const reachInsight = eraComparison.insights.find((i) =>
    i.toLowerCase().includes('reach')
  );
  if (!fromPlaybook && reachInsight) {
    recs.push({
      id: 'reduce-reaches',
      title: 'Reduce reaches early in the draft',
      detail: reachInsight,
      severity: 'warning',
      sotRefs: ['ppr-10-team-draft-strategy', 'draft-slot-strategy'],
    });
  }

  const qbInsight = eraComparison.insights.find((i) => i.includes('QB'));
  if (!fromPlaybook && qbInsight) {
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
  if (highBustSeasons.length >= 2 && !recIds.has('copy-safer-early') && !recIds.has('bust-rate')) {
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
  if (!fromPlaybook && rbBad != null && rbGood != null && rbBad > rbGood + 0.5) {
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

  return recs.filter((r) => !skipIds.has(r.id)).slice(0, 12);
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
