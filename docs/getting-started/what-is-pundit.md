# What is Pundit

Pundit is a chat-first analysis app for the club season — Premier League and UEFA Champions League qualifiers. Recognized, policy-eligible active fixtures receive win/draw/win, totals, BTTS, and scoreline probabilities from Pundit's statistical model, plus public 1X2 market prices and plain-language analysis.

It is **not** a betting or trading product. Pundit doesn't take positions, hold funds, or offer wagers. See the [Disclaimer](../support/disclaimer.md).

### Answer types

1. **Match analysis** — a recognized, policy-eligible Premier League or UCL qualifier fixture with win/draw/win, totals, BTTS, scoreline probabilities, and any valid active Stake/Kalshi/Polymarket prices.
2. **Competition analysis** — league table questions grounded in ESPN standings.
3. **Season outlook** — Premier League title or top-four probabilities from a remaining-fixture Monte Carlo simulation.
4. **General analysis** — football help that is explicitly labelled as not grounded in Pundit's statistical model.

Premier League fixtures apply home-field advantage. UCL qualifiers use the same Dixon-Coles model with home-field boost where configured.

Recognition does not imply pricing. A recognized fixture outside public coverage, temporarily unavailable, or missing required inputs keeps its identity and follow-up context but displays no Pundit probabilities. A matchup found only in user text or search remains a discovery candidate, receives no fixture badge, and cannot enter the model.

### What you can do

* Ask about upcoming fixtures suggested on the homepage
* Ask about the Premier League table, title race, or top-four picture
* Browse the full fixtures, results, and standings (with Ask-about-this-match links)
* Browse the native model reference page and use the read-only API
* Review calibration artifacts at `/evaluation/club-season` (rolling) and `/evaluation/wc-2026` (frozen WC backtest)
