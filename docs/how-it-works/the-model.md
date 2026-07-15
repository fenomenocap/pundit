# The Model

Pundit's probabilities come from a **Dixon-Coles Poisson model**, calibrated on live Elo ratings, run by a companion project (`worldcup-model`) rather than by Pundit itself. Pundit fetches and caches that project's output and grounds every chat answer in it.

### What the model produces

For every team still in the tournament:

* **Win probability** — chance of winning the tournament outright
* **Semifinal probability** — chance of reaching the semifinals
* **Quarterfinal probability** — chance of reaching the quarterfinals
* **Market price & edge** — the team's live market-implied probability, and the gap between the model's view and the market's (positive edge means the model is more bullish on that team than the market)

For every fixture:

* **Win / draw / win probabilities** (`pHome`, `pDraw`, `pAway`) — Dixon-Coles Poisson output for that specific matchup
* **Market-implied probabilities**, when available — no-vig odds derived from Stake's live 1X2 pricing for the same fixture
* **Result**, once played

### How the chat uses it

When you ask Pundit about a matchup, it looks up that fixture's precomputed probabilities and treats them as ground truth — it doesn't recompute or second-guess the model's numbers. It then:

1. Compares the model's win/draw/win read against the market's (when a market price exists for that fixture) and calls out the edge
2. Runs a live web search only if current injury, squad, or form news would materially change the read — and says plainly when a search turns up nothing, rather than inventing something
3. Responds in plain language: headline odds, 1–2 likely scorelines, and what the underdog would need

### A note on venues

All World Cup 2026 fixtures are played at neutral sites. "Home" and "away" throughout Pundit's data are positional labels carried over from how fixtures are recorded — they do **not** imply a home-field advantage, and the model doesn't apply one.
