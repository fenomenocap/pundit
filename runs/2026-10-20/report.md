# Pundit Chat Battle Test — 2026-10-20T13:42:18.450Z

- **Live betting-maths (excl. offline helpers): pass 20, inconclusive 0, fail 0 (20 scenarios)**
- By category (pass / inconclusive / fail): betting-maths 28/0/0, context 24/0/2, infra 18/5/0

- Run: `2026-10-20T13-42-18-450Z`
- Deployment: `b5c6137f-ff8f-4e67-aa7f-bd6aaabc9d65` (api version)
- Source/API/Web SHAs: `1de0014efdeae3c8b3a2dbeba5f774ec0ad635fc` / `1de0014efdeae3c8b3a2dbeba5f774ec0ad635fc` / `c8e6eb4f4498aea9870838851a4dbff27d3e4839`
- SHA convergence: FAIL — api=1de0014efdeae3c8b3a2dbeba5f774ec0ad635fc (match vs floor 1de0014efdeae3c8b3a2dbeba5f774ec0ad635fc), web=c8e6eb4f4498aea9870838851a4dbff27d3e4839 (stale vs floor 1de0014efdeae3c8b3a2dbeba5f774ec0ad635fc)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.795664000005 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 3, delta 3, consecutive failures 1
- judge: skipped (unavailable) · skipped turns 24
- Agent judge: skipped (unavailable) · skipped turns 24

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 4886 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=701 chars. |
| pinned-current-manager-and-result-evidence | FAIL | 200 | 30484 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| pinned-current-manager-everton-fixed | FAIL | 200 | 24228 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 1: match grounding failed groundingKind; turn 1: match grounding failed oneXTwoProbabilities; turn 1: match grounding failed totalsProbabilities; turn 1: match grounding failed totalsComplement; turn 1: match grounding failed bttsComplement; turn 1: match grounding failed scorelinesPresent; turn 1: match grounding failed oddsSourcesPresent; turn 2: match grounding failed groundingKind; turn 2: match grounding failed oneXTwoProbabilities; turn 2: match grounding failed totalsProbabilities; turn 2: match grounding failed totalsComplement; turn 2: match grounding failed bttsComplement; turn 2: match grounding failed scorelinesPresent; turn 2: match grounding failed oddsSourcesPresent |
| owned-premier-league-latest-result | PASS | 200 | 85 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=219 chars. |
| dated-club-news-delivers-supported-update | PASS | 200 | 22377 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=verified, citations=1, answer=391 chars. |
| active-match-grounding | PASS | 200 | 144 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 4888 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=907 chars. |
| table-route-preserves-match | PASS | 200 | 4150 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=628 chars. |
| analyst-conversation-golden-path | PASS | 200 | 3584 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=862 chars. |
| replacing-is-not-epl | PASS | 200 | 106 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 7736 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 60 of 82 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 60 of 82 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 60 of 82 observed identities routable). |
| observational-live-replacement | PASS | 200 | 549 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878754, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 60 of 82 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 234 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
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
| team-news-sourcing | PASS | 200 | 20812 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=verified, citations=1, answer=408 chars. |
| table-detour-then-scorer-retention | PASS | 200 | 13932 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=abstain, citations=0, answer=447 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 687 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=abstain, citations=0, answer=303 chars. |
| market-comparison-coverage | PASS | 200 | 193 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=339 chars. |
| competition-grounding | PASS | 200 | 110 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 752 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1333 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| season-certainty-follow-up | PASS | 200 | 2073 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 112 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 348 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 102 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 123 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 140 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 123 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| featured-match-deictic-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| featured-match-fair-price-vs-market | PASS | 200 | 130 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| desk-cross-game-parlay-decline | PASS | 200 | 112 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=104 chars. |
| contextual-follow-up | PASS | 200 | 259 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=520 chars. |
| user-line-pass-play | PASS | 200 | 254 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=216 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 248 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=283 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 120 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=160 chars. |
| featured-totals-honesty | PASS | 200 | 194 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=406 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 249 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=238 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 199 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=2271 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 138 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=720 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 116 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=1165 chars. |
| sse-ordering | PASS | 200 | 101 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 117 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 97 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 485 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1268 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=440 chars. |
| adversarial-grounding | PASS | 200 | 245 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879253, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2234 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=474 chars. |
| adversarial-malformed | PASS | 400 | 105 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **FAIL — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
2. **FAIL — pinned-current-manager-everton-fixed:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 1: match grounding failed groundingKind; turn 1: match grounding failed oneXTwoProbabilities; turn 1: match grounding failed totalsProbabilities; turn 1: match grounding failed totalsComplement; turn 1: match grounding failed bttsComplement; turn 1: match grounding failed scorelinesPresent; turn 1: match grounding failed oddsSourcesPresent; turn 2: match grounding failed groundingKind; turn 2: match grounding failed oneXTwoProbabilities; turn 2: match grounding failed totalsProbabilities; turn 2: match grounding failed totalsComplement; turn 2: match grounding failed bttsComplement; turn 2: match grounding failed scorelinesPresent; turn 2: match grounding failed oddsSourcesPresent

## Recommendations

No code change recommended from this run.
