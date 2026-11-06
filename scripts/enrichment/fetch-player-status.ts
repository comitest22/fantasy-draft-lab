/**
 * Refresh ESPN injury / roster status into player-status-{season}.csv.
 * Lighter than a full ranks pull — run mid-week or as part of enrichment:weekly
 * so survivor / cheat-sheet injury overlays stay current.
 *
 *   npm run enrichment:fetch-player-status
 *   npx tsx scripts/enrichment/fetch-player-status.ts --season 2026
 */
import fs from 'fs/promises';
import path from 'path';

const OUT_DIR = path.resolve(__dirname, '../../data/enrichment');
const SEASON_DEFAULT = 2026;
const PAGE = 100;
const FANTASY_PAGES = 20;

const ESPN_TEAM_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 33, 34,
];

type EspnPlayer = {
  id?: number;
  fullName?: string;
  injuryStatus?: string;
  player?: EspnPlayer;
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function csvEscape(value: string | undefined): string {
  const s = value ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function unwrapPlayer(raw: EspnPlayer): EspnPlayer {
  return raw.player ?? raw;
}

async function fetchFantasyPage(season: number, offset: number): Promise<EspnPlayer[]> {
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players` +
    `?scoringPeriodId=0&view=kona_player_info&X-Fantasy-Filter=` +
    encodeURIComponent(
      JSON.stringify({
        players: {
          filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
          limit: PAGE,
          offset,
          sortPercOwned: { sortPriority: 1, sortAsc: false },
        },
      }),
    );
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'fantasy-draft-lab',
      'X-Fantasy-Source': 'kona',
    },
  });
  if (!res.ok) throw new Error(`ESPN players ${res.status}`);
  const body = (await res.json()) as EspnPlayer[] | { players?: EspnPlayer[] };
  return Array.isArray(body) ? body : (body.players ?? []);
}

async function fetchTeamRosterStatuses(teamId: number): Promise<Array<{ playerName: string; status: string }>> {
  const url = `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'fantasy-draft-lab' },
  });
  if (!res.ok) throw new Error(`ESPN roster ${teamId}: ${res.status}`);
  const body = (await res.json()) as {
    athletes?: Array<{
      items?: Array<{
        displayName?: string;
        fullName?: string;
        injuries?: Array<{ status?: string }>;
        status?: { type?: string; name?: string };
      }>;
    }>;
  };
  const out: Array<{ playerName: string; status: string }> = [];
  for (const group of body.athletes ?? []) {
    for (const p of group.items ?? []) {
      const playerName = (p.displayName ?? p.fullName ?? '').trim();
      if (!playerName) continue;
      const injury = (p.injuries?.[0]?.status ?? '').trim();
      const statusType = (p.status?.type ?? p.status?.name ?? '').trim();
      const status = injury || statusType || 'ACTIVE';
      out.push({ playerName, status });
    }
  }
  return out;
}

export async function run(season = SEASON_DEFAULT): Promise<void> {
  const statuses = new Map<string, string>();

  console.log(`Fetching ESPN fantasy injuryStatus (${season})…`);
  for (let offset = 0; offset < FANTASY_PAGES * PAGE; offset += PAGE) {
    const page = await fetchFantasyPage(season, offset);
    if (page.length === 0) break;
    for (const raw of page) {
      const player = unwrapPlayer(raw);
      const playerName = (player.fullName ?? '').trim();
      const status = (player.injuryStatus ?? '').trim();
      if (playerName && status) statuses.set(playerName, status);
    }
    if (page.length < PAGE) break;
  }
  console.log(`  fantasy statuses: ${statuses.size}`);

  console.log('Overlaying live NFL team roster injuries…');
  let rosterHits = 0;
  for (const teamId of ESPN_TEAM_IDS) {
    try {
      const roster = await fetchTeamRosterStatuses(teamId);
      for (const row of roster) {
        // Roster injury text wins when present (closer to game-day designations).
        const prev = statuses.get(row.playerName);
        if (!prev || (!/^active$/i.test(row.status) && row.status !== prev)) {
          statuses.set(row.playerName, row.status);
          if (!/^active$/i.test(row.status)) rosterHits += 1;
        } else if (!prev) {
          statuses.set(row.playerName, row.status);
        }
      }
    } catch (err) {
      console.warn(`  roster ${teamId} skipped: ${(err as Error).message}`);
    }
  }
  console.log(`  roster non-active overlays: ${rosterHits}`);

  // Prefer canonical casing from the first write; dedupe by normalize for stability.
  const byKey = new Map<string, { playerName: string; status: string }>();
  for (const [playerName, status] of statuses) {
    const key = normalizeName(playerName);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || (!/^active$/i.test(status) && /^active$/i.test(prev.status))) {
      byKey.set(key, { playerName, status });
    }
  }

  const rows = [...byKey.values()].sort((a, b) => a.playerName.localeCompare(b.playerName));
  const outPath = path.join(OUT_DIR, `player-status-${season}.csv`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(
    outPath,
    `playerName,status\n${rows.map((r) => `${csvEscape(r.playerName)},${csvEscape(r.status)}`).join('\n')}\n`,
    'utf-8',
  );
  const flagged = rows.filter((r) => !/^active$/i.test(r.status));
  console.log(`Player status: ${flagged.length} non-active of ${rows.length} → ${outPath}`);
}

const invokedDirectly = /fetch-player-status/.test((process.argv[1] ?? '').replace(/\\/g, '/'));
if (invokedDirectly) {
  const arg = process.argv.find((a) => a.startsWith('--season='));
  const seasonArg = arg
    ? parseInt(arg.split('=')[1], 10)
    : process.argv.includes('--season')
      ? parseInt(process.argv[process.argv.indexOf('--season') + 1], 10)
      : SEASON_DEFAULT;
  run(Number.isFinite(seasonArg) ? seasonArg : SEASON_DEFAULT).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
