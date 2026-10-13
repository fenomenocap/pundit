# Pundit Chat Battle Test — 2026-10-13T23:17:06.239Z

- Run: `2026-10-13T23-17-06-239Z`
- Deployment: `e4375139-fb62-484a-a746-97a00e85cefe` (api version)
- Source/API/Web SHAs: `455cb5539633ae43c029b36eb9fc211633233371` / `455cb5539633ae43c029b36eb9fc211633233371` / `668c1cac5b36ba28380ac92fcc75b9980e36ddb6`
- SHA convergence: PASS — api=455cb5539633ae43c029b36eb9fc211633233371 (match vs floor 455cb5539633ae43c029b36eb9fc211633233371), web=668c1cac5b36ba28380ac92fcc75b9980e36ddb6 (ahead vs floor 432c9e509a09c9c7e63450d0c7b4ad33ca7ca8a9)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (bb73ea01-7287-4639-a992-e6df4da29820 → e4375139-fb62-484a-a746-97a00e85cefe)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13025.31213799998 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 24, delta 24, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 398 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=344 chars. |
| pinned-current-manager-and-result-evidence | EXISTING ISSUE | 200 | 26774 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| owned-premier-league-latest-result | PASS | 200 | 223 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=218 chars. |
| dated-club-news-delivers-supported-update | PASS | 200 | 16951 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=verified, citations=2, answer=1052 chars. |
| active-match-grounding | PASS | 200 | 161 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 377 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=54 chars. |
| table-route-preserves-match | PASS | 200 | 526 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=54 chars. |
| analyst-conversation-golden-path | PASS | 200 | 1105 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=162 chars. |
| replacing-is-not-epl | PASS | 200 | 152 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 5269 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 51 of 73 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 51 of 73 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 51 of 73 observed identities routable). |
| observational-live-replacement | PASS | 200 | 450 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878758, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 51 of 73 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 168 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
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
| team-news-sourcing | PASS | 200 | 25832 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=verified, citations=1, answer=464 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 25803 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=abstain, citations=0, answer=704 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 360 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=abstain, citations=0, answer=304 chars. |
| market-comparison-coverage | PASS | 200 | 171 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=162 chars. |
| competition-grounding | PASS | 200 | 165 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 598 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1481 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| season-certainty-follow-up | PASS | 200 | 2426 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 150 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 467 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 157 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 147 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 149 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 152 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 380 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=520 chars. |
| user-line-pass-play | PASS | 200 | 395 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=291 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 355 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=138 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 164 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| featured-totals-honesty | PASS | 200 | 165 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=150 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 367 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=268 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 166 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=2101 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 184 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=724 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 184 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=992 chars. |
| sse-ordering | PASS | 200 | 157 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 164 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 146 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 395 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1346 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| adversarial-grounding | PASS | 200 | 371 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2355 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=474 chars. |
| adversarial-malformed | PASS | 400 | 144 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **EXISTING ISSUE — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification

## Recommendations

No code change recommended from this run.
