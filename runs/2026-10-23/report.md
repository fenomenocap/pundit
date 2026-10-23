# Pundit Chat Battle Test — 2026-10-23T13:38:26.118Z

- **Live betting-maths (excl. offline helpers): pass 20, inconclusive 0, fail 0 (20 scenarios)**
- By category (pass / inconclusive / fail): betting-maths 28/0/0, context 24/0/2, infra 18/5/0

- Run: `2026-10-23T13-38-26-118Z`
- Deployment: `unknown` (unavailable)
- Source/API/Web SHAs: `7eeee30502485f94f3398774a27bc5b53962ba88` / `7eeee30502485f94f3398774a27bc5b53962ba88` / `7eeee30502485f94f3398774a27bc5b53962ba88`
- SHA convergence: PASS — api=7eeee30502485f94f3398774a27bc5b53962ba88 (match vs floor 7eeee30502485f94f3398774a27bc5b53962ba88), web=7eeee30502485f94f3398774a27bc5b53962ba88 (ahead vs floor b8518df4d1ee34a38a5e502ee119e0b09d8cf0c6)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13025.110849000048 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 34, delta 34, consecutive failures 1
- judge: skipped (unavailable) · skipped turns 24
- Agent judge: skipped (unavailable) · skipped turns 24

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 3348 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=736 chars. |
| pinned-current-manager-and-result-evidence | FAIL | 200 | 46416 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification; turn 3: response correctness failed latestResultCitedScore |
| pinned-current-manager-everton-fixed | FAIL | 200 | 50108 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| owned-premier-league-latest-result | PASS | 200 | 122 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=226 chars. |
| dated-club-news-delivers-supported-update | PASS | 200 | 24099 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=verified, citations=1, answer=978 chars. |
| active-match-grounding | PASS | 200 | 128 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 1901 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=933 chars. |
| table-route-preserves-match | PASS | 200 | 2130 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=904 chars. |
| analyst-conversation-golden-path | PASS | 200 | 1810 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=708 chars. |
| replacing-is-not-epl | PASS | 200 | 198 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 5497 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 70 of 81 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 70 of 81 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 70 of 81 observed identities routable). |
| observational-live-replacement | PASS | 200 | 601 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878754, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 70 of 81 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 341 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
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
| team-news-sourcing | PASS | 200 | 17830 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=verified, citations=1, answer=1012 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 9798 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=abstain, citations=0, answer=452 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 578 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=abstain, citations=0, answer=315 chars. |
| market-comparison-coverage | PASS | 200 | 1934 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=944 chars. |
| competition-grounding | PASS | 200 | 143 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=477 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 863 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 7130 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=447 chars. |
| season-certainty-follow-up | PASS | 200 | 8150 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=472 chars. |
| general-analysis-label | PASS | 200 | 211 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 1631 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 288 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 231 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 1274 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 300 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| featured-match-deictic-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| featured-match-fair-price-vs-market | PASS | 200 | 551 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
| desk-cross-game-parlay-decline | PASS | 200 | 399 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=116 chars. |
| contextual-follow-up | PASS | 200 | 3089 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=532 chars. |
| user-line-pass-play | PASS | 200 | 737 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=691 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 591 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=638 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 268 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=172 chars. |
| featured-totals-honesty | PASS | 200 | 1582 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=858 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 725 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=230 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 411 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=2305 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 250 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=763 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 261 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=1168 chars. |
| sse-ordering | PASS | 200 | 153 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 239 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 647 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 357 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 5956 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=199 chars. |
| adversarial-grounding | PASS | 200 | 610 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 10526 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=495 chars. |
| adversarial-malformed | PASS | 400 | 257 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **FAIL — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification; turn 3: response correctness failed latestResultCitedScore
2. **FAIL — pinned-current-manager-everton-fixed:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification

## Recommendations

No code change recommended from this run.
