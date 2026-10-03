# DSAFD

DontSuckAtFantasyDrafts — analyze your ESPN fantasy football draft history, compare good vs bad eras, and build a data-driven draft strategy.

## Features

- **Import** ESPN draft exports (`.docx` format)
- **Grade picks** against historical ADP and fantasy points
- **Compare eras** (2015–2021 vs 2022+ by default)
- **Strategy recommendations** backed by SOT research docs
- **Survivor hubs** for winner knockout, loser knockout, and anytime-TD streak
- **Research agent** to refresh strategy library via Cursor SDK

## Quick start

```bash
# Install dependencies
npm install
npm install --prefix server
npm install --prefix client

# Copy env
cp .env.example .env

# Run dev (client :5173, server :3001)
npm run dev
```

Open http://localhost:5173

## Importing drafts

1. Export your ESPN draft to `.docx` (Round / NO. / Player / Team format)
2. Go to **Import** in the app
3. Select season year and upload file
4. Map your fantasy team name and optional final standing
5. Save

## Project structure

```
client/          React + Vite dashboard
server/          Express API, parser, analysis engine
data/
  drafts/        Parsed draft JSON per season
  enrichment/    Fantasy points + ADP CSVs
  league-config.json
docs/sot/        Strategy research + app-internal SOT (`kind: app` files stay off the Research tab)
scripts/
  research/      Cursor SDK research runner
  enrichment/    Enrichment data utilities
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start client + server |
| `npm run build` | Production build |
| `npm run type-check` | TypeScript check |
| `npm run test --prefix server` | Parser tests |
| `npm run research:sot -- --topic ppr-10-team-draft-strategy` | Run research agent |
| `npm run enrichment:refresh` | Check enrichment data status |

## Enrichment data

Add rows to `data/enrichment/fantasy-points.csv` and `data/enrichment/adp.csv` for new seasons:

```csv
playerName,season,position,nflTeam,fantasyPoints,gamesPlayed
playerName,season,position,adp,expectedPoints
```

## Deployment

- **Frontend:** Vercel (see `vercel.json`)
- **Backend:** Render or similar Node host
- Set `DATA_DIR` on the server to persist draft JSON, or commit `data/drafts/` to the repo

## League config

Edit `data/league-config.json`:

```json
{
  "leagueSize": 10,
  "scoring": "ppr",
  "goodEraEnd": 2021,
  "badEraStart": 2022,
  "seasons": {
    "2015": {
      "userTeamName": "Your Team Name",
      "finalStanding": 3
    }
  }
}
```

## Research agent

Requires `CURSOR_API_KEY` in `.env`:

```bash
npm run research:sot -- --topic draft-slot-strategy
```

Available topics: `ppr-10-team-draft-strategy`, `positional-scarcity-and-runs`, `historical-bust-rates-by-round`, `draft-slot-strategy`, `in-season-vs-draft-value`
