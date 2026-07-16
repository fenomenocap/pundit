# The Model

Pundit's probabilities come from a **Dixon-Coles Poisson model** calibrated on live Elo ratings and run directly inside Pundit's API. Every six hours Pundit refreshes ESPN fixtures and standings, fetches current Elo ratings, recomputes fixture score matrices, and runs 100,000 tournament simulations.

### What the model produces

For every team still in the tournament:

* **Win probability** — chance of winning the tournament outright
* **Semifinal probability** — chance of reaching the semifinals
* **Quarterfinal probability** — chance of reaching the quarterfinals
* **Market price & edge** — the team's live market-implied probability, and the gap between the model's view and the market's (positive edge means the model is more bullish on that team than the market)

For every fixture:

* **Win / draw / win probabilities** (`pHome`, `pDraw`, `pAway`) — Dixon-Coles Poisson output for that specific matchup
* **Over/under 2.5, BTTS, and likely scorelines** derived from the score matrix
* **Result and authoritative winner**, once played

### How the chat uses it

For an ESPN-active semifinal or final, Pundit treats the fixture's precomputed probabilities as ground truth. It then:

1. Compares the model's win/draw/win read with complete active Stake, Kalshi, and Polymarket 1X2 prices when available
2. Runs a live web search only if current injury, squad, or form news would materially change the read — and says plainly when a search turns up nothing, rather than inventing something
3. Responds in plain language: headline odds, 1–2 likely scorelines, and what the underdog would need

### Historical evaluation caveat

Pundit retains every ESPN fixture and completed result in its in-memory model cache. Each refresh recalculates older fixture probabilities with current Elo ratings, so it is useful for exploration but is not a look-ahead-free backtest dataset. Rigorous calibration requires immutable pre-kickoff snapshots, which are intentionally deferred.

### A note on venues

All World Cup 2026 fixtures are played at neutral sites. "Home" and "away" throughout Pundit's data are positional labels carried over from how fixtures are recorded — they do **not** imply a home-field advantage, and the model doesn't apply one.
