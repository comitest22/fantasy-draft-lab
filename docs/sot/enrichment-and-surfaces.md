---
title: Enrichment and App Surfaces
source: DSAFD app internals
date: 2026-09-14
confidence: high
kind: app
tags: [app, enrichment, navigation, data]
---

# Enrichment and App Surfaces

App-internal catalog of data files, scripts, analysis consumers, and where they show up in the UI. SOS details live in `docs/sot/strength-of-schedule.md`. Routes details live in `docs/sot/draft-routes.md`. Cheat Sheets details live in `docs/sot/cheat-sheets.md`. Consensus ECR / units / takeaways live in `docs/sot/expert-consensus.md`. Tuesday/Friday automation lives in `docs/sot/weekly-refresh.md`.

## App map

Nav: **Home · Seasons · Tools · Import · Trends · Strategy** (`client/src/components/Layout.tsx`).

| Route | Page | What it shows |
|-------|------|----------------|
| `/` | HomePage | Header search (between logo and nav) on the **search board** (`GET /routes/search-board`: ESPN PPR top-500 ranks + `espn-depth-2026.csv` roster extras + any missing YTD scorers). Draft Routes / Cheat Sheets still use the ranked ADP board only. The page body is two columns: **Learnings** (same cards as the old Strategy → Learnings tab, default 10-team 2 WR / 1 FLEX) and **Takeaways** (podium timing advice that used to sit under First-starter timing). Selecting a name opens a two-column page: **left** is the compare card (`GET /routes/compare`, including ECR / ESPN−ECR / sleeper gap, matching expert takeaways, 2026 YTD PPR, last-year PPR, and same-team positional depth under the stats) with **positional SOS** and the current-season **Game Log** stacked under those stats (`GET /routes/gamelog?name=&season=`, year dropdown, SOS week row above the log for the current season through four years back); **right** is **Latest news** (`GET /routes/news`, Google News RSS for that name). Query `?player=` takes over the page; Back clears it. The news list (`server/src/analysis/playerNews.ts`) shows up to 8 Google News RSS headlines (title, source, date; 10-minute cache). Google wrapper URLs are unwrapped via the `/rss/articles/` landing page + `garturlreq` batchexecute using the RSS cookie session (a bare `/articles/` fetch with a simple UA gets a captcha and used to empty the list). After unwrap, known subscription hosts (`nytimes.com` / The Athletic, WSJ, WaPo, etc.) are flagged `paywalled: true` and listed with **Opens on publisher** — a normal click opens the publisher in a new tab instead of the in-app reader. Readable publishers still open in-app (`?player=&article=`) with a deduped excerpt; paywalled / blocked / teaser deep-links show a subscription note plus a primary **Open original** button (no red “Paywalled publisher.” dead-end). The player card stays on the left. **← Back to news results** restores the list. Ctrl/Cmd-click opens the publisher URL. The player page is a two-column grid (bio + SOS/log | news); under 64rem it stacks. |
| `/seasons` | SeasonsPage | Season cards: grade, finish, hit/reach rates (2014–2026). 2026 has no finish yet. |
| `/season/:season` | SeasonDetailPage | Graded board, PodiumCompare vs that year’s podium. **In-progress seasons** (no `fantasy-points.csv` rows yet, currently 2026): pick badges are steal/reach vs ESPN PPR rank, draft grade is ADP-delta process score (50 + avg capped `ADP − overall`), and Era averages skip that year. Pick cards show `ESPN #n · ±k vs ADP`. |
| `/tools` | ToolsPage | Two cards: Strength of Schedule, Cheat Sheets |
| `/tools/sos` | SosPage | List (consensus remaining-slate), Offense (Source B weekly grid + Filter ROS/Top ranked/A–Z/Z–A), Defense (D/ST weekly grid + Filter ROS/Top ranked through-week PA/A–Z/Z–A) |
| `/tools/cheatsheet` | CheatSheetsPage | Live-draft checklist: PPR or ESPN Standard rank, position filter, pick-slot snake context, thin bars at every remaining snake pick, crumb `Tools > Cheat Sheet` (scrolls away), sticky My team (positional rank pill in pos color + full name) + Watch list (right-click names) + filters, `^`/`v` to collapse those two cards, ✓/× (amber, checkbox checked+disabled), Steal/Reach chips vs ECR with live paren that only improves after they fall past their ESPN rank, check-off + right-click highlight (`localStorage`; highlight drops when checked or on My team; **Clear watchlist** on the card and toolbar). Name click opens the Home/Routes compare card in a centered modal with same-team positional depth under the stats and the current-season Game Log (year dropdown) expanded with a positional SOS week row above it (no news). |
| `/import` | ImportPage | ESPN `.docx` draft import + league-config mapping. 2026 board is `data/drafts/2026.json` (**Drake 'n Bake**, slot 8). |
| `/trends` | TrendsPage | Podium · Takeaways · Era · Grades · Rates |
| `/strategy` | StrategyHubPage | Four cards: Draft, NFL Survivor, NFL Survivor Loser, TD Streak |
| `/strategy/draft` | StrategyPage | Dropdowns above the pills set **teams** (8/10/12/14) and **roster** (2 WR / 1 FLEX default, plus 2FLEX, 3WR, Superflex combos). Those drive Routes, Values, Landmines, and Learnings via `GET /strategy?teams=&format=`. **Podium** and **Era** stay on this league’s real history. Learnings tab is two columns: Learnings + podium Takeaways. Routes · Values · Landmines · Podium · Learnings · Era · Research |
| `/strategy/survivor` | SurvivorPage | Winner survivor Week + Season + Picks (week squares with 8px cell gap; square-styled pick dropdown that opens **to the right** of the cell; heat fill and 3px white focus ring; Current Week label + green week number on the live NFL week; played W/L pale fill with thicker green/red border; lock/unlock are circle buttons with the same fill; hover and press use a thicker green circle; leftover weeks show an open padlock; leftover weeks drafted round-robin; one **Best Path Available** button above the intro refills leftover weeks across tickets and skips games that already have a W/L; score is chance of survival) from PoolGenius plus a small rest/travel/weather overlay |
| `/strategy/survivor-loser` | SurvivorPage | Same three tabs, inverted for loser-pool dogs, same overlay (sign flipped) |
| `/strategy/td-streak` | TdStreakPage | Anytime-TD path: unique starters (hardest weeks first for survival product), week 1 two starters + backup; later weeks one starter + backup. Sitting as backup does not use a player; Tuesday burns whoever actually played on the starter card. Swap lists every weekly-legal RB/WR/TE/QB (position, then % to score descending) plus this week’s backup when swapping a starter; rectangle Lock/Refresh/Swap icons sit under each path card; Lock pins it and disables Refresh/Swap. Season-path chips: remaining-season survival plus next-5-weeks survival; **Best Path Available** above those chips refills unlocked leftover weeks around locked and finished starters. Plain-English matchup reason, % to score, path-card lines under the name with vs/at · date · weather or closed-dome icon, then this week’s home/away TD split vs that opponent, green/red ring after the week is final. |

Section pills (`PageTabs` on Draft Strategy, Trends, SOS, Survivor) scroll with the page. They are not sticky. As the bar passes under the translucent `.header`, pill opacity fades to 0 so they do not show through; scrolling back restores them. Switching a tab still `scrollTo({ top: 0 })`.

## Enrichment files (`data/enrichment/`)

Runtime loading is `server/src/data/enrichment.ts`. Team codes are canonicalized (`LAR/STL→LA`, `JAC→JAX`, `WSH→WAS`, and similar). Store reloads when `adp.csv` mtime changes.

| File | Source | Runtime? | Used for |
|------|--------|----------|----------|
| `adp.csv` | ESPN PPR ranks + Mike Clay expected points | Yes | Grades, route board, Cheat Sheets PPR order |
| `fantasy-points.csv` | nflverse actual PPR (weekly YTD for the in-progress year) | Yes | Grades (completed seasons only), compare last-year **and 2026 YTD** points |
| `draft-picks.csv` | nflverse | Yes | Rookie flags on grades |
| `espn-ppr-overall/{year}.csv` | ESPN PDF / live API | Indirect (feeds `adp.csv`) | Historical + 2026 board (top **500** PPR draft ranks) |
| `espn-depth-2026.csv` | ESPN percent-owned sweep past the ranked board, `fetch-espn-ranks.ts` (includes `espnId`) | Yes | Header search + player bio + team positional depth extras for rostered names past the top-500 draft board |
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
| `offense-ranks-2025.csv` / `offense-ranks-2026.csv` | ESPN points scored | Fallback | Rank files if stats are missing |
| `defense-stats-2025.csv` / `defense-stats-2026.csv` | ESPN PA / opp pass / opp rush | Yes | Blended opponent strength |
| `offense-stats-2025.csv` / `offense-stats-2026.csv` | ESPN points scored | Yes | Blended D/ST opponent strength |
| `season-state.json` | `fetch-sos-schedule.ts` | Yes | `{ season, completedWeeks, currentWeek, asOf }` |
| `nfl-venues.json` | Static stadiums | Yes | Lat/lon, tz, roof, division |
| `game-context-2026.json` | `fetch-game-context.ts` | Yes | Road records, QB weather flag, Open-Meteo forecasts |
| `player-status-2026.csv` | ESPN `injuryStatus`, `fetch-espn-ranks.ts` | Yes | Routes and Cheat Sheets SUS / IR / Exempt badges |
| `team-ranks-2025.csv` / `team-ranks-2026.csv` | Action Network, static | Yes | 2025 prior for Off/OL YoY; 2026 overlaid by consensus units |
| `espn-ranks-meta.json` | `fetch-espn-ranks.ts` | Yes (note only) | Routes subtitle “ranks pulled {date}”; includes ranked + depth counts |
| `espn-standings.json` | ESPN league snapshot | Playbook franchise IDs; not EnrichmentStore | Podium continuity |
| `poolgenius-survivor-2026.json` | PoolGenius Data Grid scrape | Yes | Strategy → NFL Survivor / Loser + TD Streak win%; current week in the JSON |
| `td-player.csv` | nflverse weekly rush+rec TDs, `build-td-matchups.ts` | Yes | TD Streak hit rate, positional TD share, green/red scored-TD rings |
| `td-defense-by-pos.csv` | nflverse weekly yards/TDs allowed by position | Yes | TD Streak vs-position matchup, last-game allowed, league ranks |
| `td-player-games.csv` | nflverse player-week rush+rec TDs plus rush att/yds, rec, rec yds, targets, and **home** (1/0 from `game_id` or nflverse schedules); last 5 seasons | Yes | TD Streak card totals, last 5 games, vs-opponent hit % / box-score line, **home/away TD split vs this opponent**; window labels use tenure (**N years**, **5 years**, or **5+**) |

`data/league-config.json` (not under enrichment/) is the runtime league: size 10, PPR, snake, roster, era cutovers, `upcomingDraftSlot`, per-season user team / finish / `teamStandings`.

## Scripts (`scripts/enrichment/`)

| Script | npm | Writes |
|--------|-----|--------|
| `refresh.ts` | `enrichment:refresh` | Status / instructions (points at weekly) |
| `weekly.ts` | `enrichment:weekly` | Tuesday (after MNF) and Friday (after TNF) orchestrator (schedule, ranks, YTD points, PoolGenius, context, consensus) |
| `fetch-espn-ranks.ts` | `enrichment:fetch-espn-ranks` | `espn-ppr-overall/{season}.csv` (top 500 PPR ranks → also merges `adp.csv`), `espn-depth-{season}.csv` (rostered extras + `espnId`), `espn-ids-{season}.csv` (athlete ids for game logs), `espn-ranks-meta.json`, `player-status-{season}.csv` |
| `fetch-poolgenius.ts` | `enrichment:fetch-poolgenius` | `poolgenius-survivor-2026.json` plus `poolgenius-account.json` (logout, free-trial signup as the next numbered email, then login; a retry within 18 hours reuses that account; unpublished week after 5PM Eastern keeps the previous snapshot; week from `--week` or `season-state.json`; finished weeks locked with last % + W/L + score) |
| `build-consensus.ts` | `enrichment:build-consensus` | `consensus-ranks-2026.csv`, `consensus-sos-2026.csv`, `consensus-units-2026.csv`, `consensus-meta.json` |
| `fetch-sos-schedule.ts` | `enrichment:fetch-sos-schedule` | `nfl-schedule-2026.csv`, D/O stats+ranks for 2025 and 2026, `season-state.json` |
| `fetch-game-context.ts` | `enrichment:fetch-game-context` | `game-context-2026.json` |
| `analyze-top-teams.ts` | none | `league-config.json` standings, `top-team-analysis.json` |
| `import-rankings.ts` | `enrichment:import-rankings` | `adp.csv` |
| `apply-clay-projections.ts` | `enrichment:apply-projections` | `adp.csv` + overall CSVs |
| `import-fantasy-points.ts` | `enrichment:import-fantasy-points` | `fantasy-points.csv` |
| `build-td-matchups.ts` | `enrichment:build-td-matchups` | `td-player.csv`, `td-defense-by-pos.csv` (prior + current year), `td-player-games.csv` (up to 5 seasons of player-week TDs + rush/rec/targets/yards + home from `game_id` / schedules) |
| `import-draft-picks.ts` | `enrichment:import-draft-picks` | `draft-picks.csv` |

There is **no fetch script** for `sos-2026.csv` or `team-ranks-*.csv`. Rebuild consensus after dropping new raw CSVs: `npm run enrichment:build-consensus`.

## Analysis modules → data

| Module | Enrichment | UI |
|--------|------------|----|
| `valueOverADP` | ADP, fantasy points, draft picks | Seasons, season detail, Trends grades. If a season is **in progress** (`completedWeeks < 18`), skip EOS bust math even when YTD PPR rows exist; steal/reach vs ESPN rank only; Era averages omit that year. |
| `eraCompare` | Via graded seasons | Strategy / Trends Era |
| `positionalTiming` | Graded picks | Timing advice / takeaways |
| `leagueBenchmark` | Graded picks + league-config standings | Season cards, grades |
| `contenderPlaybook` | Graded drafts, league-config standings, `espn-standings.json` | Strategy Podium, Trends Podium/Takeaways, Home Takeaways column |
| `draftRoutes` | Site ranks, site ADP, ADP board, **depth roster**, **consensus SOS/units/ECR**, takeaways, player status, points, QB map, ranks meta | Strategy Routes / Values / Landmines, Compare, Home. Rebuilds when Strategy dropdowns change `leagueSize` / roster / superflex. `listRankedBoard` feeds Cheat Sheets; `listSearchBoard` feeds header search |
| `cheatSheet` | Same 2026 board as Routes (`toPlayer`); Standard overlay from live ESPN `draftRanksByRankType.STANDARD` (~10 min cache); `roster` from league-config | Tools → Cheat Sheets |
| `playerGameLog` | Live ESPN athlete `gamelog?season=` (default current draft season; `?season=` for prior years) + fantasy player ids + `sosSlate` from `listSosBoard` (positional Source B weeks + remaining-slate Source A rank + `currentWeek`). Team for the slate is the board team, else `rosterTeam` (this season’s fantasy-points, ESPN depth, `td-player.csv`). Skill columns include targets (`tgt`) and `group` for Receiving/Rushing (QB: Passing/Rushing) pills | Solo player compare (Cheat Sheets, Routes, Home). **Week** defaults to 1–18 with the current week in green; **Remaining Schedule** toggles currentWeek–18 without changing **ROS #**; a custom Apply range shows **W# - W# SOS #** from the window re-rank |
| `leagueFormats.ts` | none | Strategy Teams + Roster presets (`8/10/12/14`, `2wr-1flex` default) |
| `strategy.ts` | `docs/sot/*.md` with `kind` ≠ `app`; `expert-takeaways.json` | Home / Strategy Learnings citations, Research tab. Non-default roster prepends format cards and drops 2-WR/1-FLEX lineup copy |
| `survivor.ts` | PoolGenius + game context | Strategy → NFL Survivor / Loser |
| `tdStreak.ts` / `tdMatchup.ts` | Board + YTD PPR + PoolGenius + `td-player.csv` + `td-defense-by-pos.csv` + `td-player-games.csv` + schedule kickoff/home + consensus OL + week vs-pos D ranks | Strategy → TD Streak matchup / TD% (small home/away vs-opp nudge) / path-card vs/at · date · this week’s home or away TD split / history stats / OL-mismatch (inverted D rank) / scored-TD rings / path survival |

API: `server/src/routes/analysis.ts` (`/sos`, `/cheatsheet`, `/strategy`, `/trends`, `/routes/*`).

## What is not SOS

Historical ADP, actual points, draft picks, site ranks, landmines, ESPN vs FP / Sleeper, espn-ranks-meta, espn-standings, top-team-analysis, league-config, and every page except Strategy → Routes (chips/blurbs/scoring), Compare SOS row, Tools → Cheat Sheets (SOS chips), and Tools → SOS (List / Offense / Defense).

## SOT docs in this folder

**Strategy research** (shown on Strategy → Research, cited by Home / Learnings):

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
