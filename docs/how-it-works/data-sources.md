# Data Sources

Pundit doesn't generate its own tournament or market data — it pulls from public sources and refreshes an in-memory cache on a schedule. Nothing below requires authentication, and none of it is proprietary to Pundit.

| Source | What it provides | Refresh |
|---|---|---|
| **ESPN public scoreboard API** | Fixtures, live/final scores, match stage, and group standings for the full tournament | Every 6 hours |
| **Polymarket Gamma API** | Retained outright-winner and group-winner reference endpoints | Every 6 hours |
| **`worldcup-model`** (companion project) | Full fixture/model history plus normalized active Stake, Kalshi, and Polymarket 1X2 markets | Every 6 hours |
| **Claude** (Anthropic) | Powers the chat's natural-language answers, grounded in the model data above; can run a live web search for current injury/squad news | Per request |

If an upstream source is temporarily unavailable, Pundit keeps serving the last-known-good cached data rather than showing nothing — so figures may occasionally lag by up to the refresh window above.

ESPN is authoritative for whether a match is scheduled, live, or completed. Only scheduled/in-play semifinals and the championship final receive current match grounding and live market rows. The full historical fixture/model dataset remains available through the API.

None of this data is used to settle any kind of wager inside Pundit — see the [Disclaimer](../support/disclaimer.md).
