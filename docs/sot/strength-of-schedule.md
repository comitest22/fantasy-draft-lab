---
title: Strength of Schedule
source: DSAFD app internals
date: 2026-09-15
confidence: high
kind: app
tags: [app, sos, enrichment, tools]
---

# Strength of Schedule

App-internal source of truth for SOS data, formulas, and UI. Strategy research lives in the other `docs/sot/*.md` files; this one is for how the product actually computes and shows schedule.

There are **two skill-player SOS layers** plus a separate **Defense (D/ST)** weekly tab. Skill List/Offense numbers are not the same. Both skill layers are nudged by 2026 vs 2025 offense and O-line change. Defense is not. Last year’s D/O is a short early-season prior only: by **four completed weeks** remaining Offense/Defense ranks and the List preseason board are **100% this year**. Roster, coordinator, and line turnover make a leftover 2025 weight into December the wrong team.

## The two sources

### Source A — remaining-schedule ratings

- Runtime file: `data/enrichment/consensus-sos-2026.csv` is the **preseason prior** (DraftEdge + FPA). Fallback: `data/enrichment/sos-2026.csv`.
- Remaining slate is also **computed** from remaining 2026 games × blended opponent D ranks, mapped to 1–5: `5 − (avgRank−1)*4/31`.
- Mix: `fade = max(0, 0.75 − 0.25 × (completedWeeks − 1))` on the prior (preseason → 100%, Week 1 → 75%, Week 2 → 50%, Week 3 → 25%, Week 4+ → 0). Then Off/OL `envBoost`. The prior is the **2026** DraftEdge+FPA board, not 2025 stats; it dies at week 4 because remaining opponent quality should be this year’s units.
- `season-state.json` supplies `completedWeeks`. List subtitle: remaining 2026 matchups with a fading DraftEdge + FPA prior.
- Scale after mix: **1–5**, higher = easier remaining opposing defenses. Position mapping: WR/RB/QB/TE use their column; K / D/ST fall back to `overall`.
- After the offense/O-line nudge, teams are ranked **1–32** per group (`ALL`, `QB`, `RB`, `WR`, `TE`). Highest adjusted score = **#1 easiest**.

### Source B — week-by-week matchup ranks (chart only)

Pulled from ESPN by `scripts/enrichment/fetch-sos-schedule.ts` (`npm run enrichment:fetch-sos-schedule`):

| Output | Source | Meaning |
|--------|--------|---------|
| `nfl-schedule-2026.csv` | ESPN scoreboard, weeks 1–18 | `team,week,opponent,home,kickoff,status,teamScore,oppScore` |
| `defense-stats-2025.csv` / `defense-stats-2026.csv` | ESPN PA, opp pass, opp rush | Raw stats for blending |
| `offense-stats-2025.csv` / `offense-stats-2026.csv` | ESPN `pointsFor` | Raw stats for D/ST blending |
| `season-state.json` | Derived from schedule status | `completedWeeks`, `currentWeek` |

Opponent strength for **remaining** weeks:

```
w = min(1, 0.25 + 0.25 × (completedWeeks − 1))   // Week 1 → 0.25, Week 2 → 0.50, Week 3 → 0.75, Week 4+ → 1
blendedStat = w * stat2026 + (1-w) * stat2025
then re-rank 1–32 (higher PA / opp yards = easier D; fewer points scored = easier D/ST)
```

Completed weeks on the Offense tab use 2026 through-week ranks when present. Each remaining Offense cell is that blended D rank, then Off/OL `adjustedMatchup`. From week 4 on, remaining cells are **only** 2026. Tools → SOS Offense / Defense intros say this. Off/OL deltas on the List round to one decimal. Offense puts **position pills** (Overall/QB/RB/WR/TE) above the chart. Offense and Defense share a **Filter** control to the right of the Easiest→Toughest legend: **ROS**, **Top ranked** (consensus offense on Offense; through-week points allowed on Defense, 1 = fewest), **A to Z**, or **Z to A**. Click a team name cell to select/deselect that row; **Show only selected teams (N)** (next to Filter; count appears when any are selected) hides unselected rows and stays disabled until at least one team is selected. **Clear Selected Teams** sits on the chart toolbar row (with position pills on Offense; right-aligned on both charts), disabled when nothing is selected. Across from the List/Offense/Defense tabs, **Showing Week _ to _ Apply** narrows which week columns appear on Offense and Defense (defaults 1–18; Apply clamps and swaps if from > to). Week cells keep a fixed matchup-box size when the range shrinks (table scrolls horizontally; same idea as player-bio SOS). **Remaining Schedule** sits on the legend row after Filter (before Show only selected teams); checking it sets the week fields to currentWeek–18, and unchecking restores the prior applied range. **ROS** on those charts is recomputed from the applied window: average the visible weekly matchup cells for the active position (skip byes), then re-rank teams 1–32 (1 = easiest). It is not the List Source A remaining-slate rank. Click a week number on Offense or Defense to sort rows by that week’s matchup, **easiest first** (lowest cell on top, byes last). Click the same week again to reverse (toughest on top). A third click clears the week sort and restores Filter order (ROS or Top ranked). Choosing **Filter** also clears the week sort. If Apply hides the sorted week, the sort clears too.

### Defense tab (fantasy D/ST)

Inverse of skill SOS: easy remaining **offenses** to play against.

- List: **D/ST column** is the average of remaining opponent blended offense ranks, re-ranked 1–32. Consensus **D-line rank** (1 = best) sits under the team name on List; it does not change D/ST scoring.
- Defense tab: weekly grid with legend **Filter** (ROS / Top ranked through-week defense by points allowed / A to Z / Z to A) and team-row selection. Cells are blended opponent points-scored rank, raw, **no** Off/OL nudge. Remaining-slate D/ST ranks also live on List.
- Kickers/skill still use Source A overall on Routes; this tab is Tools only.

## Third layer — offense and O-line change (applied to both A and B)

Files: consensus 2026 units (`data/enrichment/consensus-units-2026.csv`, overlaid onto 2026) vs `data/enrichment/team-ranks-2025.csv`

- Columns used: `offenseRank` / `olineRank` (1 = best unit). 2026 values are the consensus average (Action Network + PFF OL + Sharp OL + public offense). 2025 stays Action Network.
- Delta: `priorRank − latestRank`. **Positive means the unit got better** (rank moved toward 1).
- Tools → SOS → List shows consensus **D-line rank** (1 = best) under the team name. It does not change D/ST scoring.

Loaded in `server/src/data/enrichment.ts` (`buildUnitAdj`). Seasons are the two newest `team-ranks-YYYY.csv` years, currently 2026 vs 2025, with 2026 Off/OL replaced by consensus when present.

## Formulas

All of this lives in `server/src/data/enrichment.ts`.

### Source A nudge (`envBoost` → `adjustedSosScore`)

```
avgΔ     = mean of present (offenseΔ, olineΔ)
envBoost = clamp(avgΔ / 20, −0.9, +0.9)
adjusted = round((rawScore + envBoost) * 10) / 10
```

About **20 rank spots of average Off+OL improvement = +1.0 SOS point**, capped so the schedule still leads. Ranks 1–32 are built from these **adjusted** scores, not the raw CSV.

Path scoring uses the adjusted 1–5 score, not the 1–32 rank: `(sos − 3) * 11` in `server/src/analysis/draftRoutes.ts` (consensus SOS).

### Source B nudge (`adjustedMatchup`)

```
avgΔ  = mean of present (offenseΔ, olineΔ) for the *attacking* team
shift = clamp(round(−avgΔ / 4), −6, +6)
cell  = clamp(opponentDefRank + shift, 1, 32)
```

About **4 spots of unit improvement = 1 easier displayed matchup**, max ±6. Improved Off/OL → negative shift → easier (lower) cell.

### Worked example: Indianapolis

| Input | Value |
|-------|--------|
| SOS CSV overall | 3.8 (QB/RB/WR 4, TE 3) |
| 2025 ranks | offense 26, O-line 16 |
| 2026 ranks | offense 18, O-line 3 |
| unitChange | Off **+8**, OL **+13** |
| avgΔ | 10.5 |
| envBoost | 10.5 / 20 = **0.525** |
| adjusted overall | 3.8 + 0.525 → **4.3** |
| matchup shift | round(−10.5 / 4) = **−3** |

Minnesota’s raw overall is 4.5, but Off −5 / OL −10 (units declined) pulls it to **4.1**. Indianapolis therefore ranks **#1 overall** on the List even though Minnesota’s raw slate is easier. IND vs BAL on the Offense tab is **12** instead of Baltimore’s raw 15.

## Where each surface gets it

| Where you see it | What it shows | Source |
|------------------|---------------|--------|
| Strategy → Routes chips (`SOS #6 easiest`) | Player’s team, position SOS rank 1–32 | A (ranked, after Off/OL) |
| Tools → Cheat Sheets chips | Same chip helper as Routes (`valueChips`, up to 3) | A (ranked, after Off/OL) |
| Strategy → Routes blurbs (“friendly slate”, “easier RB slates”, “soft schedule”) | Same file’s adjusted 1–5 score (`≥ 4` easy, `≤ 2` tough) | A |
| Who the path actually picks | Scoring bump `(sos − 3) * 11` | A (not shown as a number) |
| Player stats / Compare SOS row (`#6`) | Same 1–32 rank as the chips (Routes, Home, Cheat Sheets modal) | A |
| Tools → Strength of Schedule → List | Team ranks #1–#32 overall, by position, and D/ST; D-line under the name; hover shows the 1–5 score | A (remaining 2026 mix + fading DraftEdge/FPA, after Off/OL) + D/ST remaining offense ranks + `consensus-units` dline |
| Tools → Strength of Schedule → Offense | Opponent + 1–32 color per week; position pills above chart; Filter ROS (window avg re-rank) / Top ranked / A to Z / Z to A; week range Apply + Remaining Schedule; fixed-size week cells; **Current Week** header like Survivor; click a week number to sort that column easiest-first, again to reverse, a third time to restore; click team to select; Show only selected teams (N); Clear Selected Teams | B weekly cells; ROS = avg of applied weeks then 1–32; Top ranked = consensus offense |
| Player bio Game Log (Home / Routes / Cheat Sheets) | That player’s team, **position** week-by-week Source B cells above the log (same heat as Tools → SOS Offense). Team is site-ranks, else site ADP, else consensus ECR. If those lists have no team (deep ESPN ranks such as Kirk Cousins), `rosterTeam` uses this season’s `fantasy-points.csv` team, then ESPN depth, then `td-player.csv`. **FA** is skipped. **Week _ to _ Apply** sits on the same line as the ROS label and defaults to **1–18** (full season strip; Apply clamps and swaps). **Remaining Schedule** (checkbox next to Apply) narrows to currentWeek–18 and fills those week fields (unchecking restores the prior applied range); **ROS #** stays the remaining-slate Source A rank. The **current week** number is green. Unfiltered muted text is **ROS #N (Favorable / Slightly favorable / Average / Tough)** from remaining-slate Source A rank — weeks after `completedWeeks` through end of season, not a full-season 1–18 average (same bands as TD matchup: 1–8 / 9–16 / 17–24 / 25–32). After Apply to a custom range (not full season and not remaining), the label switches to **W# - W# SOS #N (Favorable/…)** (no leading zero on single-digit weeks) and the # + tagline are recomputed like Tools → SOS Offense: average the visible weekly Source B cells across all teams for that position, then re-rank 1–32 | B (weeks + filtered window rank) + A (unfiltered ROS #) |
| Tools → Strength of Schedule → Defense | Weekly opponent scoring rank; Filter ROS (window avg re-rank) / Top ranked (through-week PA, 1 = fewest) / A to Z / Z to A; week range Apply + Remaining Schedule; fixed-size week cells; **Current Week** header like Survivor; click a week number to sort that column easiest-first, again to reverse, a third time to restore; team select + Show only selected teams (N); Clear Selected Teams; D/ST ranks also on List | Remaining blended offense ranks (no Off/OL); chart ROS from applied weeks; Top ranked from current-season `defense-ranks` (inverted: fewest PA first) |

**Values, Landmines, Podium, Learnings, Era, Research, Home columns, Seasons, Trends, and Import do not show SOS numbers.** Tools → Cheat Sheets does (same chips as Routes).

On the SOS page, each team shows `Off +8 · OL +13` under the name. Hover a rank or matchup for the score and the year-over-year note (`2026 vs 2025: offense +8, O-line +13 (positive = improved)`).

Chip thresholds on Routes and Cheat Sheets: rank `≤ 8` → `SOS #N easiest` (green); `≥ 25` → `SOS #N toughest` (neutral slate, not red); else `SOS #N` (slate). If rank is missing, the 1–5 score is shown instead (`≥ 4` easy/green, otherwise slate). Shared helper: `client/src/utils/valueChips.ts`.

On Tools → SOS, List chips and Offense/Defense weekly cells use a **green → white** scale (`rankHeat` in `client/src/utils/heatScale.ts`): rank 1 is a bright accent-family green (`rgb(29, 175, 90)`, near `--accent`); rank 32 is palette white (`rgb(226, 232, 240)`, `--text`). The mix **eases toward white** (`√t`) so mid ranks are not stuck in mint — rank ~8 is already a lighter green, ~16 is pale, ~24 is near-white. Text flips to navy (`--surface-2`) once the cell is light enough to read. BYE cells stay off-scale: purple (`#6d4cae`) with white text. The legend bar uses the same eased stops.

## Code and API

- Loader / formulas: `server/src/data/enrichment.ts` (`getSos`, `getSosRank`, `listSosBoard`, `adjustedSosScore`, `adjustedMatchup`, `buildUnitAdj`, `buildSosRanks`, `buildDstRanks`)
- Player attach: `server/src/analysis/draftRoutes.ts` (`toPlayer`, `valueScore`, `expertTake`, `altTake`); bio slate `server/src/analysis/playerGameLog.ts` (`buildPlayerSosSlate`)
- API: `GET /api/analysis/sos` → `getSosBoard()` in `client/src/services/api.ts`; Cheat Sheets SOS chips ride `GET /api/analysis/cheatsheet`; bio SOS rides `GET /routes/gamelog`
- UI: `client/src/pages/SosPage.tsx`, `client/src/pages/ToolsPage.tsx`, `client/src/pages/CheatSheetsPage.tsx`, `client/src/components/DraftRoutesView.tsx`, `client/src/components/PlayerCompareDialog.tsx`, `client/src/components/PlayerGameLog.tsx`

## Scale cheat sheet

| Number | Meaning |
|--------|---------|
| Source A score ~1–5 | Higher = easier remaining slate |
| Source A / player `sosRank` 1–32 | 1 easiest, 32 toughest |
| Source B cell 1–32 | 1 easiest weekly matchup, 32 toughest |
| Defense / D/ST cell 1–32 | 1 easiest opposing offense (fewest 2025 points), 32 toughest |
| Off / OL Δ | Positive = improved YoY |
| envBoost | ±0.9 max on Source A score |
| matchup shift | ±6 max on Source B rank |
