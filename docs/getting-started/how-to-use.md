# How to Use Pundit

Pundit has four main surfaces, all reachable from the top nav (Chat, Fixtures, Predictions) plus evaluation pages linked from the footer.

### The chat

The homepage suggests active club fixtures from the next 14 days — Premier League and UCL qualifiers, with EPL fixtures prioritised. Tap a suggestion or type your own question.

**Match questions** (e.g. "Arsenal vs Coventry") receive win/draw/win, over/under 2.5, BTTS, and likely scorelines from Pundit's model, plus any available Stake, Kalshi, or Polymarket 1X2 prices beneath the answer.

**Competition questions** (e.g. "Who leads the Premier League?") are grounded in the current ESPN standings table.

**Season outlook questions** (e.g. "Who wins the title?" or "Top-four chances") use a Monte Carlo simulation over remaining Premier League fixtures.

**General football questions** are clearly labelled as not grounded in Pundit's statistical model.

Match grounding is not always available, and the chat says which case applies rather than failing silently:

* **No fixtures in the window** — between rounds, or before the league season starts. Match-grounded reads return with the next scheduled round.
* **Recognized but outside coverage** — the structured fixture identity is established, but its competition or policy is outside the public model. This includes recognized friendlies. The chat retains the fixture context but shows no Pundit probabilities or invented scorelines.
* **Temporarily unavailable** — the model is initializing or refreshing. The chat keeps the recognized fixture context and identifies the temporary state.
* **Missing model input** — required ratings, venue state, or other context is unavailable. The chat keeps the recognized fixture context and fails closed without probabilities.
* **Identity not established** — user text or a search result may suggest a matchup, but without an approved structured identity it remains a discovery candidate. It receives no fixture badge and cannot be grounded or priced.

In every one of those cases the suggestions switch to table, title-race, and general questions, which do not depend on the match model. Nothing is broken during those windows.

Grounded assistant messages show a match, recognized-fixture, competition, or season-outlook badge; general answers are labelled separately, while discovery-only candidates receive no fixture badge. A recognized fixture remains the context for follow-ups, including a temporary table/season detour, until a new explicit recognized matchup replaces it. Use **New Chat** to clear both conversation and retained fixture context. Up to twelve history turns (six exchanges) carry forward for follow-ups. **Copy** and **Share** actions are available on assistant answers.

Every no-search response with complete match, non-priced fixture, competition, or season grounding is answered directly without a MiniMax call. Saying “current” does not by itself trigger external search when the requested fact is already in Pundit's table, model, or season grounding. Clearly current injury, squad, manager, transfer, odds, and form questions still search first. Non-priced capability and identity-not-established candidate notices stay deterministic even after mandatory search; a result cannot change capability or turn a discovery candidate into a fixture. If an odds search supports no claim, Pundit discards generated speculation and shows only complete market snapshots already attached to the grounded match, or no market section if none are complete. Every delivered positive current-news claim must carry a clickable, server-bound source and date, otherwise the answer removes the claim or abstains. Questions are capped at 500 characters; the API allows 10 requests per minute.

### Fixtures & Standings

The Fixtures page shows schedules and results across enabled competitions (Premier League and UCL qualifiers), with competition filter pills at the top. Live matches show current scores; the page displays when ESPN data was last refreshed. Each fixture links into chat via **Ask about this match**. Standings appear below the schedule for league competitions.

### Predictions (Model)

The Model page is a read-only table of active fixture probabilities: 1X2, totals, BTTS, and top scorelines. Expand a row for full detail. Competition filter pills match the Fixtures page. This is the same cache that powers match-grounded chat — not a separate model path.

### Evaluation

Two calibration pages live outside the primary nav (footer links):

* **`/evaluation/club-season`** — rolling pre-kickoff snapshots for finished club-season fixtures. Metrics update as new matches complete.
* **`/evaluation/wc-2026`** — frozen World Cup 2026 backtest artifact. Historical only; not connected to live chat or model caches.

See [Evaluation API](../api-reference/evaluation.md) for the JSON endpoints.
