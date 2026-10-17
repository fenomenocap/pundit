# Pundit Chat Battle Test — 2026-10-17T18:52:42.545Z

- Run: `2026-10-17T18-52-42-545Z`
- Deployment: `61c74b69-80c8-4ed6-aa91-c4185a017bc9` (api version)
- Source/API/Web SHAs: `bd5f335f9915e2bc72aa2617749f45fea2a487e8` / `bd5f335f9915e2bc72aa2617749f45fea2a487e8` / `776fc1acd928f25289133b6fd6a3056c4f0c0fc7`
- SHA convergence: PASS — api=bd5f335f9915e2bc72aa2617749f45fea2a487e8 (match vs floor bd5f335f9915e2bc72aa2617749f45fea2a487e8), web=776fc1acd928f25289133b6fd6a3056c4f0c0fc7 (match vs floor 776fc1acd928f25289133b6fd6a3056c4f0c0fc7)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.664844000014 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 25, delta 25, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 441 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=344 chars. |
| pinned-current-manager-and-result-evidence | PASS | 200 | 47810 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=443 chars. |
| owned-premier-league-latest-result | PASS | 200 | 84 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=218 chars. |
| dated-club-news-delivers-supported-update | PASS | 200 | 18827 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=verified, citations=1, answer=885 chars. |
| active-match-grounding | PASS | 200 | 64 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=168 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 248 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=61 chars. |
| table-route-preserves-match | PASS | 200 | 328 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=61 chars. |
| analyst-conversation-golden-path | PASS | 200 | 652 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
| replacing-is-not-epl | PASS | 200 | 86 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 7130 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 55 of 81 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 55 of 81 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 55 of 81 observed identities routable). |
| observational-live-replacement | PASS | 200 | 245 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879239, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 55 of 81 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 110 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=168 chars. |
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
| team-news-sourcing | PASS | 200 | 55170 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=verified, citations=1, answer=936 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 8052 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=abstain, citations=0, answer=433 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 210 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=abstain, citations=0, answer=311 chars. |
| market-comparison-coverage | PASS | 200 | 98 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
| competition-grounding | PASS | 200 | 80 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 345 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1460 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=450 chars. |
| season-certainty-follow-up | PASS | 200 | 2197 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 88 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 253 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 80 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 81 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 88 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 155 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 279 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=529 chars. |
| user-line-pass-play | PASS | 200 | 240 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=310 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 207 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=145 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 104 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=168 chars. |
| featured-totals-honesty | PASS | 200 | 122 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=150 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 221 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=268 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 99 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=2156 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 98 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=742 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 100 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=1036 chars. |
| sse-ordering | PASS | 200 | 105 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 85 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 94 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 179 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1146 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=239 chars. |
| adversarial-grounding | PASS | 200 | 217 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879263, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2133 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=474 chars. |
| adversarial-malformed | PASS | 400 | 79 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

Nothing material changed; no user-impacting API regression was detected.

## Recommendations

No code change recommended from this run.
