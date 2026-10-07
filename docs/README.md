# Welcome to Pundit

Pundit is an analysis desk for the club season — Premier League and UEFA Champions League qualifiers. Ask about an upcoming match for probabilities grounded in Pundit's statistical model, ask about the league table or title race, or get clearly labelled general football analysis. The homepage is the desk; Paper, Draft, and Vaults are a local paper lab, not a bookmaker.

Under the hood, every answer is backed by:

* A **Fundamental v3 score model** that preserves the rating/home-advantage win/draw/loss probabilities while calibrating EPL total-goal rates, allocation and low-score shape from historical results. Totals, BTTS, scorelines and calibrated expected goals come from one final joint grid. UCL qualifiers, neutral and pre-origin fixtures retain the baseline 2.70-total shape. Both ratings and EPL calibration are reviewed, pinned artifacts; production never contacts ClubElo
* A **season outlook simulator** for Premier League title and top-four probabilities, gated on a complete persisted schedule and full rating coverage
* Active **Stake, Kalshi, and Polymarket** 1X2 prices for featured matches, shown alongside the model when available
* Live **fixtures, results, and standings** from ESPN, with approved structured identities separated from discovery-only fixture candidates

Recognized fixtures that the public model cannot price stay available as context with a specific coverage or input label. They never receive invented Pundit probabilities.

Pundit doesn't run its own markets and there's nothing to trade here — it's an analysis layer on top of public data.

The unchanged calibration family passed a later five-season retrospective validation frozen before label acquisition: scoreline and BTTS metrics improved while 1X2 was preserved. Totals met the declared noninferiority margin; their interval includes zero, so significant superiority is unproven. Earlier exposed development results and a failed 2017–18 reserve remain reported. Sequential cohort research is not adjusted away, and no historical test proves future superiority or deployment completion; see [The Model](how-it-works/the-model.md).

### Where to start

* [What is Pundit](getting-started/what-is-pundit.md) — the short version of what this product does
* [How to Use Pundit](getting-started/how-to-use.md) — the desk, paper lab, fixtures, model, and ledger
* [The Model](how-it-works/the-model.md) — how the underlying probabilities are actually generated
* [Evaluation API](api-reference/evaluation.md) — calibration artifacts and metrics
* [API Reference](api-reference/overview.md) — if you want to pull the data yourself

### Historical note

World Cup 2026 live analysis is retired. The frozen backtest lives at `/evaluation/wc-2026`.
