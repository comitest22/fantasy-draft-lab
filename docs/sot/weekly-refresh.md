---
title: Weekly enrichment refresh
source: BLITZ app internals
date: 2026-09-18
confidence: high
kind: app
tags: [app, enrichment, weekly, automation]
---

# Weekly enrichment refresh

A job refreshes committed files under `data/enrichment/` so SOS, survivor, TD streak, YTD PPR, and player status match games that have finished.

- **Tuesday** after Monday Night Football — the whole prior week is usually final (`completedWeeks` advances).
- **Friday** after Thursday Night Football — only TNF is typically final; `completedWeeks` stays put until the rest of the week is done. Current-week survivor/TD surfaces skip `IN_PROGRESS` / `FINAL` games.

## How it runs

- Local: `npm run enrichment:weekly` (`scripts/enrichment/weekly.ts`)
- GitHub: `.github/workflows/weekly-enrichment.yml` — cron `0 15 * * 2` (Tuesday 11:00 ET during DST) and `0 15 * * 5` (Friday 11:00 ET after TNF), plus **Run workflow**. Commits `data/enrichment/**` if anything changed. Render deploys from git (`DATA_DIR=/opt/render/project/src/data`).
- Secrets on the repo: `POOLGENIUS_USERNAME`, `POOLGENIUS_PASSWORD`, plus `ESPN_S2` / `ESPN_SWID` (and optional `ESPN_LEAGUE_ID`) for weekly OPRK + week scoring — same as local `.env`. Do not commit credentials.

Order inside the orchestrator:

1. `fetch-sos-schedule` — 2026 schedule with kickoff/status/scores, 2025 and 2026 through-week D/O **stats + ranks**, `season-state.json` (`completedWeeks`, `currentWeek`)
2. `fetch-espn-oprk` — league `kona_player_info` → `positionAgainstOpponent.positionalRatings` → `espn-oprk-2026.json` (needs ESPN cookies; league id from `data/my-team/2026.json` or `ESPN_LEAGUE_ID`). Soft-skipped with a warning if cookies are missing (previous snapshot kept).
3. `fetch-platform-player-ranks` — per-player Week + ROS **positional** PPR ranks → `platform-player-ranks-2026.json` (ESPN leaguedefaults / Sleeper projections ranked within pos; CBS weekly + ROS projection pages ranked within pos). Soft-skips per site.
4. `fetch-espn-week-scoring` — league `mRoster&scoringPeriodId={currentWeek}` → `espn-week-scoring-2026.json` (proj / week score / last / %Rost by `espnId`; needs cookies; team from `my-team`). Runtime My Team enrich merges this file with live `mRoster` and backfills Last from week `currentWeek-1` when needed. Soft-skipped if cookies missing.
5. `fetch-player-status` — ESPN fantasy `injuryStatus` + live NFL team roster injuries → `player-status-2026.csv` (survivor / cheat-sheet injury overlay; also runnable alone via `npm run enrichment:fetch-player-status` for a mid-week refresh)
6. `fetch-espn-ranks` — live PPR board merge into `adp.csv` + `player-status-2026.csv` (rewritten again) + `espn-depth-2026.csv` (fantasy owned extras **kept only if on that team's live ESPN roster**, including `espnId`) + `espn-ids-2026.csv` (athlete ids for game logs / depth bios). Appends any of the **32 D/ST** ESPN omitted from the published PPR list so ADP/search/compare stay complete.
7. `import-fantasy-points` — 2014 through current year; in-progress year uses nflverse **weekly** PPR summed to YTD, ESPN `appliedTotal` if nflverse is empty
8. `fetch-player-usage` — nflverse weekly `player_stats` + `snap_counts` + PBP dropbacks + ESPN YPRR → `player-usage-{season}.csv` (snap %, RTE%, air yards, YAC, aDOT, carry/target share for My Team Stats)
9. `fetch-oline-ranks` — nflverse PBP REG sack rate by posteam → `oline-ranks-{season}.csv` (1 = lowest sack rate; My Team bio Season O-line)
10. `build-td-matchups` — nflverse weekly rush+rec TDs/yards by player and TDs/yards allowed by defense vs QB/RB/WR/TE (`td-player.csv`, `td-defense-by-pos.csv`, plus up to 5 seasons of player-week rows in `td-player-games.csv` including rush/rec/targets/yards and **home**)
11. `fetch-poolgenius --week {currentWeek}` — logs out, then signs up for the free trial as the next numbered address (`name26@…` → `name27@…`, saved in `poolgenius-account.json`; password unchanged), then logs in as that new account. A retry within 18 hours logs into that same account. Skipped with a warning if login fails, the grid stays gated, or PoolGenius says the week is not ready until after 5PM Eastern (previous snapshot kept). **Aligns** season-grid opponents to `nfl-schedule-2026.csv` (PG columns often lag one week after finals), then merges: **finished weeks keep their last projected %** and get **W/L + score** from the schedule; later weeks keep the remapped PoolGenius %. Also saves that week’s Mkt/ML/Pop/EV board into each team’s `weekBoards[week]` so the Week tab keeps the full table after the slate moves on.
12. `fetch-game-context` — team/QB road records, QB weather splits, Open-Meteo forecast for the upcoming week’s outdoor games → `game-context-2026.json` (My Team Status weather glyphs)
13. `build-consensus` — ECR / units (remaining SOS is mixed at **runtime**, not in this file)

`npm run enrichment:refresh` still prints status plus the weekly commands.

## Live vs committed

| Surface | Source | Tuesday / Friday job? |
|---------|--------|----------------|
| Player game log | Live ESPN athlete `gamelog?season=` via ids from `espn-ids-{season}.csv` (weekly ranks sweep) + depth/YTD name resolve | Yes — ids/depth refresh Tue/Fri; log HTML still fetched live |
| Player news | Live Google News RSS | No |
| Compare depth chart | Ranked ADP board + `espn-depth` same-team/pos extras | Yes — depth roster from ranks sweep |
| Remaining SOS List / Offense / Defense | Committed schedule + D/O stats; blend at runtime | Yes |
| My Team ESPN OPRK | Committed `espn-oprk-{season}.json` (live league fetch when cookies present) | Yes — needs `ESPN_S2` / `ESPN_SWID` secrets |
| Bio platform player ranks (ROS / Week) | Committed `platform-player-ranks-{season}.json` | Yes — ESPN/Sleeper/CBS public |
| My Team Proj / Score / Last / %Rost | Committed `espn-week-scoring-{season}.json` (live `mRoster` when cookies present) | Yes — needs ESPN cookies; daily refresh is a later nice-to-have |
| My Team Status weather | `game-context-{season}.json` + `nfl-venues.json` | Yes — game-context step |
| Survivor / Loser | `poolgenius-survivor-2026.json` + `game-context-2026.json` + schedule | Yes |
| TD Streak | Board + YTD points + PoolGenius + played-game status + vs-position TD files | Yes |
| Compare 2026 YTD | `fantasy-points.csv` | Yes |
| Bio Season Offense (YTD PF) | Invert `offense-ranks-{season}.csv` (1 = most points scored) | Yes — schedule step |
| Bio Season O-line (sack %) | `oline-ranks-{season}.csv` from nflverse PBP sack rate | Yes — `fetch-oline-ranks` |
| Season **grades** for 2026 | Still process-score until `completedWeeks >= 18` | YTD rows do not flip EOS bust math |

## Still manual

`site-ranks-espn-ppr-2026.csv`, `site-adp-2026.csv`, `expert-takeaways.json`, Action Network `team-ranks-2026.csv`, DraftEdge/FPA raw CSVs (List SOS prior through week 3; gone once week 4 is complete).

See `docs/sot/enrichment-and-surfaces.md`, `docs/sot/strength-of-schedule.md`, `docs/sot/survivor-leagues.md`.
