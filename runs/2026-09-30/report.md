# Pundit Chat Battle Test — 2026-09-30T10:33:26.765Z

- Run: `2026-09-30T10-33-26-765Z`
- Deployment: `0352e603-5ccc-460d-9d0c-af21e7db2f7e` (api version)
- Source/API/Web SHAs: `fdb0cf902f42ebe223ec578bc6b21b840eb2ab58` / `fdb0cf902f42ebe223ec578bc6b21b840eb2ab58` / `f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f`
- SHA convergence: PASS — api=fdb0cf902f42ebe223ec578bc6b21b840eb2ab58 (match vs floor fdb0cf902f42ebe223ec578bc6b21b840eb2ab58), web=f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f (match vs floor f7b503d550d44bd5ac9ca21c123dfdd1c0da2c7f)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract and deployment
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13025.276537000027 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 33, post-run 3, delta -30, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| active-match-grounding | PASS | 200 | 166 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 545 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| table-route-preserves-match | PASS | 200 | 708 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| analyst-conversation-golden-path | PASS | 200 | 1485 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=157 chars. |
| replacing-is-not-epl | PASS | 200 | 235 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 6071 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 50 of 82 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 50 of 82 observed identities routable). |
| observational-live-replacement | PASS | 200 | 728 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879256, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 50 of 82 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 258 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
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
| team-news-sourcing | PASS | 200 | 17002 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 29997 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=verified, citations=1, answer=572 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 415 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=302 chars. |
| market-comparison-coverage | PASS | 200 | 249 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=157 chars. |
| competition-grounding | PASS | 200 | 226 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=458 chars. |
| competition-follow-up | PASS | 200 | 7215 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=371 chars. |
| season-certainty-follow-up | PASS | 200 | 13882 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=323 chars. |
| general-analysis-label | PASS | 200 | 213 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| contextual-follow-up | PASS | 200 | 478 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=519 chars. |
| user-line-pass-play | PASS | 200 | 482 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=290 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 481 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=135 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 241 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| featured-totals-honesty | PASS | 200 | 233 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=174 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 534 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=292 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 261 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1021 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 60249 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=363 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 146 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1021 chars. |
| sse-ordering | PASS | 200 | 237 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 234 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 220 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 475 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 7214 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=239 chars. |
| adversarial-grounding | PASS | 200 | 483 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 13660 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=334 chars. |
| adversarial-malformed | PASS | 400 | 240 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

Nothing material changed; no user-impacting API regression was detected.

## Recommendations

No code change recommended from this run.
