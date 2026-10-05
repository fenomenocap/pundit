# Pundit Chat Battle Test — 2026-10-05T11:36:50.168Z

- Run: `2026-10-05T11-36-50-168Z`
- Deployment: `c7815753-a30b-4fc0-ad1b-3f78bb09386c` (api version)
- Source/API/Web SHAs: `5c993dd2b7823a3c364c14fd7aad1bc4651f0fe0` / `5c993dd2b7823a3c364c14fd7aad1bc4651f0fe0` / `a10285d5c156adf2f0f8e59ff85a3f96d53961c5`
- SHA convergence: PASS — api=5c993dd2b7823a3c364c14fd7aad1bc4651f0fe0 (match vs floor 5c993dd2b7823a3c364c14fd7aad1bc4651f0fe0), web=a10285d5c156adf2f0f8e59ff85a3f96d53961c5 (match vs floor a10285d5c156adf2f0f8e59ff85a3f96d53961c5)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (5298aaf5-c132-481a-ade8-887b27d41c2a → c7815753-a30b-4fc0-ad1b-3f78bb09386c)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13025.092648999998 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 34, post-run 53, delta 19, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 267 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=368 chars. |
| pinned-current-manager-and-result-evidence | FAIL | 200 | 56473 ms | turn 2: verification failed verificationStatus |
| active-match-grounding | PASS | 200 | 109 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 287 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| table-route-preserves-match | PASS | 200 | 414 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| analyst-conversation-golden-path | PASS | 200 | 755 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=167 chars. |
| replacing-is-not-epl | PASS | 200 | 119 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 2711 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 50 of 80 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 50 of 80 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 50 of 80 observed identities routable). |
| observational-live-replacement | PASS | 200 | 332 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878763, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 50 of 80 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 117 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
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
| team-news-sourcing | PASS | 200 | 6164 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=verified, citations=1, answer=408 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 7690 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=240 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 284 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=302 chars. |
| market-comparison-coverage | PASS | 200 | 136 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=167 chars. |
| competition-grounding | PASS | 200 | 99 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=458 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 452 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 6791 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=368 chars. |
| season-certainty-follow-up | PASS | 200 | 13670 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 102 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 310 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 106 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 100 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 104 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 104 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 251 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=519 chars. |
| user-line-pass-play | PASS | 200 | 246 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=290 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 267 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=135 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 125 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| featured-totals-honesty | PASS | 200 | 141 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=174 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 240 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=292 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 119 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=2111 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 122 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=711 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 119 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1013 chars. |
| sse-ordering | PASS | 200 | 144 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 105 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 103 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 1026 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 6761 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=239 chars. |
| adversarial-grounding | PASS | 200 | 246 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 13177 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=475 chars. |
| adversarial-malformed | PASS | 400 | 99 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **FAIL — pinned-current-manager-and-result-evidence:** turn 2: verification failed verificationStatus

## Recommendations

No code change recommended from this run.
