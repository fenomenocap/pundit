# Pundit Chat Battle Test — 2026-10-18T13:09:24.134Z

- Run: `2026-10-18T13-09-24-134Z`
- Deployment: `c94475dd-80a7-477b-9030-a7f728eae54f` (api version)
- Source/API/Web SHAs: `dd17ba5511732049f2109914e6d267ab14a5780e` / `dd17ba5511732049f2109914e6d267ab14a5780e` / `34fa0b42557039a3bba0b70f4c8464243d6faa29`
- SHA convergence: PASS — api=dd17ba5511732049f2109914e6d267ab14a5780e (match vs floor dd17ba5511732049f2109914e6d267ab14a5780e), web=34fa0b42557039a3bba0b70f4c8464243d6faa29 (ahead vs floor 776fc1acd928f25289133b6fd6a3056c4f0c0fc7)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.85708700004 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 27, delta 27, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 741 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=344 chars. |
| pinned-current-manager-and-result-evidence | PASS | 200 | 41532 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=447 chars. |
| owned-premier-league-latest-result | PASS | 200 | 100 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=218 chars. |
| dated-club-news-delivers-supported-update | PASS | 200 | 19418 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=verified, citations=1, answer=462 chars. |
| active-match-grounding | PASS | 200 | 130 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 462 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=52 chars. |
| table-route-preserves-match | PASS | 200 | 604 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=52 chars. |
| analyst-conversation-golden-path | PASS | 200 | 1041 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=167 chars. |
| replacing-is-not-epl | PASS | 200 | 159 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 7822 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 65 of 91 observed identities routable). |
| observational-live-in-play | PASS | 200 | 19749 ms | 2 turn(s), grounding=fixture, fixture=espn:eng.1:401879260, capability=outside-coverage, verification=not-required, citations=0, answer=131 chars. |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 65 of 91 observed identities routable). |
| observational-live-replacement | PASS | 200 | 342 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879261, capability=outside-coverage, verification=not-required, citations=0, answer=131 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 65 of 91 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 120 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
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
| team-news-sourcing | PASS | 200 | 54534 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 14024 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=abstain, citations=0, answer=428 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 420 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=abstain, citations=0, answer=303 chars. |
| market-comparison-coverage | PASS | 200 | 411 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=167 chars. |
| competition-grounding | PASS | 200 | 165 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 448 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1232 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=450 chars. |
| season-certainty-follow-up | PASS | 200 | 2489 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 143 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 323 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 302 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 135 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 138 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 114 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 641 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=520 chars. |
| user-line-pass-play | PASS | 200 | 337 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=307 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 425 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=136 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 157 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| featured-totals-honesty | PASS | 200 | 313 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=150 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 277 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=268 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 302 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=2101 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 166 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=721 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 116 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=994 chars. |
| sse-ordering | PASS | 200 | 109 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 141 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 107 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 209 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1140 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=239 chars. |
| adversarial-grounding | PASS | 200 | 435 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878769, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2108 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=474 chars. |
| adversarial-malformed | PASS | 400 | 106 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

Nothing material changed; no user-impacting API regression was detected.

## Recommendations

No code change recommended from this run.
