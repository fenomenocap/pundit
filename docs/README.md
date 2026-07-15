# Welcome to Pundit

Pundit is a chat-first analysis tool for the 2026 FIFA World Cup. Ask about the active semifinal/final, the title race, or a football concept and receive a clearly labelled grounded or general answer.

Under the hood, every answer is backed by:

* A **Dixon-Coles Poisson model** (calibrated on live Elo ratings) that produces win/draw/loss and score probabilities for every fixture in the tournament
* Active **Stake, Kalshi, and Polymarket** 1X2 prices for featured late-stage matches, shown alongside the model
* Live **fixtures, results, and group standings** pulled straight from the tournament as it happens

Pundit doesn't run its own markets and there's nothing to trade here — it's an analysis layer on top of public data.

### Where to start

* [What is Pundit](getting-started/what-is-pundit.md) — the short version of what this product does
* [How to Use Pundit](getting-started/how-to-use.md) — the chat, the fixtures page, and the model page
* [The Model](how-it-works/the-model.md) — how the underlying probabilities are actually generated
* [API Reference](api-reference/overview.md) — if you want to pull the data yourself
