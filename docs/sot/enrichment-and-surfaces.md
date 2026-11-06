---
title: Enrichment and App Surfaces
source: BLITZ app internals
date: 2026-09-14
confidence: high
kind: app
tags: [app, enrichment, navigation, data]
---

# Enrichment and App Surfaces

App-internal catalog of data files, scripts, analysis consumers, and where they show up in the UI. SOS details live in `docs/sot/strength-of-schedule.md`. Routes details live in `docs/sot/draft-routes.md`. Cheat Sheets details live in `docs/sot/cheat-sheets.md`. Consensus ECR / units / takeaways live in `docs/sot/expert-consensus.md`. Tuesday/Friday automation lives in `docs/sot/weekly-refresh.md`. Season roster hub lives in `docs/sot/my-team.md`.

## App map

Brand: **B.L.I.T.Z.** (*Boards, Lineups, Insights, Tools, & Zero-suck* — header badge + title tooltip in `client/src/components/Layout.tsx`, `<title>B.L.I.T.Z.</title>` in `client/index.html`, and hero lockup on `client/src/pages/HomePage.tsx`).
Nav: **Home · Seasons · Tools · Import · Insights · Strategy · My Team** — icon-only links with native `title` tooltips in the header (`client/src/nav/appNav.tsx` + `Layout.tsx` on non-Home routes; larger Bungee `B.L.I.T.Z.` badge). Non-Home page `<h1>`s use `PageTitle` with the matching section icon (larger bordered tile beside the heading). Hub children use Insights-style crumbs (`Parent › Child` via `.page-intro .crumb`) — e.g. Strategy › NFL Survivor / Draft Strategy / TD Streak; Tools › In Season › Strength of Schedule / Tools › Draft › Cheat Sheet / Draft Trends; Insights › Draft Learnings / Takeaways; Seasons › {year} Draft. `.page-intro` uses a column gap (looser with a crumb, and again with a toolkit badge) so the crumb / icon title / subtitle are not cramped. Subpages with a crumb use the tighter Cheat Sheets–style top padding under the header (`.main:has(.page-intro .crumb)`). Hub children with a crumb show a circular subpage badge anchored **top-right** on the section icon (Tools toolkit icons; Insights learnings/takeaways; Strategy draft/survivor/loser/TD streak; Seasons draft detail). On `/`, the top header is hidden and the vertically centered launchpad has the logo + `B.L.I.T.Z.`, spelled-out acronym, search bar, and the same icon set with labels under each (no Home tile, no tooltips). Every non-Home route sets `html.force-y-scroll` so the vertical scrollbar stays visible and hub ↔ subpage navigations don’t shift. Full-page fetches use a centered bouncing-squares loader (`PageLoading`) with a per-page saying instead of plain status text.

| Route | Page | What it shows |
|-------|------|----------------|
| `/` | HomePage | Centered launchpad with the icon + **B.L.I.T.Z.** logo, the spelled-out acronym (*Boards, Lineups, Insights, Tools, & Zero-suck*) underneath, the player search bar (`HeaderSearch`) under the acronym on the **search board** (`GET /routes/search-board`: ESPN PPR top-500 ranks + `espn-depth-2026.csv` roster extras + any missing YTD scorers + **all 32 D/ST** with team-abbr / nickname matching), and six icon + small-label controls (**Seasons**, **Tools**, **Import**, **Insights**, **Strategy**, **My Team**) in one row under the search bar (icon tile + label only, no outer card; launchpad vertically + horizontally centered on `/`). **Tools**, **Insights**, and **Strategy** toggle the same inline flyout: hover lifts the tile; while open it stays accent-bordered and sits slightly lower with an inset “pressed” shadow, revealing dests in one shared box centered under the icon (absolutely positioned so the launchpad does not shift; only one flyout open at a time; click again to release). Each row uses the Tools-style icon tile + label (`client/src/nav/homeFlyoutIcons.tsx` + toolkit icons). Tools → **In Season** / **Draft** (`/tools?toolkit=…`); Insights → **Draft Learnings** / **Draft Takeaways**; Strategy → **Draft** / **NFL Survivor** / **NFL Survivor Loser** / **TD Streak**. Header **Tools** / **Insights** / **Strategy** use the same flyout panel left-aligned under the nav icon (**Strategy** flips right-aligned under `1390px` so it isn’t clipped): **hover** opens, **click** pins it open until click again / outside / Escape (tight under the icon, no pressed shift). Tools crumbs link to `/tools` like other hubs (no modal). Home flyouts stay click-to-toggle and centered under the tile. Compare (`GET /routes/compare`) resolves the same way — including deep D/ST ESPN omits from the published PPR board (weekly ranks also append any missing D/ST into `adp.csv`). Season **Current Pos. Rank** is YTD at the position (skill: `fantasy-points`; D/ST: game-log FPTS among 32 — same idea as My Team / FA **PRK**), not ROS projection ranks; **ESPN Current Rank** is the overall ESPN board number. Draft Routes / Cheat Sheets still use the ranked ADP board only. Header / Home search opens a player with `?player=` on the **current path** (not a redirect to `/`) via `HeaderSearch` → `PlayerSearchBio` in `Layout` (`PlayerCompareDialog` `variant="roster"`: Week/ROS pills, WEEK PROJECTION, clickable Depth Chart, Draft/Season stats, roster game log, news, SOS — **no** `BioRosterRail`; that strip stays My Team–only). Closing clears `player` / `article` query params and leaves you on the same page. |
| `/seasons` | SeasonsPage | Season cards: grade, finish, hit/reach rates (2014–2026). 2026 has no finish yet. |
| `/season/:season` | SeasonDetailPage | Graded board, PodiumCompare vs that year’s podium. **In-progress seasons** (no `fantasy-points.csv` rows yet, currently 2026): pick badges are steal/reach vs ESPN PPR rank, draft grade is ADP-delta process score (50 + avg capped `ADP − overall`), and Era averages skip that year. Pick cards show `ESPN #n · ±k vs ADP`. |
| `/tools` | ToolsPage | Hub like Insights/Strategy: all tool cards on bare `/tools`; `?toolkit=in-season|draft` filters + crumb `Tools › In Season|Draft` with circular badge. Home/header flyout deep-links with `?toolkit=`. Cards: In Season → SOS; Draft → Cheat Sheets + Draft Trends. |
| `/tools/sos` | SosPage | Crumb `Tools › In Season › Strength of Schedule` (`Tools` → `/tools`; `In Season` → `/tools?toolkit=in-season`); In Season circular badge top-right on Tools icon. List (consensus remaining-slate), Offense (Source B weekly grid + Filter ROS/Top ranked/A–Z/Z–A), Defense (D/ST weekly grid + Filter ROS/Top ranked through-week PA/A–Z/Z–A) |
| `/tools/cheatsheet` | CheatSheetsPage | Crumb `Tools › Draft › Cheat Sheet` (`Tools` → `/tools`; `Draft` → `/tools?toolkit=draft`); Draft circular badge top-right on Tools icon. Live-draft checklist: PPR or ESPN Standard rank, position filter, pick-slot snake context, thin bars at every remaining snake pick, crumb scrolls away, sticky My team (positional rank pill in pos color + full name) + Watch list (right-click names) + filters, `^`/`v` to collapse those two cards, ✓/× (amber, checkbox checked+disabled), Steal/Reach chips vs ECR with live paren that only improves after they fall past their ESPN rank, check-off + right-click highlight (`localStorage`; highlight drops when checked or on My team; **Clear watchlist** on the card and toolbar). Name click opens the Home/Routes compare card in a centered modal with same-team positional depth under the stats and the current-season Game Log (year dropdown) expanded with a positional SOS week row above it (no news). |
| `/tools/trends` | TrendsPage | Crumb `Tools › Draft › Draft Trends` (`Tools` → `/tools`; `Draft` → `/tools?toolkit=draft`); Draft circular badge top-right on Tools icon. Podium · Era · Grades · Rates. Takeaways live on Insights. Legacy `/trends` redirects here. |
| `/import` | ImportPage | ESPN `.docx` draft import + league-config mapping, plus **Import League** (live `mTeam`/`mRoster` → `data/my-team/{season}.json`). 2026 board is `data/drafts/2026.json` (**Drake 'n Bake**, slot 8). |
| `/insights` | InsightsPage | Hub (Tools-style cards): **Draft Learnings**, **Draft Takeaways**. |
| `/insights/learnings` | LearningsPage | Draft path learnings (default 10-team 2 WR / 1 FLEX). Crumb `Insights › Draft Learnings`. |
| `/insights/takeaways` | TakeawaysPage | Podium timing advice. Crumb `Insights › Draft Takeaways`. |
| `/strategy` | StrategyHubPage | Four cards: Draft, NFL Survivor, NFL Survivor Loser, TD Streak |
| `/strategy/draft` | StrategyPage | Dropdowns above the pills set **teams** (8/10/12/14) and **roster** (2 WR / 1 FLEX default, plus 2FLEX, 3WR, Superflex combos). Those drive Routes, Values, and Landmines via `GET /strategy?teams=&format=`. **Podium** and **Era** stay on this league’s real history. Learnings / Takeaways live under Insights. Routes · Values · Landmines · Podium · Era · Research |
| `/strategy/survivor` | SurvivorPage | Winner survivor Week + Season + Picks. Week: top-3 cards + **Contrarian** (low ownership) with win % pills and green/red pro/con bullets; chalk #1 gets an info tooltip; **Ctx** ± column after PG win; Pros | Cons notes under each row. Picks: week squares with 8px gap, dropdown opens **to the right**, heat + 3px white focus ring, Current Week label, W/L pale fill with thicker borders, lock circles, BPA leftover fill, survival product. PoolGenius + rest/travel/weather/injury overlay (QB/RB1/WR1 outs, established-QB1 rookies only; opp holes flip). |
| `/strategy/survivor-loser` | SurvivorPage | Same three tabs, inverted for loser-pool dogs, same overlay (sign flipped) |
| `/strategy/td-streak` | TdStreakPage | Anytime-TD path: unique starters (hardest weeks first for survival product), week 1 two starters + backup; later weeks one starter + backup. Sitting as backup does not use a player; Tuesday burns whoever actually played on the starter card. Swap lists every weekly-legal RB/WR/TE/QB (position, then % to score descending) plus this week’s backup when swapping a starter; rectangle Lock/Refresh/Swap icons sit under each path card; Lock pins it and disables Refresh/Swap. Season-path chips: remaining-season survival plus next-5-weeks survival; **Best Path Available** above those chips refills unlocked leftover weeks around locked and finished starters. Plain-English matchup reason, % to score, path-card lines under the name with vs/at · date · weather or closed-dome icon, then this week’s home/away TD split vs that opponent, green/red ring after the week is final. |
| `/my-team` | MyTeamPage | **Lineup** / **Stats** / **Players** pills. Lineup: Starters/Bench/IR (Opp, Status+weather, Proj, Score, OPRK, %Rost, PRK, FPTS, Avg, Last); calendar (**Upcoming Schedule**) expands remaining-slate SOS with **Upcoming Schedule:** on top and a flush league label + week strip below (**ESPN** + **BLENDED** only while `completedWeeks < 4`, then ESPN alone; SOS-sized week squares, translucent green current-week mark); person/+ icon expands best-available FA (default **Proj** desc); **VS** expands strip with **Week {n} Matchup:** above `{OPP} vs {POS}` (order when stacked: schedule → VS → FA). Lineup/Stats **Filter** (single-select Show All / pos-only + Filter/Reset). **Stats** / **Players** reuse calendar + **VS** (FA rows get `vsMatchup` from free-agents enrich). **Players** = ESPN free-agent/waiver pool (`GET /api/team/free-agents?includeSos=1`). Stats: QB / Backs&Receivers / D/ST / K from `GET /api/team?stats=1`. **Sync roster**; empty / Update connection → Import League. See `docs/sot/my-team.md`. |

Section pills (`PageTabs` on Draft Strategy, Trends, SOS, Survivor) scroll with the page. They are not sticky. As the bar passes under the translucent `.header`, pill opacity fades to 0 so they do not show through; scrolling back restores them. Switching a tab still `scrollTo({ top: 0 })`.

## Enrichment files (`data/enrichment/`)

Runtime loading is `server/src/data/enrichment.ts`. Team codes are canonicalized (`LAR/STL→LA`, `JAC→JAX`, `WSH→WAS`, and similar). Store reloads when `adp.csv` mtime changes.

| File | Source | Runtime? | Used for |
|------|--------|----------|----------|
| `adp.csv` | ESPN PPR ranks + Mike Clay expected points | Yes | Grades, route board, Cheat Sheets PPR order |
| `fantasy-points.csv` | nflverse actual PPR (weekly YTD for the in-progress year) | Yes | Grades (completed seasons only), compare last-year **and 2026 YTD** points |
| `draft-picks.csv` | nflverse | Yes | Rookie flags on grades |
| `espn-ppr-overall/{year}.csv` | ESPN PDF / live API | Indirect (feeds `adp.csv`) | Historical + 2026 board (top **500** PPR draft ranks) |
| `espn-depth-2026.csv` | ESPN percent-owned sweep past the ranked board, kept only if on that team's live ESPN roster (`fetch-espn-ranks.ts`; includes `espnId`) | Yes | Header search + player bio + team positional depth extras for rostered names past the top-500 draft board |
| `espn-ids-2026.csv` | Same ranks/depth sweep | Yes | Athlete ids for `GET /routes/gamelog` when the player is not on the live top-board id scan |
| `site-ranks-espn-ppr-2026.csv` | Manual | Yes | Landmine, ESPN vs FP, team QB map |
| `site-adp-2026.csv` | Manual | Yes | ESPN vs Sleeper / Yahoo / Underdog |
| `sos-2026.csv` | DraftEdge remaining-slate 1–5 | Fallback | Raw input to consensus SOS; used if consensus file missing |
| `consensus-sos-2026.csv` | `build-consensus.ts` (DraftEdge + FPA board) | Yes | Runtime Source A / path SOS |
| `consensus-ranks-2026.csv` | `build-consensus.ts` (FP column or ECR export) | Yes | ECR, ESPN−ECR, sleeper gap, spread |
| `consensus-units-2026.csv` | `build-consensus.ts` (AN + PFF + Sharp + power) | Yes | 2026 Off/OL overlay, D-line, power |
| `consensus-meta.json` | `build-consensus.ts` | Note only | Sources + date |
| `expert-takeaways.json` | Hand-authored | Yes | Learnings, route blurbs, Home/Compare player claims |
| `nfl-schedule-2026.csv` | ESPN, `fetch-sos-schedule.ts` | Yes | SOS Offense weeks + Defense tab + rest/travel/played-game context (`kickoff,status,scores`) |
| `defense-ranks-2025.csv` / `defense-ranks-2026.csv` | ESPN, `fetch-sos-schedule.ts` | Fallback | Rank files if stats are missing |
| `offense-ranks-2025.csv` / `offense-ranks-2026.csv` | ESPN points scored | Fallback | Rank files if stats are missing; bio Season **Offense (YTD PF)** inverts polarity (1 = most PF) |
| `oline-ranks-2026.csv` | nflverse PBP REG sack rate via `fetch-oline-ranks.ts` (Tue/Fri) | Yes | Bio Season **O-line (sack %)** — 1 = lowest sack rate |
| `defense-stats-2025.csv` / `defense-stats-2026.csv` | ESPN PA / opp **net** pass (byteam values[7], not gross values[0]) / opp rush | Yes | Blended opponent strength; Lineup vs strip uses nflverse for QB pass yds/TDs |
| `offense-stats-2025.csv` / `offense-stats-2026.csv` | ESPN points scored | Yes | Blended D/ST opponent strength |
| `season-state.json` | `fetch-sos-schedule.ts` | Yes | `{ season, completedWeeks, currentWeek, asOf }` |
| `espn-oprk-2026.json` | League `positionAgainstOpponent`, `fetch-espn-oprk.ts` (Tue/Fri; needs ESPN cookies) — stores OPRK ranks **and** FP/game `averages` | Yes | My Team OPRK column + ESPN SOS strip when live cookies are absent; Lineup **vs** expand Rank/FPA; bio WEEK PROJECTION `{OPP} vs {POS}:` / `{OPP} FPA to {POS}:`; soft-anchors Source B QB/RB/WR/TE ranks (60% stats / 40% ESPN) in `buildBlendedRanks`; bio platform ratings ESPN column |
| `platform-player-ranks-2026.json` | Per-player Week + ROS **positional** PPR ranks (QB/RB/WR/TE/**K**/**D/ST**), `fetch-platform-player-ranks.ts` (Tue/Fri; Sleeper via `pts_ppr`, DEF→D/ST; CBS K uses nonppr pages) | Yes | My Team bio platform ratings (column = import `platform` only) |
| `sleeper-oprk-2026.json` / `cbs-oprk-2026.json` | Legacy positional points-against matrices (optional scripts; not used by bio ratings) | No | Kept for reference only |
| `espn-week-scoring-2026.json` | League `mRoster` week proj/score/last/%Rost, `fetch-espn-week-scoring.ts` (Tue/Fri; needs ESPN cookies) | Yes | My Team Proj / Score / Last / %Rost when live cookies are absent |
| `player-usage-2026.csv` | nflverse `player_stats` + `snap_counts` + PBP dropbacks; ESPN YPRR for RTE% via `fetch-player-usage.ts` (Tue/Fri) | Yes | My Team Stats usage: SNAP%, RTE%, AIR, YAC, aDOT, CARY% |
| `nfl-venues.json` | Static stadiums | Yes | Lat/lon, tz, roof, division |
| `game-context-2026.json` | `fetch-game-context.ts` | Yes | Road records, QB weather flag, Open-Meteo forecasts |
| `player-status-2026.csv` | ESPN fantasy `injuryStatus` + live NFL roster injuries (`fetch-player-status.ts`, also rewritten by `fetch-espn-ranks.ts`) | Yes | Survivor / Loser injury overlay; Routes and Cheat Sheets SUS / IR / Exempt badges |
| `team-ranks-2025.csv` / `team-ranks-2026.csv` | Action Network, static | Yes | 2025 prior for Off/OL YoY; 2026 overlaid by consensus units |
| `espn-ranks-meta.json` | `fetch-espn-ranks.ts` | Yes (note only) | Routes subtitle “ranks pulled {date}”; includes ranked + depth counts |
| `espn-standings.json` | ESPN league snapshot | Playbook franchise IDs; not EnrichmentStore | Podium continuity |
| `poolgenius-survivor-2026.json` | PoolGenius Data Grid scrape | Yes | Strategy → NFL Survivor / Loser + TD Streak win%; current week in the JSON |
| `td-player.csv` | nflverse weekly rush+rec TDs, `build-td-matchups.ts` | Yes | TD Streak hit rate, positional TD share, green/red scored-TD rings |
| `td-defense-by-pos.csv` | nflverse weekly yards/TDs allowed by position | Yes | TD Streak vs-position matchup, last-game allowed, league ranks; My Team Lineup **vs** expand season **total** TDs + combined Yds/g fallback (RB/WR/TE); air/rush Yds/g · L3 · split TDs use weekly cache |
| `td-player-games.csv` | nflverse player-week rush+rec TDs plus rush att/yds, rec, rec yds, targets, and **home** (1/0 from `game_id` or nflverse schedules); last 5 seasons | Yes | TD Streak card totals, last 5 games, vs-opponent hit % / box-score line, **home/away TD split vs this opponent**; window labels use tenure (**N years**, **5 years**, or **5+**) |

`data/league-config.json` (not under enrichment/) is the runtime league: size 10, PPR, snake, roster, era cutovers, `upcomingDraftSlot`, per-season user team / finish / `teamStandings`.

`data/my-team/{season}.json` is the imported ESPN season roster for My Team (connection ids + players by lineup slot). Cookies for refresh live in gitignored `data/secrets/espn-auth.json` or `.env` (`ESPN_S2` / `ESPN_SWID`). See `docs/sot/my-team.md`. My Team bio name-card pool badge uses live `GET /api/team/availability?name=` → ESPN league `kona_player_info` (FA / Waivers / Owned / Owned by you).

## Scripts (`scripts/enrichment/`)

| Script | npm | Writes |
|--------|-----|--------|
| `refresh.ts` | `enrichment:refresh` | Status / instructions (points at weekly) |
| `weekly.ts` | `enrichment:weekly` | Tuesday (after MNF) and Friday (after TNF) orchestrator (schedule, ESPN OPRK, platform player ranks, week scoring, ranks, YTD points, PoolGenius, context, consensus) |
| `fetch-espn-oprk.ts` | `enrichment:fetch-espn-oprk` | `espn-oprk-{season}.json` — ESPN `positionAgainstOpponent` matrix (1 = toughest) for My Team OPRK; needs `ESPN_S2` / `ESPN_SWID`; league id from `my-team/{season}.json` or `ESPN_LEAGUE_ID` |
| `fetch-platform-player-ranks.ts` | `enrichment:fetch-platform-player-ranks` | `platform-player-ranks-{season}.json` — per-player Week + ROS overall PPR ranks for bio ratings |
| `fetch-sleeper-oprk.ts` / `fetch-cbs-oprk.ts` | optional | Legacy opponent points-against matrices (not wired to bio) |
| `fetch-espn-week-scoring.ts` | `enrichment:fetch-espn-week-scoring` | `espn-week-scoring-{season}.json` — ESPN week proj (`statSourceId=1`), score (`statSourceId=0`), prior-week actual, and `%Rost` (`ownership.percentOwned`) by `espnId` |
| `fetch-player-status.ts` | `enrichment:fetch-player-status` | `player-status-{season}.csv` only (mid-week / Tue+Fri injury refresh for survivor) |
| `fetch-espn-ranks.ts` | `enrichment:fetch-espn-ranks` | `espn-ppr-overall/{season}.csv` (top 500 PPR ranks → also merges `adp.csv`), `espn-depth-{season}.csv` (roster-filtered extras + `espnId`), `espn-ids-{season}.csv` (athlete ids for game logs), `espn-ranks-meta.json`, `player-status-{season}.csv` |
| `fetch-poolgenius.ts` | `enrichment:fetch-poolgenius` | `poolgenius-survivor-2026.json` plus `poolgenius-account.json` (logout, free-trial signup as the next numbered email, then login; a retry within 18 hours reuses that account; unpublished week after 5PM Eastern keeps the previous snapshot; week from `--week` or `season-state.json`; finished weeks locked with last % + W/L + score) |
| `build-consensus.ts` | `enrichment:build-consensus` | `consensus-ranks-2026.csv`, `consensus-sos-2026.csv`, `consensus-units-2026.csv`, `consensus-meta.json` |
| `fetch-sos-schedule.ts` | `enrichment:fetch-sos-schedule` | `nfl-schedule-2026.csv`, D/O stats+ranks for 2025 and 2026, `season-state.json` |
| `fetch-game-context.ts` | `enrichment:fetch-game-context` | `game-context-2026.json` |
| `analyze-top-teams.ts` | none | `league-config.json` standings, `top-team-analysis.json` |
| `import-rankings.ts` | `enrichment:import-rankings` | `adp.csv` |
| `apply-clay-projections.ts` | `enrichment:apply-projections` | `adp.csv` + overall CSVs |
| `import-fantasy-points.ts` | `enrichment:import-fantasy-points` | `fantasy-points.csv` |
| `fetch-player-usage.ts` | `enrichment:fetch-player-usage` | `player-usage-{season}.csv` — snap %, air yards, YAC, aDOT, target/carry share from nflverse; RTE% ≈ ESPN YPRR routes ÷ team PBP dropbacks (interim until mid-season participation) |
| `fetch-oline-ranks.ts` | `enrichment:fetch-oline-ranks` | `oline-ranks-{season}.csv` — team O-line proxy from nflverse PBP REG sack rate (1 = lowest) |
| `build-td-matchups.ts` | `enrichment:build-td-matchups` | `td-player.csv`, `td-defense-by-pos.csv` (prior + current year), `td-player-games.csv` (up to 5 seasons of player-week TDs + rush/rec/targets/yards + home from `game_id` / schedules) |
| `import-draft-picks.ts` | `enrichment:import-draft-picks` | `draft-picks.csv` |

There is **no fetch script** for `sos-2026.csv` or `team-ranks-*.csv`. Rebuild consensus after dropping new raw CSVs: `npm run enrichment:build-consensus`.

## Analysis modules → data

| Module | Enrichment | UI |
|--------|------------|----|
| `valueOverADP` | ADP, fantasy points, draft picks | Seasons, season detail, Tools → Draft Trends grades. If a season is **in progress** (`completedWeeks < 18`), skip EOS bust math even when YTD PPR rows exist; steal/reach vs ESPN rank only; Era averages omit that year. |
| `eraCompare` | Via graded seasons | Strategy / Tools → Draft Trends Era |
| `positionalTiming` | Graded picks | Timing advice / takeaways |
| `leagueBenchmark` | Graded picks + league-config standings | Season cards, grades |
| `contenderPlaybook` | Graded drafts, league-config standings, `espn-standings.json` | Strategy Podium, Tools → Draft Trends Podium, Insights → Draft Takeaways |
| `draftRoutes` | Site ranks, site ADP, ADP board, **depth roster**, **consensus SOS/units/ECR**, takeaways, player status, points, QB map, ranks meta | Strategy Routes / Values / Landmines, Compare, Home. Rebuilds when Strategy dropdowns change `leagueSize` / roster / superflex. `listRankedBoard` feeds Cheat Sheets; `listSearchBoard` feeds header search |
| `cheatSheet` | Same 2026 board as Routes (`toPlayer`); Standard overlay from live ESPN `draftRanksByRankType.STANDARD` (~10 min cache); `roster` from league-config | Tools → Cheat Sheets |
| `playerGameLog` | Skill/K: live ESPN athlete `gamelog?season=` (default current draft season; `?season=` for prior years) + fantasy player ids. **K** columns FG/FGA/XP/FPTS: ESPN returns compound keys (`fieldGoalsMade-fieldGoalAttempts` = `4-5`); `expandMadeAttemptPairs` splits them, and FPTS prefers `totalKickingPoints` then `3×FG+XP`. **D/ST:** ESPN fantasy `leaguedefaults/3?view=kona_player_info` weekly actuals (`statSourceId=0`, negative fantasy id `-(16000+proTeamId)`), columns TD/INT/FR/SCK/SFTY/BLK/PA/YA/FPTS (`appliedTotal`). Current draft season pads weeks 1–18 from `nfl-schedule` (upcoming opp + empty cells → UI —; bye rows marked). Prior years only fill bye gaps between played weeks. `sosSlate` from `listSosBoard` (positional Source B weeks + remaining-slate Source A rank + `currentWeek`); `oprkSlate` from committed `espn-oprk` (same as My Team lineup ESPN strip — preferred in the bio UI when present; includes `oprkByOpponent` so custom Week Apply re-ranks only the filtered weeks). Team for the slate is the board team, else `dstTeamFromName` / `rosterTeam`. Skill columns include targets (`tgt`) and `group` for Receiving/Rushing (QB: Passing/Rushing) pills | Solo player compare (Cheat Sheets, Routes, Home, My Team bio). Game log opens scrolled to **currentWeek+1** on the live season. **Week** defaults to 1–18 with the current week in green; **Remaining Schedule** toggles currentWeek–18 without changing **ROS #**; a custom Apply range shows **W# - W# SOS #** from the window re-rank |
| `leagueFormats.ts` | none | Strategy Teams + Roster presets (`8/10/12/14`, `2wr-1flex` default) |
| `strategy.ts` | `docs/sot/*.md` with `kind` ≠ `app`; `expert-takeaways.json` | Insights Learnings citations, Strategy Research tab. Non-default roster prepends format cards and drops 2-WR/1-FLEX lineup copy |
| `survivor.ts` | PoolGenius + game context | Strategy → NFL Survivor / Loser |
| `tdStreak.ts` / `tdMatchup.ts` | Board + YTD PPR + PoolGenius + `td-player.csv` + `td-defense-by-pos.csv` + `td-player-games.csv` + schedule kickoff/home + consensus OL + week vs-pos D ranks | Strategy → TD Streak matchup / TD% (small home/away vs-opp nudge) / path-card vs/at · date · this week’s home or away TD split / history stats / OL-mismatch (inverted D rank) / scored-TD rings / path survival |

API: `server/src/routes/analysis.ts` (`/sos`, `/cheatsheet`, `/strategy`, `/trends`, `/routes/*`).

## What is not SOS

Historical ADP, actual points, draft picks, site ranks, landmines, ESPN vs FP / Sleeper, espn-ranks-meta, espn-standings, top-team-analysis, league-config, and every page except Strategy → Routes (chips/blurbs/scoring), Compare SOS row, Tools → Cheat Sheets (SOS chips), and Tools → SOS (List / Offense / Defense).

## SOT docs in this folder

**Strategy research** (shown on Strategy → Research, cited by Insights → Learnings):

- `ppr-10-team-draft-strategy.md`
- `draft-slot-strategy.md`
- `positional-scarcity-and-runs.md`
- `historical-bust-rates-by-round.md`
- `in-season-vs-draft-value.md`

**App internals** (`kind: app` in frontmatter — loaded by humans/agents, skipped by `loadSotDocuments` so they do not appear on the Research tab):

- `strength-of-schedule.md`
- `draft-routes.md`
- `cheat-sheets.md`
- `expert-consensus.md`
- `weekly-refresh.md`
- `enrichment-and-surfaces.md` (this file)
- `survivor-leagues.md`

Keep these app docs in sync with the product: after a behavior, data, or UI change, update the matching file (or add a new `kind: app` doc). Cursor rule: `.cursor/rules/app-sot-docs.mdc`.

Refresh strategy research with `npm run research:sot -- --topic <key>`. Do not use that runner for app-internal docs.
