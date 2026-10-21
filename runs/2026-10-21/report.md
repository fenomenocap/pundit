# Pundit Chat Battle Test — 2026-10-21T05:04:40.278Z

- **Live betting-maths (excl. offline helpers): pass 14, inconclusive 0, fail 6 (20 scenarios)**
- By category (pass / inconclusive / fail): betting-maths 22/0/6, context 24/0/2, infra 18/5/0

- Run: `2026-10-21T05-04-40-278Z`
- Deployment: `939adead-6e2a-44ee-bb1e-09c40b96e2b7` (api version)
- Source/API/Web SHAs: `a8421772e65ade1c9a95edd1ab74e163d29c1f52` / `a8421772e65ade1c9a95edd1ab74e163d29c1f52` / `a8421772e65ade1c9a95edd1ab74e163d29c1f52`
- SHA convergence: PASS — api=a8421772e65ade1c9a95edd1ab74e163d29c1f52 (ahead vs floor 5cb4006733a3e37a3f0defd9fe3b3f0bd01dee8d), web=a8421772e65ade1c9a95edd1ab74e163d29c1f52 (match vs floor a8421772e65ade1c9a95edd1ab74e163d29c1f52)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.247667000003 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 31, delta 31, consecutive failures 1
- judge: skipped (unavailable) · skipped turns 24
- Agent judge: skipped (unavailable) · skipped turns 24

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 2385 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=652 chars. |
| pinned-current-manager-and-result-evidence | FAIL | 200 | 29908 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| pinned-current-manager-everton-fixed | FAIL | 200 | 17153 ms | turn 1: match grounding failed groundingKind; turn 1: match grounding failed oneXTwoProbabilities; turn 1: match grounding failed totalsProbabilities; turn 1: match grounding failed totalsComplement; turn 1: match grounding failed bttsComplement; turn 1: match grounding failed scorelinesPresent; turn 1: match grounding failed oddsSourcesPresent; turn 2: match grounding failed groundingKind; turn 2: match grounding failed oneXTwoProbabilities; turn 2: match grounding failed totalsProbabilities; turn 2: match grounding failed totalsComplement; turn 2: match grounding failed bttsComplement; turn 2: match grounding failed scorelinesPresent; turn 2: match grounding failed oddsSourcesPresent |
| owned-premier-league-latest-result | PASS | 200 | 167 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=219 chars. |
| dated-club-news-delivers-supported-update | PASS | 200 | 13367 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=verified, citations=2, answer=620 chars. |
| active-match-grounding | PASS | 200 | 87 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 1595 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=942 chars. |
| table-route-preserves-match | PASS | 200 | 2136 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=882 chars. |
| analyst-conversation-golden-path | FAIL | 200 | 2973 ms | turn 1: response correctness failed comparableMarketAttribution; turn 6: analyst expression failed narrowFollowup |
| replacing-is-not-epl | PASS | 200 | 186 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 10073 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 67 of 88 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 67 of 88 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 67 of 88 observed identities routable). |
| observational-live-replacement | PASS | 200 | 382 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878754, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 67 of 88 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 185 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
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
| team-news-sourcing | PASS | 200 | 12042 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=verified, citations=1, answer=408 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 9863 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=abstain, citations=0, answer=447 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 257 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=abstain, citations=0, answer=303 chars. |
| market-comparison-coverage | PASS | 200 | 1939 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=773 chars. |
| competition-grounding | PASS | 200 | 189 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 764 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1268 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| season-certainty-follow-up | PASS | 200 | 2240 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 164 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 500 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 169 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 163 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 188 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 166 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| featured-match-deictic-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| featured-match-fair-price-vs-market | PASS | 200 | 242 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| desk-cross-game-parlay-decline | PASS | 200 | 188 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=104 chars. |
| contextual-follow-up | PASS | 200 | 4004 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=520 chars. |
| user-line-pass-play | FAIL | 200 | 442 ms | turn 2: analyst expression failed userLineHonestGapPresent; turn 2: analyst expression failed userLineFairDecimal |
| stake-refusal-without-bankroll | FAIL | 200 | 416 ms | turn 2: analyst expression failed stakeRefusalSentence |
| featured-fixture-opens-pricing-desk | PASS | 200 | 190 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| featured-totals-honesty | FAIL | 200 | 2541 ms | turn 1: analyst expression failed totalsAssumptionMatchesDistribution |
| featured-o25-scoreline-follow-up | FAIL | 200 | 2896 ms | turn 2: analyst expression failed totalsAssumptionMatchesDistribution |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 199 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=2121 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 198 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=720 chars. |
| featured-explicit-preview-stays-long-read | FAIL | 200 | 185 ms | turn 1: response correctness failed comparableMarketAttribution |
| sse-ordering | PASS | 200 | 165 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 170 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 161 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 355 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1223 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| adversarial-grounding | PASS | 200 | 402 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2252 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=474 chars. |
| adversarial-malformed | PASS | 400 | 207 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **FAIL — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
2. **FAIL — pinned-current-manager-everton-fixed:** turn 1: match grounding failed groundingKind; turn 1: match grounding failed oneXTwoProbabilities; turn 1: match grounding failed totalsProbabilities; turn 1: match grounding failed totalsComplement; turn 1: match grounding failed bttsComplement; turn 1: match grounding failed scorelinesPresent; turn 1: match grounding failed oddsSourcesPresent; turn 2: match grounding failed groundingKind; turn 2: match grounding failed oneXTwoProbabilities; turn 2: match grounding failed totalsProbabilities; turn 2: match grounding failed totalsComplement; turn 2: match grounding failed bttsComplement; turn 2: match grounding failed scorelinesPresent; turn 2: match grounding failed oddsSourcesPresent
3. **FAIL — analyst-conversation-golden-path:** turn 1: response correctness failed comparableMarketAttribution; turn 6: analyst expression failed narrowFollowup
4. **FAIL — user-line-pass-play:** turn 2: analyst expression failed userLineHonestGapPresent; turn 2: analyst expression failed userLineFairDecimal
5. **FAIL — stake-refusal-without-bankroll:** turn 2: analyst expression failed stakeRefusalSentence
6. **FAIL — featured-totals-honesty:** turn 1: analyst expression failed totalsAssumptionMatchesDistribution
7. **FAIL — featured-o25-scoreline-follow-up:** turn 2: analyst expression failed totalsAssumptionMatchesDistribution
8. **FAIL — featured-explicit-preview-stays-long-read:** turn 1: response correctness failed comparableMarketAttribution

## Recommendations

No code change recommended from this run.
