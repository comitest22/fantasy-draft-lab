# Consensus raw drop folder

Drop source CSVs here, then run `npm run enrichment:build-consensus`.

The script does **not** scrape FantasyPros, PFF, or ESPN HTML.

| File | Scale | Used for |
|------|--------|----------|
| `fantasypros-ecr-ppr-2026.csv` | optional ECR export (`playerName,pos,team,ecr,ecrPos,ecrBest,ecrWorst,ecrStdev,experts`) | `consensus-ranks-2026.csv`. If missing, the builder seeds ECR from the FantasyPros column in `site-ranks-espn-ppr-2026.csv`. |
| `sos-fpa-2026.csv` | rank **1–32**, 1 = easiest fantasy-points-allowed slate | Averaged with DraftEdge `sos-2026.csv` (1–5) |
| `pff-oline-2026.csv` | rank **1–32**, 1 = best | Consensus O-line |
| `sharp-oline-2026.csv` | rank **1–32**, 1 = best | Consensus O-line |
| `public-offense-2026.csv` | rank **1–32**, 1 = best | Consensus offense (with Action Network `team-ranks-2026.csv`) |
| `dline-2026.csv` | rank **1–32**, 1 = best | Consensus D-line |
| `espn-power-2026.csv` / `cbs-power-2026.csv` / `nfl-power-2026.csv` | rank **1–32**, 1 = best | Consensus power |

Team codes match the rest of enrichment (`LA` not `LAR`, `JAX` not `JAC`).
