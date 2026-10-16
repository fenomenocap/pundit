# Pundit Chat Battle Test — 2026-10-16T12:08:22.270Z

- Run: `2026-10-16T12-08-22-270Z`
- Deployment: `5e80bc8e-87ef-4b2e-80ee-3a72886f8d8f` (api version)
- Source/API/Web SHAs: `6021c9545489ed94cf20097e25050b4c767a18a4` / `6021c9545489ed94cf20097e25050b4c767a18a4` / `c166efff63d8a62ba29e3e08d92a68ef9a7cc9f4`
- SHA convergence: PASS — api=6021c9545489ed94cf20097e25050b4c767a18a4 (match vs floor 6021c9545489ed94cf20097e25050b4c767a18a4), web=c166efff63d8a62ba29e3e08d92a68ef9a7cc9f4 (match vs floor c166efff63d8a62ba29e3e08d92a68ef9a7cc9f4)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (ccaf8969-29ad-479a-bd0e-078a0adcde5a → 5e80bc8e-87ef-4b2e-80ee-3a72886f8d8f)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.837514999963 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 24, delta 24, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 526 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=344 chars. |
| pinned-current-manager-and-result-evidence | EXISTING ISSUE | 200 | 13870 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| owned-premier-league-latest-result | PASS | 200 | 134 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=218 chars. |
| dated-club-news-delivers-supported-update | INTERMITTENT | 200 | 28142 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=verified, citations=2, answer=672 chars. |
| active-match-grounding | PASS | 200 | 113 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 358 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=54 chars. |
| table-route-preserves-match | PASS | 200 | 638 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=54 chars. |
| analyst-conversation-golden-path | PASS | 200 | 837 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=162 chars. |
| replacing-is-not-epl | PASS | 200 | 130 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 4424 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 60 of 81 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 60 of 81 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 60 of 81 observed identities routable). |
| observational-live-replacement | PASS | 200 | 388 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878758, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 60 of 81 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 136 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
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
| team-news-sourcing | PASS | 200 | 27014 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=verified, citations=2, answer=702 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 46712 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=abstain, citations=0, answer=704 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 431 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=abstain, citations=0, answer=304 chars. |
| market-comparison-coverage | PASS | 200 | 153 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=162 chars. |
| competition-grounding | PASS | 200 | 129 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 532 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1469 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| season-certainty-follow-up | PASS | 200 | 2421 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 176 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 398 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 309 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 157 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 126 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 126 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 286 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=520 chars. |
| user-line-pass-play | PASS | 200 | 339 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=291 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 469 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=138 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 172 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| featured-totals-honesty | PASS | 200 | 145 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=150 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 294 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=268 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 135 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=2101 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 149 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=724 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 152 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=992 chars. |
| sse-ordering | PASS | 200 | 117 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 123 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 130 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 243 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1290 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=199 chars. |
| adversarial-grounding | PASS | 200 | 277 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2397 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=474 chars. |
| adversarial-malformed | PASS | 400 | 115 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **EXISTING ISSUE — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification

## Recommendations

No code change recommended from this run.
