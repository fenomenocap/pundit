# Welcome to Pundit

Pundit is a chat-first analysis app for the club season — Premier League and UEFA Champions League qualifiers. Ask about an upcoming match for probabilities grounded in Pundit's statistical model, ask about the league table or title race, or get clearly labelled general football analysis.

Under the hood, every answer is backed by:

* A **Dixon-Coles match model** (a reviewed, pinned ClubElo strength artifact plus home-field advantage where applicable) that produces win/draw/loss, totals, BTTS, and scoreline probabilities for active fixtures without a runtime ClubElo call
* A **season outlook simulator** for Premier League title and top-four probabilities, gated on a complete persisted schedule and full rating coverage
* Active **Stake, Kalshi, and Polymarket** 1X2 prices for featured matches, shown alongside the model when available
* Live **fixtures, results, and standings** from ESPN, with approved structured identities separated from discovery-only fixture candidates

Recognized fixtures that the public model cannot price stay available as context with a specific coverage or input label. They never receive invented Pundit probabilities.

Pundit doesn't run its own markets and there's nothing to trade here — it's an analysis layer on top of public data.

### Where to start

* [What is Pundit](getting-started/what-is-pundit.md) — the short version of what this product does
* [How to Use Pundit](getting-started/how-to-use.md) — the chat, fixtures page, model page, and evaluation pages
* [The Model](how-it-works/the-model.md) — how the underlying probabilities are actually generated
* [Evaluation API](api-reference/evaluation.md) — calibration artifacts and metrics
* [API Reference](api-reference/overview.md) — if you want to pull the data yourself

### Historical note

World Cup 2026 live analysis is retired. The frozen backtest lives at `/evaluation/wc-2026`.
