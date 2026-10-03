---
title: Cheat Sheets
source: DSAFD app internals
date: 2026-09-08
confidence: high
kind: app
tags: [app, tools, draft, rankings]
---

# Cheat Sheets

App-internal source of truth for Tools → Cheat Sheets (`/tools/cheatsheet`). Live-draft checklist ranked by ESPN PPR or ESPN Standard. It does not write picks back to imported drafts, and it has no teams/roster format dropdowns (that is Routes).

## UI

Sticky stack (`.cheat-sticky`, under the main nav): **My team** + **Watch list** plus the filter bar. They stay pinned together while the board scrolls, with a little padding under the nav so My team is not flush with the header. The `Tools > Cheat Sheet` crumb is not sticky and scrolls off with the page. Cheat Sheets uses tighter page padding and panel gap so the crumb is not sitting in extra margin above/below.

Sticky filter bar (`.cheat-toolbar`, league-format field styles):

1. **Scoring** — `PPR` (default, this league) | `Standard`.
2. **Pick** — seats `1 … leagueSize` from `data/league-config.json` (10). Default `upcomingDraftSlot` (**8**). The pick does **not** hide players; it is seat context for tonight’s snake pick lines.
3. **Players** — `All` | `QB` | `RB` | `WR` | `TE` | `K` | `D/ST`. All is overall rank order; a position shows that group only.

Clear checks / **Clear watchlist** sit in the bar, plus a `^` / `v` toggle that collapses My team + Watch list under the nav so the board has more room (`v` expands them again). The choice is stored in `localStorage` with the other cheat-sheet flags. Clear watchlist is the same action as the Watch list card button: empties highlights on the board and the Watch list, then both buttons disable until someone is right-clicked again. “N left” counts names not yet off the board in the current position filter (left checkbox **or** on-my-team).

**Pick lines:** a thin sky `--info` bar at **every remaining** snake overall for the Pick dropdown, not only the next one. Drafted count is off-board names (`picked ∪ mine`); next overall is `drafted + 1`. Each line sits before the remaining player at that overall (index `untilYou`). Compact label: `R# · N to go · #overall`, or green `On the clock · #overall` when `untilYou` is 0. After a snake pick is used, that line drops. Position filter still uses overall remaining order, then shows the bar before the next visible remaining name at or after that slot (or at the bottom if none).

**My team:** under `Tools > Cheat Sheet` (crumb; no page title or snake-path subtitle). The crumb scrolls away; My team stays sticky with Watch list and the Scoring / Pick / Players bar while the list scrolls. Columns for this league’s roster from `data/league-config.json`: QB, RB, WR, TE, FLEX, D/ST, K, BN (5 bench). Each filled slot shows an ESPN **positional** rank pill (`posRank`, colored with that player’s `.pos-*` pill colors) plus **full name** (ellipsis if the column is tight). Empty slots are `—`. Extra RB/WR/TE after starters go to FLEX, then bench; names past a column’s need are red. `GET /cheatsheet` includes `roster`. `Clear my team` empties this set and unchecks those names.

**Watch list:** narrower card beside My team (same sticky stack). Names you **right-click** on the board. Sorted in board rank order. Click a name to open compare; × or **Clear watchlist** (card or toolbar — same control) removes them and clears row highlights. Body height matches My team; extra names scroll inside the card. Checking a player off or adding them to My team drops the sky highlight and removes them from this list.

`✓` on the right of each row is **picked for your team**: amber `--mine` (`#fbbf24`) highlight, full opacity, **no strikethrough**. The left checkbox is checked and **disabled**; only `×` (or Clear my team) can undo it, which also unchecks the box. Amber is distinct from sky right-click (`--info`) and green left-check / on-the-clock (`--accent`). Mine still counts as off the board for pick lines and “N left.”

## Ranking data

`GET /api/analysis/cheatsheet?scoring=ppr|standard` → `buildCheatSheet` in `server/src/analysis/cheatSheet.ts`.

Both modes start from the same 2026 enrichment board (`listRankedBoard` / `toPlayer` in `draftRoutes.ts`): name, pos, team, bye, status, SOS, ECR, Clay proj, landmine/sleeper gaps.

- **PPR:** sort is the existing ESPN PPR overall rank (`adp.csv`). Source label: `ESPN PPR overall`.
- **Standard:** live overlay of ESPN `draftRanksByRankType.STANDARD` from the same public players API as `scripts/enrichment/fetch-espn-ranks.ts` (`sortDraftRanks.value: STANDARD`). Cached ~10 minutes in process. Matched onto our rows by `normalizeName`. Sort by that Standard rank; pos ranks and `espnMinusEcr` (Standard rank − ECR) are recomputed after the sort. Source label: `ESPN Standard overall`.
- If the Standard fetch is thin (<50 ranks), name-match is thin, or the request fails: keep PPR order and set `note` (shown in the page subtitle). Source label stays `ESPN PPR overall`.

Does not change Routes or Home.

## Row

Each row: checkbox, colored position pill, ESPN rank pill next to full name + NFL team, injury status badge when not ACTIVE (same `statusBadge` as Routes), up to **3** Routes-style value chips (`proj`, `SOS #N`, then **Steal +N** / **Reach −N** when `|ESPN rank − ECR| ≥ 8`, else `ECR`). Steal = ESPN ranks later than industry ECR (falls in this room); Reach = ESPN ranks earlier. Gap uses the **selected scoring** board rank (`espnMinusEcr`; Standard overlay recomputes it). On Cheat Sheets only, Steal/Reach also shows a live number in parentheses: `static + max(0, next overall − ESPN rank)`. It moves once they stay on the board past their ESPN slot, toward `0` (then into steal territory). Example: Reach −10 still available 10 picks after ESPN #20 → `(0)`. Players not yet past their slot keep the static gap in the paren. Off-board rows keep the static chip only. Chips come from `client/src/utils/valueChips.ts` (shared with Routes, which still shows up to four, including Sleeper vs ADP, with no live paren). Neutral chips use near-white text on a slate fill.

- **Checkbox:** toggle off the board (anyone drafted — typically other teams). Strikethrough + muted row; stay in place so a mis-click can be undone. When the player is on My team the box is checked and disabled.
- **My team `✓` / `×`:** right-side control. Adds that player to your roster (amber highlight, no strikethrough), checks the left box, and disables it. `×` removes them from My team and unchecks the box.
- **Player click** (name, rank, chips): centered modal with the same solo compare card as Home search (`PlayerCompareDialog`, `GET /routes/compare`) — ESPN rank, proj, SOS, ECR, units, takeaways, same-team positional depth under the stats, plus the current-season **Game Log** to the right of the stats (`GET /routes/gamelog?name=&season=`), year dropdown, weeks **ascending**, expanded on open with **Show less**, and a **positional SOS** week row above the log with muted right-aligned **ROS #N (Favorable / Slightly favorable / Average / Tough)** text above the cells. **No news pane.** Closing the modal (Close, backdrop, Escape) leaves the checklist, filters, and scroll where they were.
- **Right click:** `preventDefault` the browser menu and toggle a sky highlight (also adds/removes Watch list). Checking the player off or adding them to My team clears the highlight. Right-click does nothing while they are off the board or on My team.

## Persistence

`localStorage` key `dsafd-cheatsheet-v1`: `{ picked, highlighted, mine, boardsCollapsed }` (player names + whether My team / Watch list are collapsed). Not keyed by scoring or slot. Survives refresh. Clear checks / Clear watchlist / Clear my team empty one set each.

## Files

- Server: `server/src/analysis/cheatSheet.ts`, route on `server/src/routes/analysis.ts`
- Client: `client/src/pages/CheatSheetsPage.tsx`, card on `client/src/pages/ToolsPage.tsx`, route in `client/src/main.tsx`, `getCheatSheet` in `client/src/services/api.ts`
- Shared chips: `client/src/utils/valueChips.ts`
- Snake path: `client/src/utils/snake.ts`
- CSS: `.cheat-toolbar`, `.cheat-row`, `.pos-pill` in `client/src/index.css`

Related: `docs/sot/enrichment-and-surfaces.md`, `docs/sot/draft-routes.md`, `docs/sot/strength-of-schedule.md`, `docs/sot/expert-consensus.md`.
