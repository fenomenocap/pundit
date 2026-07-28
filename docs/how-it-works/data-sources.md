# Data Sources

Pundit generates its own model probabilities from public inputs and refreshes an in-memory cache on a schedule. Nothing below requires authentication, and none of it is proprietary to Pundit.

| Source | What it provides | Refresh |
|---|---|---|
| **ESPN public scoreboard API** | Fixtures, live/final scores, match stage, and league standings for Premier League and UCL qualifiers | Every 30 minutes |
| **ClubElo CSV feeds** | Current club ratings by competition profile, used by the Dixon-Coles model | Every hour (with the model) |
| **Stake, Kalshi, and Polymarket public endpoints** | Best-effort active 1X2 prices normalized to no-vig probabilities for the active fixture set | Every 30 minutes |
| **Pundit's local model** | Dixon-Coles fixture matrices for the 14-day active club-fixture window; Monte Carlo season outlook for the Premier League | Every hour |
| **Claude** (Anthropic) | Powers the chat's natural-language answers, grounded in the data above; can run a live web search for current injury/squad news | Per request |

If an upstream source is temporarily unavailable, Pundit keeps serving the last-known-good cached data rather than showing nothing — so figures may occasionally lag by up to the refresh window above.

ESPN is authoritative for whether a match is scheduled, live, or completed. Only fixtures in the active 14-day window receive current match grounding and live market rows in chat.

### Model vs market odds

**Model probabilities** are computed locally from ClubElo ratings and the Dixon-Coles engine — they are Pundit's independent estimate.

**Market comparison odds** are reference prices fetched from Stake, Kalshi, and Polymarket public endpoints, normalized to no-vig 1X2 probabilities. They show where public markets disagree with the model; Pundit does not execute trades on any platform.

### Legacy endpoints

`GET /api/polymarkets/*` and `GET /api/model/wc` retain World Cup 2026 reference data or return **410 Gone** for the live WC model. They are not used by the club-season product. See [Polymarket Reference Odds](../api-reference/polymarkets.md).

None of this data is used to settle any kind of wager inside Pundit — see the [Disclaimer](../support/disclaimer.md).
