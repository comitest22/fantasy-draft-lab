---
title: Draft Routes
source: BLITZ app internals
date: 2026-09-07
confidence: high
kind: app
tags: [app, strategy, routes, openings, podium]
---

# Draft Routes

App-internal source of truth for Strategy → Draft → Routes: how paths are built, how openings work, and what the UI currently shows.

## What a route is

A **route** is a pick-by-pick snake path for one draft seat. The engine walks the full draft, assumes the room takes remaining ESPN rank order, and at your picks scores a candidate pool using projections, ADP/value signals, roster need, and SOS.

Primary files:

- Engine: `server/src/analysis/draftRoutes.ts`
- UI: `client/src/components/DraftRoutesView.tsx`
- Opening helpers: `client/src/utils/opening.ts`
- Page: `client/src/pages/StrategyPage.tsx` (Routes / Values / Landmines tabs)
- Playbook that feeds openings: `server/src/analysis/contenderPlaybook.ts`

## How a path is built

`buildValueRoute`:

1. Walk overall picks `1 … leagueSize * totalRounds`.
2. **Other seats** take the next remaining board player (naive ADP/rank order), skipping anyone reserved by your locks.
3. **Your pick**: score the candidate pool (`valueScore`), take the lead, attach alternates.
4. Optional **opening** string (`WR-RB-WR`) forces positions for rounds 1–3 via `parseOpening`.
5. Optional **locks** pin a specific player in a round; later rounds re-score.

Replay (opening change, swap, optional pick) hits `POST /api/analysis/routes/replay` with `{ slot, opening?, locks?, teams?, format? }`.

Strategy → Draft → Routes / Values / Landmines honor the page’s **Teams** and **Roster** dropdowns (default `10` + `2wr-1flex`, this league). `GET /strategy?teams=&format=` rebuilds the route book with that `leagueSize` and roster (including optional `superflex`). Podium and Era ignore the dropdowns and keep using historical league config. Learnings + Takeaways live under Insights.

### Pick kinds

- **steal**: ESPN rank + 3 ≤ overall pick
- **reach**: ESPN rank > overall + 4
- **pivot**: otherwise

### Scoring (`valueScore`)

Base: `expectedPoints`, or `max(0, 280 − rank)` if missing.

| Factor | Effect |
|--------|--------|
| QB before round 5 / second QB | −420 / −400 (skipped in Superflex until both QB slots are filled) |
| K / D/ST before round 10 | −500 |
| Roster need | `rosterAdjust` (RB/WR/TE/QB/DST/K timing). After round 2, reaches only get 30% of this. |
| ESPN − ECR | `clamp(espnMinusEcr, −12, 16) * 2.2` (positive = steal in this ESPN room) |
| Expert spread | `−clamp(expertSpread, 0, 25) * 0.9` |
| Industry sleeper | if `ecrMinusAdp < 0`, `clamp(−ecrMinusAdp, 0, 16) * 1.1` |
| ESPN ADP vs Sleeper / Underdog | Sleeper clamped ±8 × 1.0 (max +8); Underdog clamped × 1.4 |
| **SOS (consensus adjusted 1–5)** | `(sos − 3) * 11` |
| ESPN much earlier than industry ADP | penalty |
| Reach vs overall | After round 2, tax starts at `overall + 4` at 12 pts/spot (rounds 1–2: `+ 6` at 7). Need-based reaches are **not** in the lead pool after round 2; they still appear as optionals. |
| Same bye week | First skill player on a bye is free; each extra teammate on that bye is −10 (cap −25). K / D/ST skipped. |
| Player likely gone before next pick | −8 snipe / −28 wait |

SOS in scoring is the **adjusted remaining-slate score** (computed 2026 remaining matchups mixed with a fading DraftEdge+FPA prior). See `docs/sot/strength-of-schedule.md` and `docs/sot/expert-consensus.md`.

Landmine is still stored and shown on Values/Landmines and Compare as an ESPN-room metric. It is not a `valueScore` term.

### Blurbs

`expertTake` / `altTake` use the same adjusted 1–5 SOS, plus consensus value flags (`espnMinusEcr`, `ecrMinusAdp ≤ −8`) and matching `expert-takeaways.json` claims (named player, or Hero RB on an R1–R3 RB when you have none yet):

- `sos ≥ 4` → “friendly slate”, “soft schedule”, “easier RB slates”, “easier remaining schedule”
- `sos ≤ 2` → “talent over matchups… The slate is rocky”

## Openings and podium

Openings are first-three **skill** patterns (`WR` / `RB` / `TE` only).

```
Historical drafts + standings
  → buildContenderPlaybook
      openingPatterns (top-3 first-three shapes)
      slotOutcomes (best/worst seats)
  → buildDraftRouteBook
      book.openings = league skill patterns by top3Pct
      slot.openings = patterns used from that seat, podium-first
  → UI opening pills force R1–R3 positions on replay
```

Per-seat openings (`skillOpeningsForSlot`) prefer patterns that produced top-3 finishes from that slot, then fill from the league list.

Thesis can cite the common podium shape: “Podium teams from pick N have often opened X.”

Power rankings (ESPN / PFF / etc.) are **not** used to pick route players.

`client/src/utils/opening.ts`:

- `formatOpening` — `WR Name / RB Name / …`
- `isSkillOpening` — exactly three of WR\|RB\|TE
- `firstThreeOpening` — route rounds ≤ 3 → pattern
- `featuredOpenings` — top 4 historical skill pills
- `otherOpenings` — remaining historical skill combos (plus the live combo if it is not in the top 4)
- `preferredOpening` — first of `featuredOpenings`
- `openingTooltip` — pattern, podium %, top-3 count

Podium UI (`ContenderPlaybookView`, `PodiumCompare`) shows the same opening idea historically. It does not run the live path.

## Current Routes UI

Layout, top to bottom:

1. Subtitle: source, board size, league size, roster, value note.
2. **Slot pills** — `Pick {n}` + historical `% top-3`. Hover: seat label, detail, snake path, top-3 rate.
3. **Opening pills** — top 4 `{WR-RB-WR}` + `% podium`, plus an always-visible **Other** dropdown of remaining combos. Selecting Other shows that pattern + podium % on the trigger. Early-round swaps that change the first-three shape select Other and replay with the new opening. Hover: pattern, podium %, top-3 count.
4. **Seat banner**
5. **Path card** — title, projected points, thesis, pick list.

### Seat banner (as implemented)

```
Pick {slot} · {Best seat | Trap seat | Turn value | Early pick | Middle pick}
{seatDetail}
Snake path {p1 → p2 → …}
```

Seat labels come from `seatFor` + `playbook.slotOutcomes` (`edge`, `trap`, `turn`, `early`, `middle`). Suggested slot is `upcomingDraftSlot`, else last user slot, else best historical finish, else 5.

### Path card title (as implemented)

```
Podium opening from this seat: WR-RB-WR
```

The title uses the selected opening pill (or the route’s `shape`). Switching opening pills updates that header. There is **no extra `XX-XX-XX` line under the title**. Projected points sit on the right of the header; thesis is the paragraph below.

### Pick row

- `R{round} · {overall}`
- Player name, plus `SUS` / `IR` / `Exempt` badge from `player-status-2026.csv` when ESPN status is suspended, IR, or exempt/NFI/PUP
- `{pos}{posRank} · {team} · ESPN #{rank} · ADP {adp}` (site-ranks ADP, else ESPN ADP). Team on the player is site-ranks, else site ADP, else consensus ECR. If those have no team, `enrichmentStore.rosterTeam` uses this season’s fantasy-points team, then ESPN depth, then `td-player.csv` (`FA` skipped). That same team feeds SOS chips and the bio week strip.
- Up to four chips: proj, SOS rank, Steal/Reach (`|ESPN−ECR| ≥ 8`) else ECR, sleeper vs ADP, high expert spread (`client/src/utils/valueChips.ts`, also used by Tools → Cheat Sheets at a 3-chip cap with a live `(N)` after they fall past ESPN rank). Neutral (`proj` / `ECR`) chips use near-white text on a slate fill; SOS is green for easiest (`≤ 8`) and slate otherwise (not red); steal/reach/sleeper keep green/red.
- Reason blurb
- Optional alternates (steal / pivot / reach styling)
- Compare + Swap

Clicking an optional **swaps in place** for that round (old main joins the optional row; the other optionals stay). Later rounds still re-sim. Clicking the player opens stats (`PlayerCompareDialog` solo). Compare opens the same dialog with a second player. Swap rebuilds from a board picker.

SOS chips prefer **rank** (`SOS #N easiest` if ≤ 8, `toughest` if ≥ 25). Full SOS behavior: `docs/sot/strength-of-schedule.md`.

## Values and Landmines

Not inside the path card. Strategy tabs **Values** and **Landmines** render `MarketPanel` from the same `routes.market` payload.

Thresholds in `buildMarketBoard`:

- Industry sleepers (Values): `ecrMinusAdp ≤ −8`
- ESPN-room values (Values): `espnMinusEcr ≥ 8`
- ESPN-room landmines: `landmine ≥ 6.2` or `espnMinusEcr ≤ −8`
- ADP landmines: `espnMinusSleeper ≤ −3.5`

Columns include ECR, ESPN−ECR, sleeper gap, and spread. See `docs/sot/expert-consensus.md`.

## Player compare

`GET /api/analysis/routes/compare?name=` → `buildPlayerCompare`.

Payload includes `weekProjectedPoints` (current-week ESPN PPR proj from public leaguedefaults by athlete / D/ST fantasy id — any board or depth player, not roster-only) and `weekMatchup` (current-week opponent + ESPN OPRK rank vs position + FP allowed/game from `espn-oprk` averages). Rows include **ESPN Current Rank** (overall ESPN board), **Current Pos. Rank** (YTD at position), proj, SOS `#rank`, ECR, ESPN−ECR, sleeper gap (ECR−ADP), landmine (room metric), ESPN ADP vs Sleeper, **offense rank** and **O-line rank** (2026 consensus, 2025 Action Network in parentheses), QB, years with QB, last-year PPR. **D/ST Season** swaps skill YTD metrics for **vs Run / vs Pass** as **yds/g (#rank)** (rank 1 = fewest yards allowed from `defense-stats` ÷ games played through `completedWeeks`), D/ST remaining-slate SOS (`getDstSosRank`), and YTD **Sacks** / **Turnovers** as `count (#rank)` among NFL D/STs (heat uses the NFL rank band like vs Run/Pass — top ~10 green — not raw counts). **Current Pos. Rank** is YTD at the position (skill: `fantasy-points`; D/ST: fantasy game-log FPTS rank among 32), matching My Team / FA **PRK** — not draft-board order or ROS projection ranks. Under the stats table: **team positional depth** (`depthChart`) — same NFL team + same position, ordered by ESPN rank (RB1 / WR2 / …), with the opened player highlighted. Merges the ranked ADP board with `espn-depth-{season}.csv` extras (requires ESPN rank or ownership — skips empty historical stubs) so mid-season call-ups appear even when they sit past the top-500 draft board. Depth extras are fantasy percent-owned candidates **intersected with each team's live ESPN roster**, so retired / FA stubs still tagged to a club in fantasy (e.g. Mike Williams on LAC) are dropped. Team matches the player card’s resolved `nflTeam` (ranks / roster / depth), so a stale ADP team code does not pull the wrong depth chart. This is ESPN-rank order among **current roster** teammates, not an official NFL depth chart. Matching `expert-takeaways.json` claims whose `players[]` contain the name render under that.

UI: Strategy → Routes name click (solo dialog) and Compare button (two-player dialog). Tools → Cheat Sheets name click uses the same solo dialog (no news) so the checklist stays on the page. Home (`/`) player search uses the same `PlayerCompareDialog` in page mode (`variant="page"`) after a board lookup via `GET /routes/board`. Header search placeholder is `{ Search players by pressing \ }` ; pressing **`\`** anywhere (when not typing in an input) focuses that field. Solo dialogs and Cheat Sheets still put **Game Log** beside the stats table. On Home, SOS + Game Log stack **under** the stats on the left (`GET /routes/gamelog?name=&season=`): ESPN athlete weekly lines for the **current draft season** by default (2026), PPR FPTS, current-season weeks 1–18 padded from schedule (upcoming opp + — stats; byes marked), weeks listed **ascending** (opens scrolled so **currentWeek+1** sits at the bottom of the visible log on the live season), with a year dropdown covering the current season through four years back. Game log resolves players from the ranked board **or** `espn-depth` / YTD points (same as compare), using athlete ids from `espn-ids-{season}.csv` written by the Tuesday/Friday ranks sweep. **Above the log** is that player’s **positional SOS** week row (Tools → SOS Offense Source B cells for their team/position). On the same line as the ROS label, **Week _ to _ Apply** hides weeks outside the range (defaults **1–18**; Apply clamps and swaps if from > to). **Remaining Schedule** (checkbox next to Apply) sets the fields to currentWeek–18 and shows only those weeks; unchecking restores the prior applied range. **ROS #** stays remaining-slate Source A. The **current week** number is green on the strip. Unfiltered muted text is **ROS #N** plus a `rankHeat` quality pill (Favorable / Slightly favorable / Average / Tough; bands 1–8 / 9–16 / 17–24 / 25–32) from remaining-slate Source A rank (weeks after `completedWeeks` through end of season — not a full-season 1–18 average). After Apply to a custom range (not full season and not remaining), the label is spaced **W# - W#** · **SOS #N** + the same quality heat pill (no leading zero on single-digit weeks); the # recomputes from the applied weeks (avg Source B / OPRK cells across teams, re-ranked 1–32). Next to the **Game Log** heading, RB/WR/TE get **Receiving** / **Rushing** pills (default Receiving for WR/TE, Rushing for RB); QB gets **Passing** / **Rushing** (default Passing). Receiving shows **TGT**, REC, YDS, AVG, TD, FPTS; Rushing shows CAR, YDS, AVG, TD, FPTS; Passing shows CMP/ATT/YDS/TD/INT + FPTS. The table opens **expanded** (all weeks) with **Show less**. D/ST has no ESPN athlete log (SOS still shows). Compare also shows **2026 YTD PPR** when `fantasy-points.csv` has in-progress rows, with last year in the existing paren. Home loads **Latest news** from `GET /routes/news?name=` (`server/src/analysis/playerNews.ts`) in the **right column**: Google News RSS search for `"Name" NFL`, up to 8 headlines (title/source/date, 10-minute cache). Wrapper links are unwrapped with the RSS cookie session against `/rss/articles/` then `garturlreq` (publisher URL attached when that works). ESPN site news APIs are not used (they 403 from this host). Clicking a headline stays on Home and sets `?article=` to load an excerpt in the right-hand news pane when the publisher is readable; otherwise the pane shows the error plus **Open original**. Iframes are not used. **← Back to news results** returns to the list. Ctrl/Cmd-click opens the publisher (or Google News if unwrap failed). `GET /routes/news/article?url=` is the extract path (15-minute cache; `articleText` drops duplicate paragraphs from mirrored mobile/desktop DOM copies). My Team name-click uses `PlayerCompareDialog` `variant="roster"`: no duplicate title header; name/pos card with a ratings grid under it (ROS + current week × ESPN / Yahoo / Sleeper — ESPN OPRK for the week and remaining-week OPRK average for ROS; Yahoo/Sleeper blank until sourced) and compact depth chart to the top-right (3 players per column, horizontal scroll beyond two columns, header centered); **Latest news** under that row; full-width Game Log then full-width SOS (grey surface boxes); bio stats in a matching grey box with **Draft** / **Season** tabs and a multi-column stat grid (Season default — includes YTD offense PF rank + PBP sack-rate O-line; Draft keeps preseason consensus Off/OL); **×** close outside the modal to the right. Article state stays in the modal (no URL change).

## API

Mounted at `/api/analysis`:

| Method | Path | Returns |
|--------|------|---------|
| GET | `/strategy?teams=&format=` | recommendations, era, sotDocs, playbook, **routes book** (routes use the query; podium/era data is still this league; recommendations feed Insights → Learnings) |
| POST | `/routes/replay` | `{ route, board }` (body may include `teams`, `format`) |
| GET | `/routes/board` | slim board |
| GET | `/routes/compare?name=` | `{ card }` |
| GET | `/routes/gamelog?name=&season=` | `{ log }` current-season ESPN weekly lines + PPR FPTS + `sosSlate` (positional week cells); resolves ranked board **or** depth/YTD extras via `espn-ids`; skill columns include `tgt`/`rec*`/`rush*` with `group` for Receiving/Rushing pills; `season` optional (`draftSeason` default, clamped to last five years) |
| GET | `/routes/news?name=` | `{ items: [{ title, url, source?, published?, canonicalUrl?, excerpt?, truncated? }] }` RSS headlines (unwrap when possible) |
| GET | `/routes/news/article?url=` | `{ article: { title?, canonicalUrl, excerpt, truncated, error? } }` |

## Strategy page tabs

Routes · Values · Landmines · Podium · Era · Research

Teams (8/10/12/14) and roster dropdowns sit above the pills. Default is this league: **10-team · 2 WR / 1 FLEX**. Other roster presets: 2 WR / 2 FLEX, 3 WR / 1 FLEX, 3 WR / 2 FLEX, and Superflex variants. They retune Routes scoring/blurbs (WR need, Superflex QB timing). Round count follows roster spots (`draftRounds`), so extra WR/FLEX/Superflex adds rounds if bench stays 5. Podium and Era do not change.

Podium tables do not repeat timing takeaways (`showAdvice={false}`); those live under Insights → Draft Takeaways. Insights → Draft Learnings cite strategy SOT docs and mix in consensus strategy takeaways (tagged sources). This file stays off Research (`kind: app`). Details: `docs/sot/cheat-sheets.md`.

**Routes** shows SOS chips and blurbs. Tools → Cheat Sheets reuses the same chip helper (no blurbs). Podium is the contender playbook.
