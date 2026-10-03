---
title: Weekly enrichment refresh
source: DSAFD app internals
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
- Secrets on the repo: `POOLGENIUS_USERNAME`, `POOLGENIUS_PASSWORD` (same as local `.env`). Do not commit credentials.

Order inside the orchestrator:

1. `fetch-sos-schedule` — 2026 schedule with kickoff/status/scores, 2025 and 2026 through-week D/O **stats + ranks**, `season-state.json` (`completedWeeks`, `currentWeek`)
2. `fetch-espn-ranks` — live PPR board merge into `adp.csv` + `player-status-2026.csv` + `espn-depth-2026.csv` (roster extras past the top-500 board, including `espnId`) + `espn-ids-2026.csv` (athlete ids for game logs / depth bios)
3. `import-fantasy-points` — 2014 through current year; in-progress year uses nflverse **weekly** PPR summed to YTD, ESPN `appliedTotal` if nflverse is empty
4. `build-td-matchups` — nflverse weekly rush+rec TDs/yards by player and TDs/yards allowed by defense vs QB/RB/WR/TE (`td-player.csv`, `td-defense-by-pos.csv`, plus up to 5 seasons of player-week rows in `td-player-games.csv` including rush/rec/targets/yards and **home**)
5. `fetch-poolgenius --week {currentWeek}` — logs out, then signs up for the free trial as the next numbered address (`name26@…` → `name27@…`, saved in `poolgenius-account.json`; password unchanged), then logs in as that new account. A retry within 18 hours logs into that same account. Skipped with a warning if login fails, the grid stays gated, or PoolGenius says the week is not ready until after 5PM Eastern (previous snapshot kept). **Aligns** season-grid opponents to `nfl-schedule-2026.csv` (PG columns often lag one week after finals), then merges: **finished weeks keep their last projected %** and get **W/L + score** from the schedule; later weeks keep the remapped PoolGenius %. Also saves that week’s Mkt/ML/Pop/EV board into each team’s `weekBoards[week]` so the Week tab keeps the full table after the slate moves on.
6. `fetch-game-context` — team/QB road records, QB weather splits, Open-Meteo forecast for the upcoming week’s outdoor games → `game-context-2026.json`
7. `build-consensus` — ECR / units (remaining SOS is mixed at **runtime**, not in this file)

`npm run enrichment:refresh` still prints status plus the weekly commands.

## Live vs committed

| Surface | Source | Tuesday / Friday job? |
|---------|--------|----------------|
| Player game log | Live ESPN athlete `gamelog?season=` via ids from `espn-ids-{season}.csv` (weekly ranks sweep) + depth/YTD name resolve | Yes — ids/depth refresh Tue/Fri; log HTML still fetched live |
| Player news | Live Google News RSS | No |
| Compare depth chart | Ranked ADP board + `espn-depth` same-team/pos extras | Yes — depth roster from ranks sweep |
| Remaining SOS List / Offense / Defense | Committed schedule + D/O stats; blend at runtime | Yes |
| Survivor / Loser | `poolgenius-survivor-2026.json` + `game-context-2026.json` + schedule | Yes |
| TD Streak | Board + YTD points + PoolGenius + played-game status + vs-position TD files | Yes |
| Compare 2026 YTD | `fantasy-points.csv` | Yes |
| Season **grades** for 2026 | Still process-score until `completedWeeks >= 18` | YTD rows do not flip EOS bust math |

## Still manual

`site-ranks-espn-ppr-2026.csv`, `site-adp-2026.csv`, `expert-takeaways.json`, Action Network `team-ranks-2026.csv`, DraftEdge/FPA raw CSVs (List SOS prior through week 3; gone once week 4 is complete).

See `docs/sot/enrichment-and-surfaces.md`, `docs/sot/strength-of-schedule.md`, `docs/sot/survivor-leagues.md`.
