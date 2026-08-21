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

`current table` and `current standings` are explicit referential table cues.
They retain the most recent competition explicitly named in prior user turns;
without one, they resolve to the Premier League as the only supported
league-style table. This is deliberately narrower than arbitrary pronoun-based
competition retention.

Priced fixtures retain `grounding.kind = "match"`. Recognized non-priced
fixtures return `kind = "fixture"` plus their capability. Candidate-only text
gets no fixture badge. Deterministic post-processing strips probabilities and
scorelines from non-priced fixture answers. Closed capability questions are
answered by a deterministic grounded layer which preserves the exact status and
reason above; MiniMax cannot replace a typed reason with a guessed squad,
lineup, venue, rating, or policy explanation.

## Current-fact verification

Dated-fixture, manager, injury, lineup, transfer, recent-result, odds, and
correction cue classes trigger deterministic pre-search. The word `current`
alone is exempt when the question asks for a complete server-owned table,
model, or season-outlook fact. At most three official/reputable pages are
retrieved with protocol, DNS/address, redirect, content-type, size, timeout, and
shared-request-abort guards. One MiniMax M3 verification call selects supported
server-owned evidence IDs. Unsupported claims are removed, conflicts are
reported, and missing/retrieval/verifier failures abstain. The JSON and SSE
`done` contracts include verification status and counts.

Deterministic answer-path guards and supporting utilities enforce decimal-odds arithmetic, complete
same-source/time 1X2 markets, no-vig totals, external-data labels, scoreline
totals, manager-era attribution, correction cues, and contradictory-rationale
removal. If a mandatory market search yields zero supported claims and
verification abstains or is unavailable, generated prose is discarded. The
response deterministically uses only complete market rows already present in
match grounding, retains the verification status, emits no citations, and
omits the market section when no complete row exists.

The same deterministic grounded layer owns every no-search response with
complete match, non-priced fixture, competition, or season grounding. The
non-priced capability and identity-not-established candidate notices are
always deterministic. A mandatory current cue still performs the bounded
search, but its results cannot alter capability or promote identity. MiniMax is
limited to supported evidence-required prose plus
general/ungrounded open-ended analysis behind the existing search, verifier,
SSE, and 90-second deadline contracts.

Season source fidelity is separate from routing: an all-zero standings table
explicitly requested as the sole source establishes neither an on-field ranking
nor a champion. That response emits no season probabilities because those also
depend on club-strength ratings and the remaining schedule.

## Private friendly shadow policy

`FRIENDLY_SHADOW_ENABLED` defaults to false. The current release provides a
private policy/ledger library, not a scheduled collector; setting the flag alone
does not acquire fixtures or write forecasts. The library has no public API or
UI path and requires an authoritative/corroborated club
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
automatic collection or public promotion in this release.
