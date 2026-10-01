# Pundit Chat Battle Test — 2026-10-01T11:01:09.224Z

- Run: `2026-10-01T11-01-09-224Z`
- Deployment: `5298aaf5-c132-481a-ade8-887b27d41c2a` (api version)
- Source/API/Web SHAs: `f6e4c03a5da886104b0c930f75b4c08ab57819ba` / `f6e4c03a5da886104b0c930f75b4c08ab57819ba` / `0f0b00456c4a11bb9488666e46a4b40f99ea3908`
- SHA convergence: PASS — api=f6e4c03a5da886104b0c930f75b4c08ab57819ba (match vs floor f6e4c03a5da886104b0c930f75b4c08ab57819ba), web=0f0b00456c4a11bb9488666e46a4b40f99ea3908 (match vs floor 0f0b00456c4a11bb9488666e46a4b40f99ea3908)
- Evaluation schema: `17`
- Previous comparison: same evaluation contract across deployments (0352e603-5ccc-460d-9d0c-af21e7db2f7e → 5298aaf5-c132-481a-ade8-887b27d41c2a)
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.858799000009 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 12, delta 12, consecutive failures 1

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| active-match-grounding | PASS | 200 | 139 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 347 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| table-route-preserves-match | PASS | 200 | 383 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=51 chars. |
| analyst-conversation-golden-path | PASS | 200 | 815 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=157 chars. |
| replacing-is-not-epl | PASS | 200 | 121 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 5506 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 50 of 81 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 50 of 81 observed identities routable). |
| observational-live-replacement | PASS | 200 | 349 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879256, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 50 of 81 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 123 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
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
| team-news-sourcing | PASS | 200 | 8664 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 16722 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=verified, citations=1, answer=572 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 231 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=abstain, citations=0, answer=302 chars. |
| market-comparison-coverage | PASS | 200 | 132 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=157 chars. |
| competition-grounding | PASS | 200 | 101 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=458 chars. |
| competition-follow-up | PASS | 200 | 6717 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=371 chars. |
| season-certainty-follow-up | PASS | 200 | 13657 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=323 chars. |
| general-analysis-label | PASS | 200 | 104 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| contextual-follow-up | PASS | 200 | 241 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=519 chars. |
| user-line-pass-play | PASS | 200 | 254 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=290 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 246 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=135 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 124 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=159 chars. |
| featured-totals-honesty | PASS | 200 | 118 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=174 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 250 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=292 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 144 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1021 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 8064 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=363 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 118 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=1021 chars. |
| sse-ordering | PASS | 200 | 103 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 108 ms | Grounding received, then client AbortError observed after 1ms. |
| malformed-history | PASS | 400 | 94 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 199 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 6818 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=371 chars. |
| adversarial-grounding | PASS | 200 | 244 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879268, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 13253 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=334 chars. |
| adversarial-malformed | PASS | 400 | 132 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

Nothing material changed; no user-impacting API regression was detected.

## Recommendations

No code change recommended from this run.
