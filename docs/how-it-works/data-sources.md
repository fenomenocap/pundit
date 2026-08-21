# Data Sources

Pundit generates its own model probabilities from public football and market
inputs and refreshes an in-memory cache on a schedule. The structured football
and market sources below are keyless; MiniMax chat/search requires the private
server-side API key.

| Source | What it provides | Refresh |
|---|---|---|
| **ESPN public scoreboard API** | Fixtures, live/final scores, match stage, and league standings for Premier League and UCL qualifiers | Every 30 minutes |
| **Recognized-fixture registry** | Approved structured identities, observed source history, and model-capability decisions; persisted atomically with last-good recovery. Reviewed friendly records require an ESPN stable event ID plus official corroboration and remain outside pricing. | Every ESPN refresh and release-approved manifest load |
| **Pinned ClubElo artifact** | Reviewed club ratings by competition profile, used by the Dixon-Coles model | Content-addressed release artifact; active model recomputes hourly with no runtime ClubElo call |
| **Stake, Kalshi, and Polymarket public endpoints** | Best-effort active 1X2 prices normalized to no-vig probabilities for the active fixture set | Every 30 minutes |
| **Pundit's local model** | Dixon-Coles fixture matrices for the active club-fixture window; Monte Carlo season outlook from a complete, season-aware Premier League schedule | Model hourly; complete schedule checked every 30 minutes and refreshed ahead of its six-hour freshness deadline |
| **Deterministic grounded responses** | Renders complete server-owned match, season, table, and non-priced capability facts without asking a language model to recreate them | Per eligible request |
| **MiniMax M3** | Handles evidence-required current analysis and general/ungrounded open-ended questions; every complete server-grounded no-search response bypasses it. Pundit pre-searches clearly current injury/squad questions and can make one bounded search fallback for ambiguous requests. | Per non-deterministic request |

If ESPN or a refreshable model input is temporarily unavailable, Pundit keeps
serving a validated last-known-good snapshot where one exists, so those figures
may occasionally lag by up to the applicable refresh window above. Club
strengths are different: they are immutable within a release and fail closed
after the artifact's 30-day freshness limit rather than drifting with a runtime
provider. Registry
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
