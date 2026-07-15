# Data Sources

Pundit doesn't generate its own tournament or market data — it pulls from public sources and refreshes an in-memory cache on a schedule. Nothing below requires authentication, and none of it is proprietary to Pundit.

| Source | What it provides | Refresh |
|---|---|---|
| **ESPN public scoreboard API** | Fixtures, live/final scores, match stage, and group standings for the full tournament | Every 6 hours |
| **Polymarket Gamma API** | Live consensus odds for World Cup outright-winner and group-winner markets (reference only, not tradeable in Pundit) | Every 6 hours |
| **`worldcup-model`** (companion project) | Dixon-Coles Poisson team and fixture probabilities, plus a comparison against Stake's live 1X2 odds | Every 6 hours |
| **Claude** (Anthropic) | Powers the chat's natural-language answers, grounded in the model data above; can run a live web search for current injury/squad news | Per request |

If an upstream source is temporarily unavailable, Pundit keeps serving the last-known-good cached data rather than showing nothing — so figures may occasionally lag by up to the refresh window above.

None of this data is used to settle any kind of wager inside Pundit — see the [Disclaimer](../support/disclaimer.md).
