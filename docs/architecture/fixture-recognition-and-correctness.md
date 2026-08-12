# Fixture recognition and response correctness

## Identity boundary

`FixtureCandidate` is a discovery hint from a user or search result. It has no
authoritative identity and is never persisted, grounded, or priced.

`RecognizedFixture` exists only after an approved structured source supplies a
stable event ID. Its internal identity is source-scoped, for example
`espn:eng.1:401`, because provider IDs are not interchangeable. It records
canonical teams, kickoff, venue and neutral-site state, competition category,
status, observed sources, and a bounded material-change history. Mappings are
written atomically under `PUNDIT_DATA_DIR/fixture-registry`, with a last-good
artifact used if the primary file is unreadable.

The source study in `fixture-source-study.md` is binding for expansion. ESPN is
the technical primary for the already validated competitions. New automated
collection is rights-gated. Official competition, federation, and club pages
corroborate identity and conflicts; search only discovers candidates.

## Capability boundary

Recognition and model support are separate decisions:

- `priced(modelFixtureId)` — an unchanged existing model row exists.
- `temporarily-unpriced(model-initializing|ratings-refreshing)` — transient state.
- `outside-coverage(unsupported-competition|friendly-policy-disabled|model-policy-disabled)`.
- `insufficient-model-input(ratings-unavailable|neutral-venue-unknown|required-context-missing)`.

The public match model consumes recognized, policy-eligible fixtures only. The
recognition gate adds no numeric input and the protected deployed probability
payload has an exact regression hash in `model-data.test.ts`.

`FIXTURE_REGISTRY_ENABLED` defaults to false. The registry still observes the
existing authoritative cache in shadow mode and exposes a read-only
`GET /api/fixtures/recognized` certification surface. Enabling the flag changes
routing coverage; it does not enable friendly pricing.

## Routing and UI

Routing precedence is explicit recognized matchup, retained `fixtureContext`,
authoritative fixture lookup, competition/season, then general analysis.
`fixtureContext` wins over the temporary `teamContext` compatibility field. A
table detour does not delete the retained fixture, while a new explicit matchup
replaces it. Token boundaries prevent `epl` from matching `replacing`, and
match/1X2 intent cannot be overridden by a competition token.

Priced fixtures retain `grounding.kind = "match"`. Recognized non-priced
fixtures return `kind = "fixture"` plus their capability. Candidate-only text
gets no fixture badge. Deterministic post-processing strips probabilities and
scorelines from non-priced fixture answers.

## Current-fact verification

Dated fixtures, managers, injuries, lineups, transfers, recent results, odds,
and corrections pre-search. At most three official/reputable pages are
retrieved with protocol, DNS/address, redirect, content-type, size, timeout, and
shared-request-abort guards. One MiniMax M3 verification call selects supported
server-owned evidence IDs. Unsupported claims are removed, conflicts are
reported, and missing/retrieval/verifier failures abstain. The JSON and SSE
`done` contracts include verification status and counts.

Deterministic utilities separately enforce decimal-odds arithmetic, complete
same-source/time 1X2 markets, no-vig totals, external-data labels, scoreline
totals, manager-era attribution, correction cues, and contradictory-rationale
removal.

## Private friendly shadow policy

`FRIENDLY_SHADOW_ENABLED` defaults to false. Even when enabled, the policy has
no public API or UI path. It requires an authoritative/corroborated club
friendly, explicit neutral-site state, ratings provenance, expected-squad
evidence, rotation assessment, substitution format, and a pre-kickoff timestamp.
It applies zero home-field advantage and shrinks 1X2 probabilities toward equal
uncertainty.

Rows append atomically to the private schema-v1 ledger under
`PUNDIT_DATA_DIR/evaluation/friendly-shadow-v1.json`, with a validated last-good
copy and a single-writer lock. Each row records the numeric ratings and model,
policy, and checkpoint versions; only one immutable checkpoint is allowed per
fixture and policy version. Forecast collisions are reported and never
overwritten. Results require an authoritative finished source, must be observed
between kickoff and the write time, and append without altering inputs. Zero-sample
Brier/log loss are null, with chronological completed rows producing Brier,
log loss, calibration buckets, and neutral/rotation segments. There is no
automatic public promotion.
