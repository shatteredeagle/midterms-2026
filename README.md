# 2026 Midterm Election Dashboard

Live: **https://shatteredeagle.github.io/midterms-2026/**

Results map, polling averages, prediction-market odds, and exit polls for the November 3, 2026 US midterms. Static site (no build step, no dependencies); a GitHub Action refreshes data every ~5 minutes.

## Sources
| Source | Used for | Cadence |
|---|---|---|
| [Polymarket](https://polymarket.com) | Win odds per Senate/governor/House race, chamber control, seat totals | Action every 5 min; control odds also live in the browser (30 s) |
| [PollCheck](https://www.pollcheck.co.uk/us-midterms-2026) | Polling averages, ratings, generic ballot | Action every 5 min |
| California Secretary of State | Official governor count | Action every 5 min |
| Exit polls | Entered by hand into `data/exit-polls.json` (no open feed exists) | Manual |

Map colors are market probabilities, not votes. A race is "projected" only after its state's polls close and the market is at 99%+.

## Layout
- `assets/` static site (`app.js`, `markets.js`, `states.js`, `map-paths.json`)
- `scripts/collect.mjs` collector (Node 20+, no deps); `scripts/build-map.mjs` regenerates the map
- `.github/workflows/collect.yml` publishes `markets/polls/results/status.json` to the `data` branch
- `data/` seed snapshot and `exit-polls.json`

## Adding exit polls
Edit `data/exit-polls.json` and push; Pages redeploys in about a minute.
```json
{"updated":"2026-11-03T23:00:00Z","status":"partial",
 "sources":[{"id":"ap","name":"AP VoteCast"},{"id":"ssrs","name":"SSRS"}],
 "questions":[{"title":"House vote by gender","groups":[
   {"label":"Men","values":{"ap":{"dem":47,"rep":52},"ssrs":{"dem":46,"rep":53}}}]}]}
```

## Adding official state feeds
Add a function to `results()` in `scripts/collect.mjs` that returns `races["S-XX"|"G-XX"] = {source, reporting, pct, totalVotes, cands:[{n,p,votes,pct}]}`.

MIT licensed.
