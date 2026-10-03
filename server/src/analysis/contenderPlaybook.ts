import fs from 'fs/promises';
import path from 'path';
import type {
  ContenderPlaybook,
  DraftFile,
  FranchiseRecord,
  GradedPick,
  LeagueConfig,
  OpeningPattern,
  OpeningPick,
  PodiumTeamSnapshot,
  Position,
  SlotOutcome,
  StrategyRecommendation,
  TimingAdvice,
  TimingProfile,
} from '../types';
import { enrichmentDir } from '../data/store';
import { enrichmentStore } from '../data/enrichment';
import { gradeDraftPicks, computeDraftGrade, computeRates } from './valueOverADP';
import { getFirstRoundForPosition, getNthRoundForPosition } from './positionalTiming';

function avg(nums: Array<number | null | undefined>): number {
  const xs = nums.filter((n): n is number => n != null && !Number.isNaN(n));
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function getSeasonStandings(
  config: LeagueConfig,
  season: number
): Array<{ teamName: string; standing: number }> {
  const map = config.seasons[String(season)]?.teamStandings;
  if (!map) return [];
  return Object.entries(map)
    .map(([teamName, standing]) => ({ teamName, standing }))
    .sort((a, b) => a.standing - b.standing);
}

export function draftSlotFor(draft: DraftFile, teamName: string): number | undefined {
  const pick = draft.picks.find((p) => p.round === 1 && p.fantasyTeamName === teamName);
  return pick?.draftSlot ?? pick?.pickInRound;
}

export function openingPicks(draft: DraftFile, teamName: string, n = 3): OpeningPick[] {
  return draft.picks
    .filter((p) => p.fantasyTeamName === teamName)
    .sort((a, b) => a.overallPick - b.overallPick)
    .slice(0, n)
    .map((p) => ({
      round: p.round,
      overallPick: p.overallPick,
      position: p.position,
      playerName: p.playerName,
    }));
}

function patternOf(picks: OpeningPick[]): string {
  return picks.map((p) => p.position).join('-') || '—';
}

export function formatOpening(picks: OpeningPick[]): string {
  return picks.map((p) => `${p.position} ${p.playerName}`).join(' / ');
}

export function firstRoundFor(
  draft: DraftFile,
  teamName: string,
  position: Position
): number | null {
  const rounds = draft.picks
    .filter((p) => p.fantasyTeamName === teamName && p.position === position)
    .map((p) => p.round);
  if (rounds.length === 0) return null;
  return Math.min(...rounds);
}

function timingFor(
  graded: GradedPick[],
  teamName: string,
  slot?: number
): TimingProfile {
  const rates = computeRates(graded, teamName);
  return {
    rb1: round1(getNthRoundForPosition(graded, teamName, 'RB', 1) ?? 0),
    wr1: round1(getNthRoundForPosition(graded, teamName, 'WR', 1) ?? 0),
    rb2: round1(getNthRoundForPosition(graded, teamName, 'RB', 2) ?? 0),
    wr2: round1(getNthRoundForPosition(graded, teamName, 'WR', 2) ?? 0),
    qb1: round1(getFirstRoundForPosition(graded, teamName, 'QB') ?? 0),
    te1: round1(getFirstRoundForPosition(graded, teamName, 'TE') ?? 0),
    hitRate: rates.hitRate,
    bustRate: rates.bustRate,
    reachRate: rates.reachRate,
    avgSlot: slot ?? 0,
  };
}

function meanTiming(rows: TimingProfile[]): TimingProfile {
  const posAvg = (key: 'rb1' | 'wr1' | 'rb2' | 'wr2' | 'qb1' | 'te1') =>
    round1(avg(rows.map((r) => r[key]).filter((n) => n > 0)));
  return {
    rb1: posAvg('rb1'),
    wr1: posAvg('wr1'),
    rb2: posAvg('rb2'),
    wr2: posAvg('wr2'),
    qb1: posAvg('qb1'),
    te1: posAvg('te1'),
    hitRate: avg(rows.map((r) => r.hitRate)),
    bustRate: avg(rows.map((r) => r.bustRate)),
    reachRate: avg(rows.map((r) => r.reachRate)),
    avgSlot: round1(avg(rows.map((r) => r.avgSlot).filter((n) => n > 0))),
  };
}

export function buildPodiumSnapshot(
  draft: DraftFile,
  config: LeagueConfig
): PodiumTeamSnapshot[] {
  const podium = getSeasonStandings(config, draft.season).filter((t) => t.standing <= 3);
  if (podium.length === 0) return [];
  const graded = gradeDraftPicks(draft.picks);
  return podium.map((t) => {
    const firstThree = openingPicks(draft, t.teamName, 3);
    return {
      teamName: t.teamName,
      standing: t.standing,
      draftSlot: draftSlotFor(draft, t.teamName),
      firstThree,
      firstThreePos: patternOf(firstThree),
      draftGrade: computeDraftGrade(graded, t.teamName),
    };
  });
}

export function seasonContenderInsights(
  draft: DraftFile,
  config: LeagueConfig,
  userTeamName: string | undefined,
  userSlot: number | undefined,
  userFirstThree: OpeningPick[],
  podium: PodiumTeamSnapshot[]
): string[] {
  if (!userTeamName || podium.length === 0) return [];

  const insights: string[] = [];
  const champ = podium.find((p) => p.standing === 1);
  const userPat = patternOf(userFirstThree);

  if (champ) {
    const slotBit =
      champ.draftSlot != null && userSlot != null
        ? ` from slot ${champ.draftSlot} (you were ${userSlot})`
        : champ.draftSlot != null
          ? ` from slot ${champ.draftSlot}`
          : '';
    insights.push(
      `Champion ${champ.teamName} opened ${formatOpening(champ.firstThree)}${slotBit}. You opened ${formatOpening(userFirstThree) || userPat}.`
    );
  }

  const podiumRb = avg(podium.map((p) => firstRoundFor(draft, p.teamName, 'RB')));
  const userRb = firstRoundFor(draft, userTeamName, 'RB');
  if (userRb != null && podiumRb > 0 && userRb + 0.6 < podiumRb) {
    insights.push(
      `Podium teams waited until round ${podiumRb.toFixed(1)} for their first RB; you took one in round ${userRb}.`
    );
  }

  const teEarly = podium.filter((p) => p.firstThree.some((x) => x.position === 'TE'));
  if (teEarly.length >= 1 && !userFirstThree.some((x) => x.position === 'TE')) {
    const names = teEarly.map((p) => `${p.teamName} (${p.firstThree.find((x) => x.position === 'TE')?.playerName})`);
    insights.push(`Podium TE in the first three: ${names.join(', ')}.`);
  }

  const wrFirst = podium.filter((p) => p.firstThree[0]?.position === 'WR');
  if (wrFirst.length >= 2 && userFirstThree[0]?.position === 'RB') {
    insights.push(
      `${wrFirst.length} of ${podium.length} podium teams opened WR; you opened RB ${userFirstThree[0].playerName}.`
    );
  }

  return insights.slice(0, 4);
}

type TeamSeasonRow = {
  season: number;
  teamName: string;
  standing: number;
  slot?: number;
  firstThree: OpeningPick[];
  firstThreePos: string;
  timing: TimingProfile;
  isUser: boolean;
};

async function loadFranchiseIds(): Promise<Map<string, number>> {
  const keyToId = new Map<string, number>();
  try {
    const raw = await fs.readFile(path.join(enrichmentDir(), 'espn-standings.json'), 'utf-8');
    const data = JSON.parse(raw) as {
      seasons?: Record<
        string,
        { teams?: Array<{ teamId: number; name: string }> }
      >;
    };
    for (const [year, season] of Object.entries(data.seasons ?? {})) {
      for (const t of season.teams ?? []) {
        const key = `${year}::${t.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
        keyToId.set(key, t.teamId);
      }
    }
  } catch {
    // optional enrichment
  }
  return keyToId;
}

function rd(n: number): string {
  return `round ${n.toFixed(1)}`;
}

function buildTimingAdvice(
  playbook: Omit<ContenderPlaybook, 'learnings' | 'timingAdvice'>
): TimingAdvice[] {
  const podium = playbook.timing.top3;
  const you = playbook.timing.user;
  if (!podium.rb1 || !you.rb1) return [];

  const takes: TimingAdvice[] = [];
  const topOpen = playbook.openingPatterns.find((p) => {
    const parts = p.pattern.split('-');
    return parts.length === 3 && parts.every((x) => x === 'WR' || x === 'RB' || x === 'TE');
  });

  takes.push({
    id: 'finish-starters',
    title: 'Finish the starting lineup before you hunt upside',
    detail: `Podium teams have an RB1 by ${rd(podium.rb1)} and a WR1 by ${rd(podium.wr1)}${
      podium.rb2 ? `, with the second back around ${rd(podium.rb2)}` : ''
    }. That’s the shape that shows up in top-3 finishes here: the best player available at RB or WR in round 1, the other starter next, and two startable backs before a third receiver or a dart-throw TE. ${
      topOpen
        ? `${topOpen.pattern} is the most common podium open — copy the idea, not a script.`
        : 'Copy the idea, not a script.'
    }`,
  });

  if (you.rb1 + 0.25 <= podium.rb1) {
    takes.push({
      id: 'rb1-patience',
      title: 'Don’t force RB just because it’s round 1',
      detail: `You take your first RB in ${rd(you.rb1)}; podium waits until ${rd(podium.rb1)}. They aren’t skipping the position — they’re taking the better player if it’s a true WR1, then grabbing the workhorse in round 2. Hero-RB from the 1.01 hasn’t won this league. If the board gives you a locked-in receiver, take him and still get your RB1 on the way back.`,
    });
  }

  if (you.rb2 > 0 && podium.rb2 > 0 && you.rb2 >= podium.rb2 + 0.4) {
    takes.push({
      id: 'rb2-sooner',
      title: 'The podium-rate leak is RB2, not RB1',
      detail: `Your second running back lands in ${rd(you.rb2)} vs ${rd(podium.rb2)} for top-3 teams. In a 2-RB, 1-FLEX league that’s the pick that separates lineups you start from lineups you stream. Take RB2 by round 4 even if a shiny third WR is sitting there.`,
    });
  }

  if (you.wr2 > 0 && podium.wr2 > 0 && Math.abs(you.wr2 - podium.wr2) >= 0.5) {
    if (you.wr2 > podium.wr2) {
      takes.push({
        id: 'wr2-sooner',
        title: 'Close the WR2 earlier',
        detail: `Podium has WR2 around ${rd(podium.wr2)}; you wait until ${rd(you.wr2)}. After the first back is on the roster, take the second every-week receiver before you chase QB or a mid-tier TE.`,
      });
    }
  }

  if (you.qb1 > 0 && podium.qb1 > 0 && you.qb1 >= podium.qb1 + 0.8) {
    takes.push({
      id: 'qb-window',
      title: 'Keep waiting on QB — just don’t miss the window',
      detail: `Podium still waits: first QB around ${rd(podium.qb1)}. You wait until ${rd(you.qb1)}. Early QB has rarely won this league, so skip the round-3 run. If a QB you’d start every week is there in the 5–6 range, that’s when winning teams actually take one — don’t slide empty into the late 7s just to “wait.”`,
    });
  } else if (you.qb1 > 0 && podium.qb1 >= 5) {
    takes.push({
      id: 'qb-wait',
      title: 'Stay patient at QB',
      detail: `Podium takes QB in ${rd(podium.qb1)} (you: ${rd(you.qb1)}). That’s a winning pattern here. Let the room panic; spend those early picks on the skill starters that actually move podium rate.`,
    });
  }

  if (you.te1 > 0 && podium.te1 > 0 && you.te1 + 0.8 <= podium.te1) {
    takes.push({
      id: 'te-later',
      title: 'Don’t pay up at TE before the backs are set',
      detail: `You take TE in ${rd(you.te1)}; podium waits until ${rd(podium.te1)}. Elite TE in rounds 2–3 only after an RB is already on the roster. Otherwise TE is a round 5–7 pick once both starting RBs and both starting WRs are in.`,
    });
  }

  if (you.bustRate - podium.bustRate >= 0.04) {
    takes.push({
      id: 'pick-quality',
      title: 'The gap is who you pick, not the round you pick him',
      detail: `Your first-starter rounds already look like a contender’s. The miss is hit rate: podium ${Math.round(podium.hitRate * 100)}% / ${Math.round(podium.bustRate * 100)}% bust vs your ${Math.round(you.hitRate * 100)}% / ${Math.round(you.bustRate * 100)}% bust. In the first four rounds, take the locked-in job over the upside dart. That’s the shortest path to their top-3 rate.`,
    });
  }

  const order = [
    'finish-starters',
    'rb2-sooner',
    'pick-quality',
    'qb-window',
    'rb1-patience',
    'qb-wait',
    'wr2-sooner',
    'te-later',
  ];
  return [...takes]
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .slice(0, 4);
}

function buildLearnings(
  playbook: Omit<ContenderPlaybook, 'learnings'>
): StrategyRecommendation[] {
  const recs: StrategyRecommendation[] = [];
  const slots = [...playbook.slotOutcomes];
  if (slots.length === 0) return recs;

  recs.push({
    id: 'lineup-2rb-2wr',
    title: 'Fill 2 RB and 2 WR before stacking extras',
    detail:
      'This league starts 1QB, 2WR, 2RB, 1TE, 1FLEX. Round 1 is best player at RB or WR. Have an RB1 by round 2 and an RB2 by round 4. Do not take a third WR before the second starting RB. An elite TE in rounds 2–3 is the exception if that name is actually on the board — still finish RB2 by round 4. FLEX is the extra RB/WR/TE after those four starters. Wait on QB until rounds 5–6; kicker and D/ST last.',
    severity: 'critical',
    sotRefs: ['ppr-10-team-draft-strategy', 'positional-scarcity-and-runs'],
  });

  const best = [...slots].sort((a, b) => a.avgFinish - b.avgFinish)[0];
  const worst = [...slots].sort((a, b) => b.avgFinish - a.avgFinish)[0];
  const pick1 = slots.find((s) => s.slot === 1);

  if (best && best.top3Rate >= 0.4) {
    recs.push({
      id: 'copy-best-slot',
      title: `This league’s best seat is pick ${best.slot}`,
      detail: `Pick ${best.slot} has ${best.titles} title${best.titles === 1 ? '' : 's'} and a ${(best.top3Rate * 100).toFixed(0)}% top-3 rate (average finish ${best.avgFinish.toFixed(2)}) across ${best.seasons} seasons. In a ${playbook.leagueSize}-team snake that cluster of picks is the structural edge — take it when you can, and draft like a turn team if you land it.`,
      severity: 'critical',
      sotRefs: ['draft-slot-strategy'],
    });
  }

  if (worst && worst.top3Rate <= 0.15 && worst.avgFinish >= 6) {
    recs.push({
      id: 'avoid-worst-slot',
      title: `Pick ${worst.slot} is the trap seat`,
      detail: `Pick ${worst.slot} has ${worst.titles} titles and a ${(worst.top3Rate * 100).toFixed(0)}% top-3 rate (average finish ${worst.avgFinish.toFixed(2)}). You do not need to “win the draft” from there — prioritize upside at the turn and avoid paying a premium just because the board is sliding.`,
      severity: 'warning',
      sotRefs: ['draft-slot-strategy'],
    });
  }

  if (pick1 && pick1.titles === 0 && pick1.avgFinish >= 6) {
    recs.push({
      id: 'pick-one-is-not-a-title',
      title: 'Pick 1 has not won this league',
      detail: `The 1.01 has ${pick1.titles} championships in ${pick1.seasons} seasons (average finish ${pick1.avgFinish.toFixed(2)}). That is a historical seat note, not a reason to skip RB. Round 1 is still the best player available at RB or WR, and you need two starting RBs by round 4.`,
      severity: 'warning',
      sotRefs: ['ppr-10-team-draft-strategy'],
    });
  }

  const recentChamps = playbook.champions.slice(0, 6);
  const wrFirst = recentChamps.filter((c) => c.firstThree[0]?.position === 'WR').length;
  if (recentChamps.length >= 4 && wrFirst / recentChamps.length >= 0.5) {
    recs.push({
      id: 'copy-wr-open',
      title: 'Recent champs often opened WR — history, not the only path',
      detail: `${wrFirst} of the last ${recentChamps.length} champions took WR first (${recentChamps
        .filter((c) => c.firstThree[0]?.position === 'WR')
        .map((c) => `${c.season} ${c.firstThree[0].playerName}`)
        .join(', ')}). Treat that as a PPR note, not a reason to stack WR. This league starts 2 RB and 2 WR; a third receiver before RB2 is the wrong copy.`,
      severity: 'info',
      sotRefs: ['ppr-10-team-draft-strategy', 'positional-scarcity-and-runs'],
    });
  }

  const teEarly = recentChamps.filter((c) =>
    c.firstThree.some((p) => p.position === 'TE')
  ).length;
  if (recentChamps.length >= 4 && teEarly >= 2) {
    recs.push({
      id: 'copy-early-te',
      title: 'Recent champs spend a top-3 pick on TE',
      detail: `${teEarly} of the last ${recentChamps.length} champions took a TE in the first three picks (${recentChamps
        .filter((c) => c.firstThree.some((p) => p.position === 'TE'))
        .map((c) => {
          const te = c.firstThree.find((p) => p.position === 'TE');
          return `${c.season} ${te?.playerName}`;
        })
        .join(', ')}). Round 1 is still RB or WR. If an elite TE is on the board in rounds 2–3, that is a winning pattern here — take him if the room gives you the name, then still get RB2 by round 4.`,
      severity: 'warning',
      sotRefs: ['positional-scarcity-and-runs'],
    });
  }

  const top3 = playbook.timing.top3;
  const user = playbook.timing.user;
  if (user.rb1 > 0 && top3.rb1 > 0 && user.rb1 + 0.4 < top3.rb1) {
    recs.push({
      id: 'copy-rb-patience',
      title: 'Podium teams wait slightly longer on RB than you do',
      detail: `Top-3 teams take their first RB in round ${top3.rb1.toFixed(1)} on average; you take one in round ${user.rb1.toFixed(1)}. They are more willing to start WR and still land a starter RB in round 2. Let RB slide a pick later only if the WR is clearly the best player available — you still need two starting RBs by round 4.`,
      severity: 'warning',
      sotRefs: ['ppr-10-team-draft-strategy'],
    });
  }

  if (user.bustRate - top3.bustRate >= 0.04) {
    recs.push({
      id: 'copy-safer-early',
      title: 'Your early-round bust rate is higher than the podium',
      detail: `Podium teams bust on ${(top3.bustRate * 100).toFixed(0)}% of picks vs your ${(user.bustRate * 100).toFixed(0)}%. The emulate move is proven WR/RB value the first two rounds, a second starter at the thinner of RB/WR by round 4, then TE or FLEX — not a third WR before RB2.`,
      severity: 'critical',
      sotRefs: ['historical-bust-rates-by-round'],
    });
  }

  if (top3.qb1 >= 5 && Math.abs(user.qb1 - top3.qb1) < 2) {
    recs.push({
      id: 'copy-wait-qb',
      title: 'Keep waiting on QB — champs do too',
      detail: `Podium teams take their first QB in round ${top3.qb1.toFixed(1)} on average (you: ${user.qb1.toFixed(1)}). Early QB has rarely won this league. Do not copy a random early QB just to “get one”; copy the skill-position stack instead.`,
      severity: 'info',
      sotRefs: ['ppr-10-team-draft-strategy'],
    });
  }

  const topFranchises = playbook.franchises.filter((f) => f.titles >= 2).slice(0, 2);
  if (topFranchises.length > 0) {
    recs.push({
      id: 'study-repeat-winners',
      title: `Study ${topFranchises.map((f) => f.displayName).join(' and ')}`,
      detail: topFranchises
        .map(
          (f) =>
            `${f.displayName} has ${f.titles} titles and ${f.top3} top-3s (average finish ${f.avgFinish.toFixed(2)}).`
        )
        .join(' ') +
        ' They win from several slots — copy their recent openings as the best player available at WR/RB, then fill the other starter, not a WR stack that skips RB2.',
      severity: 'info',
    });
  }

  const overIndex = playbook.openingPatterns.find(
    (p) => p.top3Count >= 3 && p.top3Pct >= p.leaguePct + 0.04
  );
  if (overIndex) {
    recs.push({
      id: 'copy-opening-pattern',
      title: `Podium opening to copy: ${overIndex.pattern}`,
      detail: `${overIndex.pattern} is ${(overIndex.top3Pct * 100).toFixed(0)}% of podium opens vs ${(overIndex.leaguePct * 100).toFixed(0)}% of all drafts. Copy that first-three shape when the board allows it — then still complete 2 RB and 2 WR starters by round 4 rather than stacking a third WR.`,
      severity: 'info',
      sotRefs: ['ppr-10-team-draft-strategy'],
    });
  }

  return recs.slice(0, 9);
}

function playbookSignature(drafts: DraftFile[], config: LeagueConfig): string {
  const draftPart = drafts.map((d) => `${d.season}:${d.picks.length}`).join(',');
  const standings = Object.entries(config.seasons)
    .map(([year, s]) => `${year}:${JSON.stringify(s.teamStandings ?? {})}:${s.userTeamName ?? ''}`)
    .join('|');
  return `${draftPart}::${standings}::${JSON.stringify(config.roster ?? {})}::timing-advice-v2`;
}

let playbookCache: { sig: string; data: ContenderPlaybook } | null = null;
let playbookInflight: Promise<ContenderPlaybook> | null = null;

export async function buildContenderPlaybook(
  drafts: DraftFile[],
  config: LeagueConfig
): Promise<ContenderPlaybook> {
  const sig = playbookSignature(drafts, config);
  if (playbookCache?.sig === sig) return playbookCache.data;
  if (playbookInflight) return playbookInflight;

  playbookInflight = computeContenderPlaybook(drafts, config)
    .then((data) => {
      playbookCache = { sig, data };
      return data;
    })
    .finally(() => {
      playbookInflight = null;
    });
  return playbookInflight;
}

async function computeContenderPlaybook(
  drafts: DraftFile[],
  config: LeagueConfig
): Promise<ContenderPlaybook> {
  await enrichmentStore.load();
  const franchiseIds = await loadFranchiseIds();

  const rows: TeamSeasonRow[] = [];
  for (const draft of drafts) {
    const standings = getSeasonStandings(config, draft.season);
    if (standings.length === 0) continue;
    const userName = config.seasons[String(draft.season)]?.userTeamName;
    const teams = [...new Set(draft.picks.map((p) => p.fantasyTeamName))];
    const graded = gradeDraftPicks(draft.picks);
    for (const teamName of teams) {
      const standing = standings.find((s) => s.teamName === teamName)?.standing;
      if (standing == null) continue;
      const slot = draftSlotFor(draft, teamName);
      const firstThree = openingPicks(draft, teamName, 3);
      rows.push({
        season: draft.season,
        teamName,
        standing,
        slot,
        firstThree,
        firstThreePos: patternOf(firstThree),
        timing: timingFor(graded, teamName, slot),
        isUser: teamName === userName,
      });
    }
  }

  const emptyTiming: TimingProfile = {
    rb1: 0,
    wr1: 0,
    rb2: 0,
    wr2: 0,
    qb1: 0,
    te1: 0,
    hitRate: 0,
    bustRate: 0,
    reachRate: 0,
    avgSlot: 0,
  };

  if (rows.length === 0) {
    const empty: ContenderPlaybook = {
      seasons: 0,
      leagueSize: config.leagueSize,
      slotOutcomes: [],
      timing: { top3: emptyTiming, user: emptyTiming, league: emptyTiming },
      timingAdvice: [],
      champions: [],
      openingPatterns: [],
      franchises: [],
      learnings: [],
    };
    return empty;
  }

  const bySlot = new Map<number, TeamSeasonRow[]>();
  for (const row of rows) {
    if (row.slot == null) continue;
    const list = bySlot.get(row.slot) ?? [];
    list.push(row);
    bySlot.set(row.slot, list);
  }

  const slotOutcomes: SlotOutcome[] = [...bySlot.entries()]
    .map(([slot, list]) => {
      const titles = list.filter((r) => r.standing === 1).length;
      const top3Count = list.filter((r) => r.standing <= 3).length;
      return {
        slot,
        seasons: list.length,
        avgFinish: round1(avg(list.map((r) => r.standing))),
        titles,
        top3Count,
        top3Rate: top3Count / list.length,
      };
    })
    .sort((a, b) => a.slot - b.slot);

  const top3Rows = rows.filter((r) => r.standing <= 3);
  const userRows = rows.filter((r) => r.isUser);

  const countPatterns = (list: TeamSeasonRow[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of list) {
      m.set(r.firstThreePos, (m.get(r.firstThreePos) ?? 0) + 1);
    }
    return m;
  };
  const top3Pat = countPatterns(top3Rows);
  const leaguePat = countPatterns(rows);
  const openingPatterns: OpeningPattern[] = [...top3Pat.entries()]
    .map(([pattern, top3Count]) => ({
      pattern,
      top3Count,
      top3Pct: top3Count / top3Rows.length,
      leaguePct: (leaguePat.get(pattern) ?? 0) / rows.length,
    }))
    .sort((a, b) => b.top3Count - a.top3Count)
    .slice(0, 8);

  const champions = rows
    .filter((r) => r.standing === 1)
    .sort((a, b) => b.season - a.season)
    .map((r) => ({
      season: r.season,
      teamName: r.teamName,
      draftSlot: r.slot,
      firstThree: r.firstThree,
      firstThreePos: r.firstThreePos,
    }));

  const byFranchise = new Map<
    string,
    { names: string[]; titles: number; top3: number; finishes: number[] }
  >();
  for (const row of rows) {
    const idKey = `${row.season}::${row.teamName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const fid = franchiseIds.get(idKey);
    const key = fid != null ? `id:${fid}` : `name:${row.teamName.toLowerCase()}`;
    const cur = byFranchise.get(key) ?? { names: [], titles: 0, top3: 0, finishes: [] };
    if (!cur.names.includes(row.teamName)) cur.names.push(row.teamName);
    if (row.standing === 1) cur.titles += 1;
    if (row.standing <= 3) cur.top3 += 1;
    cur.finishes.push(row.standing);
    byFranchise.set(key, cur);
  }

  const userNames = new Set(
    Object.values(config.seasons)
      .map((s) => s.userTeamName)
      .filter((n): n is string => !!n)
  );

  const franchises: FranchiseRecord[] = [...byFranchise.values()]
    .map((f) => ({
      displayName: f.names[f.names.length - 1],
      names: f.names,
      titles: f.titles,
      top3: f.top3,
      avgFinish: round1(avg(f.finishes)),
      isUser: f.names.some((n) => userNames.has(n)),
    }))
    .sort((a, b) => b.titles - a.titles || b.top3 - a.top3);

  const playbook: Omit<ContenderPlaybook, 'learnings'> = {
    seasons: new Set(rows.map((r) => r.season)).size,
    leagueSize: config.leagueSize,
    slotOutcomes,
    timing: {
      top3: top3Rows.length ? meanTiming(top3Rows.map((r) => r.timing)) : emptyTiming,
      user: userRows.length ? meanTiming(userRows.map((r) => r.timing)) : emptyTiming,
      league: meanTiming(rows.map((r) => r.timing)),
    },
    timingAdvice: [],
    champions,
    openingPatterns,
    franchises,
  };
  playbook.timingAdvice = buildTimingAdvice(playbook);

  return { ...playbook, learnings: buildLearnings(playbook) };
}
