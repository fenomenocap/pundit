# Data Sources

Pundit generates its own model probabilities from public inputs and refreshes an in-memory cache on a schedule. Nothing below requires authentication, and none of it is proprietary to Pundit.

| Source | What it provides | Refresh |
|---|---|---|
| **ESPN public scoreboard API** | Fixtures, live/final scores, match stage, and group standings for the full tournament | Every 30 minutes |
| **eloratings.net TSV feeds** | Current ratings used by the local Elo-to-Poisson model | Every hour (with the model) |
| **Stake, Kalshi, and Polymarket public endpoints** | Best-effort active 1X2 prices normalized to no-vig probabilities for featured fixtures | Every 30 minutes |
| **Polymarket Gamma outright/group feeds** | Retained tournament/group reference prices | Every 6 hours |
| **Pundit's local model** | Dixon-Coles fixture matrices and 100,000-run tournament probabilities using ESPN's actual bracket state | Every hour |
| **Claude** (Anthropic) | Powers the chat's natural-language answers, grounded in the model data above; can run a live web search for current injury/squad news | Per request |

If an upstream source is temporarily unavailable, Pundit keeps serving the last-known-good cached data rather than showing nothing — so figures may occasionally lag by up to the refresh window above.

ESPN is authoritative for whether a match is scheduled, live, or completed. Only scheduled/in-play semifinals, the 3rd-place match, and the championship final receive current match grounding and live market rows. The full historical fixture/model dataset remains available through the API.

None of this data is used to settle any kind of wager inside Pundit — see the [Disclaimer](../support/disclaimer.md).
