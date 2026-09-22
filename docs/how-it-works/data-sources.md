# Data Sources

Pundit generates its own model probabilities from public football and market
inputs and refreshes an in-memory cache on a schedule. The structured football
and market sources below are keyless; answers and search require the private
server-side `OPENROUTER_API_KEY` (pinned answer model `deepseek/deepseek-v4-flash`).
`MINIMAX_API_KEY` is the answer fallback only when OpenRouter is unset and does
not serve search.

| Source | What it provides | Refresh |
|---|---|---|
| **ESPN public scoreboard API** | Fixtures, live/final scores, match stage, and league standings for Premier League and UCL qualifiers | Adaptive: 2 min (live), 10 min (matchday), 30 min (normal) |
| **Recognized-fixture registry** | Approved structured identities, observed source history, and model-capability decisions; persisted atomically with last-good recovery. Reviewed friendly records require an ESPN stable event ID plus official corroboration and remain outside pricing. | Every ESPN refresh and release-approved manifest load |
| **Pinned ClubElo artifact** | Reviewed club ratings by competition profile, used by the Dixon-Coles model | Content-addressed release artifact; active model recomputes on the adaptive model cadence with no runtime ClubElo call |
| **Stake, Kalshi, and Polymarket public endpoints** | Best-effort active 1X2 prices normalized to no-vig probabilities for the active fixture set | Adaptive: 5 min (live), 10 min (matchday), 30 min (normal) |
| **Pundit's local model** | Dixon-Coles fixture matrices for the active club-fixture window; Monte Carlo season outlook from a complete, season-aware Premier League schedule | Adaptive: 15 min (live), 30 min (matchday), 60 min (normal); complete schedule checked on the ESPN cadence |
| **Match grounding context** | Server-owned form (last five), table snippet, ClubElo ratings, and expected-goals split attached to priced fixtures — used before external search | Recomputed with the model cache; `freshness` metadata on each match payload |
| **Federated analytics retrieval** | Search fan-out across analytics and news sources (FBref, The Analyst, Whoscored, Fotmob, Transfermarkt, BBC, Goal, and other listed publishers). Search calls OpenRouter chat completions with `openrouter:web_search` (Exa), keeps `url_citation` pages, and discards model prose. Results are tier-tagged and cited, never blended into Pundit probabilities | Per evidence-required request |
| **Deterministic grounded responses** | Renders complete server-owned match, season, table, and non-priced capability facts without asking a language model to recreate them. “Current” alone does not require external search for these owned facts. An all-zero table requested as the only evidence refuses to rank teams rather than borrowing probabilities from ratings and the schedule. | Per eligible request |
| **MiniMax M3** | Handles evidence-required current analysis and general/ungrounded open-ended questions; every complete server-grounded no-search response bypasses it. Pundit pre-searches injury, squad, manager, transfer, odds and similar external-current questions via federated retrieval and can make one bounded search fallback for ambiguous requests. If market verification supports nothing, generated prose is discarded in favour of complete market rows already in grounding. | Per non-deterministic request |

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

**Third-party analytics** (xG tables, Opta predictions, form ratings from FBref, The Analyst, Whoscored, and similar) arrive through OpenRouter citation search (`openrouter:web_search` / Exa) only. They are labelled external evidence and are never relabelled as Pundit's model.

Research roster (not runtime config): `packages/api/data/research/agent-data-sources/agent-data-sources.json`.

### Legacy endpoints

`GET /api/polymarkets/*` and `GET /api/model/wc` retain World Cup 2026 reference data or return **410 Gone** for the live WC model. They are not used by the club-season product. See [Polymarket Reference Odds](../api-reference/polymarkets.md).

None of this data is used to settle any kind of wager inside Pundit — see the [Disclaimer](../support/disclaimer.md).
