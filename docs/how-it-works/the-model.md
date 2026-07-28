# The Model

Pundit's match probabilities come from a **Dixon-Coles Poisson model** calibrated on **ClubElo** ratings and computed locally inside the API. Club ratings refresh hourly; the active fixture set (14-day horizon across enabled competitions) is recomputed on the same cadence.

### Active fixture model

For each upcoming club fixture in the active window:

* **Win / draw / win probabilities** (`pHome`, `pDraw`, `pAway`) — Dixon-Coles output for that specific matchup
* **Over/under 2.5, BTTS, and likely scorelines** derived from the score matrix
* **Home-field advantage** applied for Premier League home teams (not for neutral-site tournaments)

Team strength comes from ClubElo CSV feeds, scoped by competition rating profile (domestic league vs continental).

### Season outlook simulator

For Premier League title-race and top-four questions, Pundit runs a **Monte Carlo simulation** over remaining scheduled fixtures:

* Uses current ESPN standings as the starting state
* Samples match outcomes from the same Dixon-Coles engine used for individual fixtures
* Reports title probability and top-four probability per team

This is separate from the per-fixture active cache — it answers "who wins the league?" rather than "who wins this match?"

### How the chat uses it

For an active fixture in the 14-day window, Pundit treats the fixture's precomputed probabilities as ground truth. It then:

1. Compares the model's win/draw/win read with complete active Stake, Kalshi, and Polymarket 1X2 prices when available
2. Runs a live web search only if current injury, squad, or form news would materially change the read — and says plainly when a search turns up nothing
3. Responds in plain language: headline odds, 1–2 likely scorelines, and what the underdog would need

Competition questions use ESPN standings only. Season questions add the Monte Carlo outlook on top of standings.

### Evaluation and calibration

Two read-only evaluation artifacts measure how well pre-kickoff probabilities matched reality:

| Artifact | Path | Method |
|---|---|---|
| **Club season (rolling)** | `/evaluation/club-season` | Immutable pre-kickoff snapshots captured when fixtures leave the scheduled window |
| **WC 2026 (frozen)** | `/evaluation/wc-2026` | Reconstructed pre-kickoff probabilities for every finished World Cup 2026 match |

The live Model page recalculates older fixtures with **current** ClubElo ratings — useful for exploration, but not a look-ahead-free backtest. Rigorous calibration uses the evaluation artifacts above.

### Historical note: World Cup 2026

The live World Cup tournament model (100k bracket simulations, neutral venues, eloratings.net TSV) is **retired**. Credibility for WC 2026 lives in the frozen backtest at `/evaluation/wc-2026` only.
