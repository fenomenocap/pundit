# How to Use Pundit

Pundit has four main surfaces, all reachable from the top nav (Chat, Fixtures, Predictions) plus evaluation pages linked from the footer.

### The chat

The homepage suggests active club fixtures from the next 14 days — Premier League and UCL qualifiers, with EPL fixtures prioritised. Tap a suggestion or type your own question.

**Match questions** (e.g. "Arsenal vs Coventry") receive win/draw/win, over/under 2.5, BTTS, and likely scorelines from Pundit's model, plus any available Stake, Kalshi, or Polymarket 1X2 prices beneath the answer.

**Competition questions** (e.g. "Who leads the Premier League?") are grounded in the current ESPN standings table.

**Season outlook questions** (e.g. "Who wins the title?" or "Top-four chances") use a Monte Carlo simulation over remaining Premier League fixtures.

**General football questions** are clearly labelled as not grounded in Pundit's statistical model.

Every assistant message shows a grounding badge: match, competition, season outlook, or general analysis. Use **New Chat** to clear context. Up to twelve history turns (six exchanges) carry forward for follow-ups. **Copy** and **Share** actions are available on assistant answers.

Answers can take several seconds — Claude may run a live web search for injury, squad, or form news. Questions are capped at 500 characters; the API allows 10 requests per minute.

### Fixtures & Standings

The Fixtures page shows schedules and results across enabled competitions (Premier League and UCL qualifiers), with competition filter pills at the top. Live matches show current scores; the page displays when ESPN data was last refreshed. Each fixture links into chat via **Ask about this match**. Standings appear below the schedule for league competitions.

### Predictions (Model)

The Model page is a read-only table of active fixture probabilities: 1X2, totals, BTTS, and top scorelines. Expand a row for full detail. Competition filter pills match the Fixtures page. This is the same cache that powers match-grounded chat — not a separate model path.

### Evaluation

Two calibration pages live outside the primary nav (footer links):

* **`/evaluation/club-season`** — rolling pre-kickoff snapshots for finished club-season fixtures. Metrics update as new matches complete.
* **`/evaluation/wc-2026`** — frozen World Cup 2026 backtest artifact. Historical only; not connected to live chat or model caches.

See [Evaluation API](../api-reference/evaluation.md) for the JSON endpoints.
