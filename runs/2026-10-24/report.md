# Pundit Chat Battle Test — 2026-10-24T12:48:26.964Z

- **Live betting-maths (excl. offline helpers): pass 20, inconclusive 0, fail 0 (20 scenarios)**
- By category (pass / inconclusive / fail): betting-maths 28/0/0, context 23/0/3, infra 19/4/0

- Run: `2026-10-24T12-48-26-964Z`
- Deployment: `unknown` (unavailable)
- Source/API/Web SHAs: `7eeee30502485f94f3398774a27bc5b53962ba88` / `7eeee30502485f94f3398774a27bc5b53962ba88` / `7eeee30502485f94f3398774a27bc5b53962ba88`
- SHA convergence: PASS — api=7eeee30502485f94f3398774a27bc5b53962ba88 (match vs floor 7eeee30502485f94f3398774a27bc5b53962ba88), web=7eeee30502485f94f3398774a27bc5b53962ba88 (ahead vs floor b8518df4d1ee34a38a5e502ee119e0b09d8cf0c6)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13025.652970999945 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 61, post-run 99, delta 38, consecutive failures 1
- judge: skipped (unavailable) · skipped turns 24
- Agent judge: skipped (unavailable) · skipped turns 24

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 4009 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=697 chars. |
| pinned-current-manager-and-result-evidence | FAIL | 200 | 56436 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| pinned-current-manager-everton-fixed | FAIL | 200 | 41366 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| owned-premier-league-latest-result | PASS | 200 | 121 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=226 chars. |
| dated-club-news-delivers-supported-update | FAIL | 200 | 14426 ms | turn 1: verification failed verificationStatus; turn 1: verification failed positiveNewsVerification; turn 1: positive dated club news failed positiveNewsVerification; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated |
| active-match-grounding | PASS | 200 | 112 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 2363 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=837 chars. |
| table-route-preserves-match | PASS | 200 | 3101 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=845 chars. |
| analyst-conversation-golden-path | PASS | 200 | 2392 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=680 chars. |
| replacing-is-not-epl | PASS | 200 | 393 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 6203 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 69 of 81 observed identities routable). |
| observational-live-in-play | PASS | 200 | 15296 ms | 2 turn(s), grounding=fixture, fixture=espn:eng.1:401879256, capability=outside-coverage, verification=not-required, citations=0, answer=131 chars. |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 69 of 81 observed identities routable). |
| observational-live-replacement | PASS | 200 | 1748 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401879233, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 69 of 81 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 236 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
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
| team-news-sourcing | PASS | 200 | 10472 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=abstain, citations=0, answer=112 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 10725 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=abstain, citations=0, answer=432 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 760 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=abstain, citations=0, answer=304 chars. |
| market-comparison-coverage | PASS | 200 | 1902 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=846 chars. |
| competition-grounding | PASS | 200 | 302 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=477 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 3893 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 4204 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=457 chars. |
| season-certainty-follow-up | PASS | 200 | 8175 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=472 chars. |
| general-analysis-label | PASS | 200 | 279 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 2006 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 827 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 194 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 1161 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 259 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| featured-match-deictic-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| featured-match-fair-price-vs-market | PASS | 200 | 247 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| desk-cross-game-parlay-decline | PASS | 200 | 178 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=105 chars. |
| contextual-follow-up | PASS | 200 | 3506 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=521 chars. |
| user-line-pass-play | PASS | 200 | 975 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=632 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 635 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=605 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 202 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=161 chars. |
| featured-totals-honesty | PASS | 200 | 1568 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=683 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 487 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=260 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 418 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=2224 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 233 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=717 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 284 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=1122 chars. |
| sse-ordering | PASS | 200 | 1348 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 414 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 247 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 386 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 4454 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=199 chars. |
| adversarial-grounding | PASS | 200 | 666 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401878768, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 11919 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=494 chars. |
| adversarial-malformed | PASS | 400 | 159 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **FAIL — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
2. **FAIL — pinned-current-manager-everton-fixed:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
3. **FAIL — dated-club-news-delivers-supported-update:** turn 1: verification failed verificationStatus; turn 1: verification failed positiveNewsVerification; turn 1: positive dated club news failed positiveNewsVerification; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated

## Recommendations

No code change recommended from this run.
