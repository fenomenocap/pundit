# FAQ

**Can I bet or trade on Pundit?**
No. Pundit doesn't run markets, hold funds, or offer any way to place a wager. It's an analysis tool — see the [Disclaimer](disclaimer.md).

**Why won't Pundit answer my question?**
Pundit needs to identify two teams with a confirmed fixture between them. If the matchup hasn't been determined yet (e.g. a knockout-round pairing that depends on earlier results), or if you didn't name both teams clearly, it'll say so rather than guess.

**How current is the data?**
Fixtures, standings, model probabilities, and Polymarket odds all refresh on a 6-hour cycle. If a data source is briefly unavailable, Pundit keeps showing the last-known-good data rather than nothing.

**Where do the odds come from?**
Model probabilities come from a Dixon-Coles Poisson model calibrated on live Elo ratings. Market comparisons come from Polymarket (tournament/group markets) and Stake (per-fixture 1X2 odds). See [Data Sources](../how-it-works/data-sources.md).

**Does "home"/"away" mean anything for World Cup matches?**
Not in terms of home-field advantage — all 2026 World Cup matches are at neutral venues. The labels are positional only.

**Is there an API?**
Yes, all data shown in the app is available read-only with no authentication. See the [API Reference](../api-reference/overview.md).
