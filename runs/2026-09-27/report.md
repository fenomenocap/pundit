# Pundit Chat Battle Test — 2026-09-27T18:48:52.139Z

- Run: `2026-09-27T18-48-52-139Z`
- Deployment: `853f51eb-88a3-4cf8-9d3b-e6fa7cd8c646` (api version)
- Source/API/Web SHAs: `f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f` / `ef5b37bdcdc823ad4dab81cf2f698702c50a0bcd` / `c941a9b28de7649e20b81f66c50ff58856390fef`
- SHA convergence: FAIL — api=ef5b37bdcdc823ad4dab81cf2f698702c50a0bcd (stale vs floor f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f), web=c941a9b28de7649e20b81f66c50ff58856390fef (stale vs floor f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (c84e6c23-979c-4292-9242-456942ddadb6 → 853f51eb-88a3-4cf8-9d3b-e6fa7cd8c646)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.255887000065 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 12, delta 12, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| active-match-grounding | PASS | 200 | 128 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 335 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| table-route-preserves-match | REGRESSION | 502 | 15074 ms | HTTP 502: {"status":"error","code":502,"message":"Application failed to respond","request_id":"2WU60aRtQ66k8lKHnpoFkQ"} |
| analyst-conversation-golden-path | PASS | 200 | 645 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=163 chars. |
| replacing-is-not-epl | PASS | 200 | 79 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 4352 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 50 of 91 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 50 of 91 observed identities routable). |
| observational-live-replacement | PASS | 200 | 182 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879253, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 50 of 91 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 84 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
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
| team-news-sourcing | PASS | 200 | 13509 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 11879 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=240 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 158 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=302 chars. |
| market-comparison-coverage | PASS | 200 | 82 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=163 chars. |
| competition-grounding | PASS | 200 | 56 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=458 chars. |
| competition-follow-up | PASS | 200 | 6556 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=371 chars. |
| season-certainty-follow-up | PASS | 200 | 13278 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=323 chars. |
| general-analysis-label | PASS | 200 | 61 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| contextual-follow-up | PASS | 200 | 161 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=519 chars. |
| user-line-pass-play | PASS | 200 | 169 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=290 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 168 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=135 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 93 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| featured-totals-honesty | PASS | 200 | 86 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=174 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 181 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=292 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 89 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1027 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 12752 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=363 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 56 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1027 chars. |
| sse-ordering | PASS | 200 | 63 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 67 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 86 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 122 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 6769 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=371 chars. |
| adversarial-grounding | PASS | 200 | 177 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 13003 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=333 chars. |
| adversarial-malformed | PASS | 400 | 62 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **REGRESSION — table-route-preserves-match:** HTTP 502: {"status":"error","code":502,"message":"Application failed to respond","request_id":"2WU60aRtQ66k8lKHnpoFkQ"}

## Recommendations

No code change recommended from this run.
