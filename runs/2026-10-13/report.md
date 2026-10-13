# Pundit Chat Battle Test — 2026-10-13T01:56:37.057Z

- Run: `2026-10-13T01-56-37-057Z`
- Deployment: `5011d9af-3772-4ac5-be28-5225c067c7ab` (api version)
- Source/API/Web SHAs: `5eb360c9650e4fc5c6ea3c29f08d38d6f2a48f91` / `5eb360c9650e4fc5c6ea3c29f08d38d6f2a48f91` / `9e2463d87d978d9e9982a768b6441fde2360e4f0`
- SHA convergence: PASS — api=5eb360c9650e4fc5c6ea3c29f08d38d6f2a48f91 (match vs floor 5eb360c9650e4fc5c6ea3c29f08d38d6f2a48f91), web=9e2463d87d978d9e9982a768b6441fde2360e4f0 (ahead vs floor 432c9e509a09c9c7e63450d0c7b4ad33ca7ca8a9)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (3671edf6-6f19-46a2-9d7b-7f2476c97768 → 5011d9af-3772-4ac5-be28-5225c067c7ab)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13025.263532000012 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 21, delta 21, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 313 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=344 chars. |
| pinned-current-manager-and-result-evidence | EXISTING ISSUE | 200 | 21616 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| owned-premier-league-latest-result | PASS | 200 | 84 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=218 chars. |
| dated-club-news-delivers-supported-update | EXISTING ISSUE | 200 | 31696 ms | turn 1: verification failed verificationStatus; turn 1: verification failed positiveNewsVerification; turn 1: positive dated club news failed positiveNewsVerification; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated |
| active-match-grounding | PASS | 200 | 123 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 232 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=54 chars. |
| table-route-preserves-match | PASS | 200 | 373 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=54 chars. |
| analyst-conversation-golden-path | PASS | 200 | 624 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=162 chars. |
| replacing-is-not-epl | PASS | 200 | 80 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 44378 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 51 of 75 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 51 of 75 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 51 of 75 observed identities routable). |
| observational-live-replacement | PASS | 200 | 219 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878758, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 51 of 75 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 103 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
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
| team-news-sourcing | PASS | 200 | 15455 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 12245 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=abstain, citations=0, answer=704 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 149 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=abstain, citations=0, answer=304 chars. |
| market-comparison-coverage | PASS | 200 | 104 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=162 chars. |
| competition-grounding | PASS | 200 | 85 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 331 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1246 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| season-certainty-follow-up | PASS | 200 | 2293 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 80 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 276 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 105 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 85 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 116 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 89 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 229 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=520 chars. |
| user-line-pass-play | PASS | 200 | 242 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=291 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 218 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=138 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 94 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| featured-totals-honesty | PASS | 200 | 103 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=150 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 204 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=268 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 121 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=2101 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 122 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=724 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 96 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=992 chars. |
| sse-ordering | PASS | 200 | 105 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 96 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 78 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 262 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1139 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| adversarial-grounding | PASS | 200 | 189 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878771, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2032 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=474 chars. |
| adversarial-malformed | PASS | 400 | 75 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **EXISTING ISSUE — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
2. **EXISTING ISSUE — dated-club-news-delivers-supported-update:** turn 1: verification failed verificationStatus; turn 1: verification failed positiveNewsVerification; turn 1: positive dated club news failed positiveNewsVerification; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated

## Recommendations

No code change recommended from this run.
