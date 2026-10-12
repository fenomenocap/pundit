# Pundit Chat Battle Test — 2026-10-12T12:08:38.718Z

- Run: `2026-10-12T12-08-38-718Z`
- Deployment: `3671edf6-6f19-46a2-9d7b-7f2476c97768` (api version)
- Source/API/Web SHAs: `740ee17db51dc7d82fce3fccf60c326d326d1eaf` / `c83873567e913f7286d1b678a9f94746cbe74fe4` / `9e2463d87d978d9e9982a768b6441fde2360e4f0`
- SHA convergence: PASS — api=c83873567e913f7286d1b678a9f94746cbe74fe4 (match vs floor c83873567e913f7286d1b678a9f94746cbe74fe4), web=9e2463d87d978d9e9982a768b6441fde2360e4f0 (ahead vs floor 432c9e509a09c9c7e63450d0c7b4ad33ca7ca8a9)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (9645b895-6905-4953-b46a-72b122069935 → 3671edf6-6f19-46a2-9d7b-7f2476c97768)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.767265000031 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 21, delta 21, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 614 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=344 chars. |
| pinned-current-manager-and-result-evidence | EXISTING ISSUE | 200 | 15191 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| owned-premier-league-latest-result | PASS | 200 | 289 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=218 chars. |
| dated-club-news-delivers-supported-update | REGRESSION | 200 | 18220 ms | turn 1: verification failed verificationStatus; turn 1: verification failed positiveNewsVerification; turn 1: positive dated club news failed positiveNewsVerification; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated |
| active-match-grounding | PASS | 200 | 233 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=164 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 558 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=57 chars. |
| table-route-preserves-match | PASS | 200 | 743 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=57 chars. |
| analyst-conversation-golden-path | PASS | 200 | 1436 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
| replacing-is-not-epl | PASS | 200 | 212 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 5680 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 51 of 81 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 51 of 81 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 51 of 81 observed identities routable). |
| observational-live-replacement | PASS | 200 | 650 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879242, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 51 of 81 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 253 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=164 chars. |
| complete-market-arithmetic | PASS | — | — ms | Built API runtime helper validateCompleteOneXTwoMarket returned the exact expected contract. |
| combined-scoreline-arithmetic | PASS | — | — ms | Built API runtime helper sanitizeFinalMatchAnswer returned the exact expected contract. |
| incomplete-market-fails-closed | PASS | — | — ms | Built API runtime helper validateCompleteOneXTwoMarket returned the exact expected contract. |
| third-party-probability-labelling | PASS | — | — ms | Built API runtime helper probabilityAttribution returned the exact expected contract. |
| model-probabilities-survive-market-guard | PASS | — | — ms | Built API runtime helper sanitizeFinalMatchAnswer returned the exact expected contract. |
| external-market-price-still-fails-closed | PASS | — | — ms | Built API runtime helper sanitizeFinalMatchAnswer returned the exact expected contract. |
| full-match-answer-survives-intact | PASS | — | — ms | Built API runtime helper sanitizeFinalMatchAnswer returned the exact expected contract. |
| uncited-injury-claim-is-still-removed | PASS | — | — ms | Built API runtime helper sanitizeFinalMatchAnswer returned the exact expected contract. |
| bare-numeric-marker-never-reaches-user | PASS | — | — ms | Built API runtime helper deliverMatchAnswerOffline returned the exact expected contract. |
| team-news-abstains-without-wiping-verdict | PASS | — | — ms | Built API runtime helper deliverMatchAnswerOffline returned the exact expected contract. |
| neutral-venue-missing-input | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| friendly-capability-runtime-contract | PASS | — | — ms | Built API runtime helper evaluateFixtureCapability returned the exact expected contract. |
| neutral-venue-capability-fault-contract | PASS | — | — ms | Deterministic fixture-grounding contract passed. |
| temporary-capability-runtime-contract | PASS | — | — ms | Built API runtime helper evaluateFixtureCapability returned the exact expected contract. |
| stale-manager-official-conflict | PASS | — | — ms | Built API runtime helper attributeManagerEra returned the exact expected contract. |
| correction-after-wrong-history | PASS | — | — ms | Built API runtime helper containsCorrectionCue returned the exact expected contract. |
| one-one-is-not-over-two-five | PASS | — | — ms | Built API runtime helper settleScorelineTotal returned the exact expected contract. |
| unrelated-citation-rejected | PASS | — | — ms | Built API runtime helper applyClaimDecisions returned the exact expected contract. |
| degraded-search-retrieval-verifier | PASS | — | — ms | Built API runtime helper applyClaimDecisions returned the exact expected contract. |
| team-news-sourcing | PASS | 200 | 14049 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 8943 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=abstain, citations=0, answer=240 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 475 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=abstain, citations=0, answer=307 chars. |
| market-comparison-coverage | PASS | 200 | 222 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
| competition-grounding | PASS | 200 | 214 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 876 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1449 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=450 chars. |
| season-certainty-follow-up | PASS | 200 | 2410 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 237 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 628 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 236 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 225 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 205 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 200 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 485 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=525 chars. |
| user-line-pass-play | PASS | 200 | 498 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=293 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 450 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=141 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 224 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=164 chars. |
| featured-totals-honesty | PASS | 200 | 257 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=150 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 481 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=268 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 221 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=2135 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 234 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=735 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 228 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=1018 chars. |
| sse-ordering | PASS | 200 | 211 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 227 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 215 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 436 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1456 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=450 chars. |
| adversarial-grounding | PASS | 200 | 534 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879267, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2449 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=475 chars. |
| adversarial-malformed | PASS | 400 | 214 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **EXISTING ISSUE — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
2. **REGRESSION — dated-club-news-delivers-supported-update:** turn 1: verification failed verificationStatus; turn 1: verification failed positiveNewsVerification; turn 1: positive dated club news failed positiveNewsVerification; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated

## Recommendations

No code change recommended from this run.
