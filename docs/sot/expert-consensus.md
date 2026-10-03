---
title: Expert Consensus
source: DSAFD app internals
date: 2026-09-07
confidence: high
kind: app
tags: [app, enrichment, consensus, ecr, takeaways]
---

# Expert Consensus

App-internal source of truth for the **industry consensus axis** next to the ESPN room board. Other seats and steal/reach **labels** still use ESPN rank. Values, landmines, SOS, Off/OL, path scoring, and strategy copy read this layer.

See also: `docs/sot/enrichment-and-surfaces.md`, `docs/sot/draft-routes.md`, `docs/sot/strength-of-schedule.md`.

## Files

Built by `scripts/enrichment/build-consensus.ts` (`npm run enrichment:build-consensus`). Raw drop folder: `data/enrichment/consensus/raw/` (no HTML scrape of FantasyPros/PFF).

| File | What |
|------|------|
| `consensus/raw/*.csv` | Source ranks. README in that folder. |
| `consensus-ranks-2026.csv` | `playerName, pos, team, ecr, ecrPos, ecrBest, ecrWorst, ecrStdev, experts`. Seeded from the FantasyPros column in `site-ranks-espn-ppr-2026.csv` unless a FantasyPros ECR export is dropped in `raw/`. |
| `consensus-sos-2026.csv` | Same 1–5 scale as DraftEdge `sos-2026.csv`. Average of DraftEdge and the FPA 1–32 board (mapped 1–32 → 1–5). |
| `consensus-units-2026.csv` | `team, oline, dline, offense, power` as average rank 1–32. |
| `consensus-meta.json` | Sources + build date. |
| `expert-takeaways.json` | Structured claims (`id, topic, claim, sources[], players[], positions[], rounds[]`). Hand-authored, not built by the script. |

`sos-2026.csv` stays as DraftEdge raw. `team-ranks-2026.csv` stays as Action Network raw; 2026 Off/OL used at runtime is the consensus overlay.

## Derived on each ranked player

Computed in `toPlayer` (`server/src/analysis/draftRoutes.ts`), not hand-edited:

| Field | Formula | Read as |
|-------|---------|---------|
| `ecr` | Consensus overall rank | Industry board |
| `espnMinusEcr` | ESPN rank − ECR | Positive = **steal in this ESPN room** |
| `ecrMinusAdp` | ECR − mean(ESPN, Sleeper, Yahoo, Underdog ADP) | Negative = **industry sleeper**; chip/list if `≤ −8` |
| `expertSpread` | ECR stdev, else best−worst | High = volatile / bust-risk, not “ESPN landmine” |
| `consensusSos` | Same adjusted 1–5 as `sos` (consensus file, fallback DraftEdge) | Scoring + blurbs |
| `consensusOline` / `consensusDline` / `consensusPower` | From `consensus-units-2026.csv` | Compare + SOS Off/OL overlay; D/ST list shows D-line rank |

Landmine remains an **ESPN-room display metric** (1 = steal, 10 = room-forced reach). It is not the main boom/bust term in `valueScore`.

## Path scoring (`valueScore`)

| Factor | Effect |
|--------|--------|
| ESPN − ECR | `clamp(espnMinusEcr, −12, 16) * 2.2` |
| Expert spread | `−clamp(expertSpread, 0, 25) * 0.9` |
| Industry sleeper | if `ecrMinusAdp < 0`, `clamp(−ecrMinusAdp, 0, 16) * 1.1` |
| ESPN vs Sleeper ADP | still clamped ±8 × 1.0 (room-ADP signal) |
| SOS | `(sos − 3) * 11` on **consensus** 1–5 (fallback Source A) |
| Off/OL nudge | Consensus 2026 oline/offense vs Action Network 2025 |

Steal/reach **labels** stay ESPN rank vs overall pick.

## Where it shows

| Surface | What |
|---------|------|
| Strategy → Draft → Routes chips | Proj, SOS, Steal/Reach (`|ESPN−ECR| ≥ 8`) else ECR, then Sleeper (`ecrMinusAdp ≤ −8`) and Spread (high stdev). SOS is consensus. |
| Tools → Cheat Sheets chips | Same `valueChips` helper, capped at 3 (proj, SOS, Steal/Reach if `|ESPN−ECR| ≥ 8` else ECR). Steal/Reach uses the selected scoring rank, plus a live `(N)` that moves toward 0 after they fall past their ESPN rank. |
| Strategy → Draft → Routes blurbs | Can cite a matching `expert-takeaways.json` claim (player name, or Hero RB on an R1–R3 RB when you have no RB yet). |
| Strategy → Draft → Values | Industry sleepers (`ecrMinusAdp ≤ −8`) and ESPN-room values (`espnMinusEcr ≥ 8`). |
| Strategy → Draft → Landmines | ESPN-room landmines (`landmine ≥ 6.2` or `espnMinusEcr ≤ −8`) plus ADP landmines. |
| Compare / Home card | ECR, ESPN−ECR, sleeper gap, consensus SOS rank, consensus OL (2025 AN in parentheses). Team positional depth (ESPN order among teammates) under the stats. Player takeaways whose `players[]` match. |
| Tools → Cheat Sheets modal | Same compare card as Home/Routes (solo dialog) plus current-season Game Log (year dropdown) and positional SOS week row. No news. |
| Home columns / Strategy → Draft → Learnings | Strategy-topic takeaways mixed in, tagged with `sources`. |
| Tools → SOS → List | Consensus remaining-slate ranks; subtitle notes DraftEdge + FPA. Defense tab shows consensus D-line rank as extra. |

Google News stays Home-only.
