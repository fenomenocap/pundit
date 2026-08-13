# Data Sources

Pundit generates its own model probabilities from public football and market
inputs and refreshes an in-memory cache on a schedule. The structured football
and market sources below are keyless; MiniMax chat/search requires the private
server-side API key.

| Source | What it provides | Refresh |
|---|---|---|
| **ESPN public scoreboard API** | Fixtures, live/final scores, match stage, and league standings for Premier League and UCL qualifiers | Every 30 minutes |
| **Recognized-fixture registry** | Approved structured identities, observed source history, and model-capability decisions; persisted atomically with last-good recovery | Every ESPN refresh |
| **ClubElo CSV feeds** | Current club ratings by competition profile, used by the Dixon-Coles model | Every hour (with the model) |
| **Stake, Kalshi, and Polymarket public endpoints** | Best-effort active 1X2 prices normalized to no-vig probabilities for the active fixture set | Every 30 minutes |
| **Pundit's local model** | Dixon-Coles fixture matrices for the 14-day active club-fixture window; Monte Carlo season outlook for the Premier League | Every hour |
| **MiniMax M3** | Powers the chat's natural-language answers, grounded in the data above; Pundit pre-searches clearly current injury/squad questions and can make one bounded search fallback for ambiguous requests | Per request |

If a cached ESPN, ratings, or model source is temporarily unavailable, Pundit
keeps serving its validated last-known-good snapshot where one exists — so
figures may occasionally lag by up to the refresh window above. Registry
persistence failure is isolated from the live model and exposed in registry
status rather than promoting incomplete data. Market sources are best-effort;
search, retrieval, or verifier failure removes unsupported current claims or
abstains rather than serving an unverified fallback as fact.

ESPN is the approved structured primary for the currently validated competitions and supplies exact scheduled, in-play, completed, postponed, and cancelled states. A fixture must be recognized and policy-eligible before the public model can consume it. Search and user text are discovery only: they can create a `FixtureCandidate`, never a recognized identity, grounding context, or model input.

Recognition is distinct from capability. A recognized fixture may be priced, temporarily unpriced, outside coverage, or missing required model input. Only priced fixtures receive Pundit probabilities; a complete verified bookmaker market may be described as third-party data and is never relabelled as Pundit's model.

### Model vs market odds

**Model probabilities** are computed locally from ClubElo ratings and the Dixon-Coles engine — they are Pundit's independent estimate.

**Market comparison odds** are reference prices fetched from Stake, Kalshi, and Polymarket public endpoints, normalized to no-vig 1X2 probabilities. They show where public markets disagree with the model; Pundit does not execute trades on any platform.

### Legacy endpoints

`GET /api/polymarkets/*` and `GET /api/model/wc` retain World Cup 2026 reference data or return **410 Gone** for the live WC model. They are not used by the club-season product. See [Polymarket Reference Odds](../api-reference/polymarkets.md).

None of this data is used to settle any kind of wager inside Pundit — see the [Disclaimer](../support/disclaimer.md).
