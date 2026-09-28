# Pundit Chat Battle Test — 2026-09-28T11:01:07.585Z

- Run: `2026-09-28T11-01-07-585Z`
- Deployment: `f342f0f3-45da-47e2-90ee-89eb8f2b6038` (api version)
- Source/API/Web SHAs: `a1f4d212fde45a22034d02ee4b803648cd826dd1` / `a1f4d212fde45a22034d02ee4b803648cd826dd1` / `f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f`
- SHA convergence: PASS — api=a1f4d212fde45a22034d02ee4b803648cd826dd1 (match vs floor a1f4d212fde45a22034d02ee4b803648cd826dd1), web=f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f (match vs floor f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (853f51eb-88a3-4cf8-9d3b-e6fa7cd8c646 → f342f0f3-45da-47e2-90ee-89eb8f2b6038)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13023.789010000008 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 12, delta 12, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| active-match-grounding | PASS | 200 | 86 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 207 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| table-route-preserves-match | INTERMITTENT | 200 | 282 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| analyst-conversation-golden-path | PASS | 200 | 519 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=167 chars. |
| replacing-is-not-epl | PASS | 200 | 59 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 8993 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 50 of 90 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 50 of 90 observed identities routable). |
| observational-live-replacement | PASS | 200 | 222 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879253, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 50 of 90 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 107 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
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
| team-news-sourcing | PASS | 200 | 18192 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 37035 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=240 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 147 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=302 chars. |
| market-comparison-coverage | PASS | 200 | 90 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=167 chars. |
| competition-grounding | PASS | 200 | 65 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=458 chars. |
| competition-follow-up | PASS | 200 | 6770 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=371 chars. |
| season-certainty-follow-up | PASS | 200 | 13268 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=323 chars. |
| general-analysis-label | PASS | 200 | 68 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| contextual-follow-up | PASS | 200 | 290 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=519 chars. |
| user-line-pass-play | PASS | 200 | 169 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=290 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 186 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=135 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 93 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| featured-totals-honesty | PASS | 200 | 83 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=174 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 186 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=292 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 85 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1031 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 7865 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=363 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 83 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1031 chars. |
| sse-ordering | PASS | 200 | 66 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 2326 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 61 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 124 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 6923 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=239 chars. |
| adversarial-grounding | PASS | 200 | 186 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 12943 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=333 chars. |
| adversarial-malformed | PASS | 400 | 63 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **INTERMITTENT — table-route-preserves-match:** 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars.

## Recommendations

No code change recommended from this run.
