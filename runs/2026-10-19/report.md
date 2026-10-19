# Pundit Chat Battle Test — 2026-10-19T16:42:14.292Z

- Run: `2026-10-19T16-42-14-292Z`
- Deployment: `1a4a5bc3-94f6-4ec1-9bcb-ab17c37ff5e8` (api version)
- Source/API/Web SHAs: `cb28e649c772ac9d31d4a45fdbf2b88535779405` / `cb28e649c772ac9d31d4a45fdbf2b88535779405` / `8fb6a813f7c6efab8a8310d4058dfae8b8808be3`
- SHA convergence: PASS — api=cb28e649c772ac9d31d4a45fdbf2b88535779405 (match vs floor cb28e649c772ac9d31d4a45fdbf2b88535779405), web=8fb6a813f7c6efab8a8310d4058dfae8b8808be3 (match vs floor 8fb6a813f7c6efab8a8310d4058dfae8b8808be3)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.563272 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 55, post-run 14, delta -41, consecutive failures 1
- judge: skipped (unavailable) · skipped turns 24
- Agent judge: skipped (unavailable) · skipped turns 24

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | FAIL | 200 | 440 ms | turn 2: analyst expression failed directAnswerFirst |
| pinned-current-manager-and-result-evidence | FAIL | 200 | 31328 ms | turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| pinned-current-manager-everton-fixed | FAIL | 200 | 18601 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 1: match grounding failed groundingKind; turn 1: match grounding failed oneXTwoProbabilities; turn 1: match grounding failed totalsProbabilities; turn 1: match grounding failed totalsComplement; turn 1: match grounding failed bttsComplement; turn 1: match grounding failed scorelinesPresent; turn 1: match grounding failed oddsSourcesPresent; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification; turn 2: match grounding failed groundingKind; turn 2: match grounding failed oneXTwoProbabilities; turn 2: match grounding failed totalsProbabilities; turn 2: match grounding failed totalsComplement; turn 2: match grounding failed bttsComplement; turn 2: match grounding failed scorelinesPresent; turn 2: match grounding failed oddsSourcesPresent |
| owned-premier-league-latest-result | PASS | 200 | 86 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=219 chars. |
| dated-club-news-delivers-supported-update | FAIL | 502 | 15025 ms | HTTP 502: {"status":"error","code":502,"message":"Application failed to respond","request_id":"XJ7Ttfb1QOqYY4eUCYBc-A"} (retried once after Railway gateway 502) |
| active-match-grounding | PASS | 200 | 300 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=255 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 285 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=57 chars. |
| table-route-preserves-match | PASS | 200 | 301 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=57 chars. |
| analyst-conversation-golden-path | FAIL | 200 | 1420 ms | turn 6: analyst expression failed directAnswerFirst |
| replacing-is-not-epl | PASS | 200 | 308 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 6019 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 61 of 86 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 61 of 86 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 61 of 86 observed identities routable). |
| observational-live-replacement | PASS | 200 | 516 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878754, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 61 of 86 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 110 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=282 chars. |
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
| team-news-sourcing | PASS | 200 | 18688 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=verified, citations=1, answer=455 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 13835 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=abstain, citations=0, answer=460 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 670 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=abstain, citations=0, answer=307 chars. |
| market-comparison-coverage | PASS | 200 | 362 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=384 chars. |
| competition-grounding | PASS | 200 | 147 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 362 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1191 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=450 chars. |
| season-certainty-follow-up | PASS | 200 | 1954 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 82 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 238 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 302 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 118 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 79 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 89 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| featured-match-deictic-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| featured-match-fair-price-vs-market | PASS | 200 | 102 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=282 chars. |
| desk-cross-game-parlay-decline | PASS | 200 | 105 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=108 chars. |
| contextual-follow-up | PASS | 200 | 418 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=525 chars. |
| user-line-pass-play | PASS | 200 | 650 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=220 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 489 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=287 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 100 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=282 chars. |
| featured-totals-honesty | FAIL | 200 | 109 ms | turn 1: analyst expression failed directAnswerFirst |
| featured-o25-scoreline-follow-up | PASS | 200 | 233 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=238 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 99 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=2459 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 116 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=728 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 104 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=1349 chars. |
| sse-ordering | PASS | 200 | 81 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 96 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 76 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 183 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1120 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=239 chars. |
| adversarial-grounding | PASS | 200 | 244 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2341 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=479 chars. |
| adversarial-malformed | PASS | 400 | 78 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **FAIL — homepage-desk-output:** turn 2: analyst expression failed directAnswerFirst
2. **FAIL — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
3. **FAIL — pinned-current-manager-everton-fixed:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 1: match grounding failed groundingKind; turn 1: match grounding failed oneXTwoProbabilities; turn 1: match grounding failed totalsProbabilities; turn 1: match grounding failed totalsComplement; turn 1: match grounding failed bttsComplement; turn 1: match grounding failed scorelinesPresent; turn 1: match grounding failed oddsSourcesPresent; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification; turn 2: match grounding failed groundingKind; turn 2: match grounding failed oneXTwoProbabilities; turn 2: match grounding failed totalsProbabilities; turn 2: match grounding failed totalsComplement; turn 2: match grounding failed bttsComplement; turn 2: match grounding failed scorelinesPresent; turn 2: match grounding failed oddsSourcesPresent
4. **FAIL — dated-club-news-delivers-supported-update:** HTTP 502: {"status":"error","code":502,"message":"Application failed to respond","request_id":"XJ7Ttfb1QOqYY4eUCYBc-A"} (retried once after Railway gateway 502)
5. **FAIL — analyst-conversation-golden-path:** turn 6: analyst expression failed directAnswerFirst
6. **FAIL — featured-totals-honesty:** turn 1: analyst expression failed directAnswerFirst

## Recommendations

No code change recommended from this run.
