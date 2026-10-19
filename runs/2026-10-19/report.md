# Pundit Chat Battle Test — 2026-10-19T06:12:19.029Z

- Run: `2026-10-19T06-12-19-029Z`
- Deployment: `ec6af6db-9c43-4e2b-94e6-e5d7699188b8` (api version)
- Source/API/Web SHAs: `4460d2d634ad9ccb754f60ecfc36b573566a0617` / `4460d2d634ad9ccb754f60ecfc36b573566a0617` / `4460d2d634ad9ccb754f60ecfc36b573566a0617`
- SHA convergence: PASS — api=4460d2d634ad9ccb754f60ecfc36b573566a0617 (match vs floor 4460d2d634ad9ccb754f60ecfc36b573566a0617), web=4460d2d634ad9ccb754f60ecfc36b573566a0617 (match vs floor 4460d2d634ad9ccb754f60ecfc36b573566a0617)
- Evaluation schema: `17`
- Previous comparison: baseline—no prior comparator
- Overall: **ISSUES FOUND**
- Certification gate: FAIL
- Pacing gate: PASS — 13024.187562999956 ms minimum observed gap (required 13000 ms)
- Web search telemetry: preflight 0, post-run 38, delta 38, consecutive failures 0
- judge: skipped (unavailable) · skipped turns 24
- Agent judge: skipped (unavailable) · skipped turns 24

## Scenario Results

| Scenario | Result | Status | Latency | Evidence |
|---|---:|---:|---:|---|
| homepage-desk-output | PASS | 200 | 820 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=344 chars. |
| pinned-current-manager-and-result-evidence | FAIL | 200 | 34570 ms | turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification |
| owned-premier-league-latest-result | PASS | 200 | 160 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=verified, citations=1, answer=219 chars. |
| dated-club-news-delivers-supported-update | PASS | 200 | 36437 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=verified, citations=1, answer=775 chars. |
| active-match-grounding | PASS | 200 | 286 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=164 chars. |
| priced-fixture-retains-1x2-context | PASS | 200 | 659 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=57 chars. |
| table-route-preserves-match | PASS | 200 | 726 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=57 chars. |
| analyst-conversation-golden-path | PASS | 200 | 1125 ms | 6 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=170 chars. |
| replacing-is-not-epl | PASS | 200 | 156 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=abstain, citations=0, answer=115 chars. |
| candidate-never-becomes-fixture | PASS | 200 | 8292 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=133 chars. |
| two-legged-tie-resolves-to-a-real-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| suggestion-chip-identity-selects-its-leg | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| recognized-friendly-outside-coverage | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| temporary-fixture-unavailability | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| unsupported-followup-and-matchup-replacement | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| table-route-preserves-match-routing | PASS | — | — ms | Built API runtime helper resolveFixtureRoutingSequence returned the exact expected contract. |
| observational-live-friendly | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/friendly-policy-disabled (registry routing enabled; 61 of 90 observed identities routable). |
| observational-live-in-play | INCONCLUSIVE | — | — ms | No routable recognized fixture matched outside-coverage/in-play-model-unavailable (registry routing enabled; 61 of 90 observed identities routable). |
| observational-live-temporary | INCONCLUSIVE | — | — ms | No routable recognized fixture matched temporarily-unpriced/any (registry routing enabled; 61 of 90 observed identities routable). |
| observational-live-replacement | PASS | 200 | 489 ms | 3 turn(s), grounding=fixture, fixture=espn:eng.1:401878754, capability=insufficient-model-input, verification=not-required, citations=0, answer=117 chars. |
| observational-live-neutral-venue | INCONCLUSIVE | — | — ms | No routable recognized fixture matched insufficient-model-input/neutral-venue-unknown (registry routing enabled; 61 of 90 observed identities routable). |
| observational-live-two-legged-matchup | INCONCLUSIVE | — | — ms | No two-legged tie in the active model set; substitution is forbidden. |
| observational-live-suggestion-chip | PASS | 200 | 198 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=164 chars. |
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
| team-news-sourcing | FAIL | 200 | 13871 ms | turn 1: answer asserts team news without a source and date after applying any abstention only to its own sentence: I haven’t verified separate injury updates for both clubs. — Bentancur (Tottenham) is listed as suspended according to a source (16 October 2026) ([Tottenham Hotspur injury, suspension list and return dates vs. Coventry: Pedro Porro, Dejan Kulusevski latest - Sports Mole](https://www.sportsmole.co.uk/football/spurs/injury-news/injuries-and-suspensions/porro-kulusevski-updates-spurs-injury-suspension-list-vs-coventry_607017.html), 2026-10-16T07:52:00+01:00). That is match-context team news, not a revised forecast. I haven’t verified separate injury updates for both clubs.; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated; turn 1: positive dated club news failed positiveNewsCountMatches; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated; turn 1: positive dated club news failed positiveNewsCountMatches |
| table-detour-then-scorer-retention | PASS | 200 | 15105 ms | 3 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=abstain, citations=0, answer=460 chars. |
| third-club-scorer-retains-fixture | PASS | 200 | 270 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=abstain, citations=0, answer=307 chars. |
| market-comparison-coverage | PASS | 200 | 178 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=170 chars. |
| competition-grounding | PASS | 200 | 148 ms | 1 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=463 chars. |
| foreign-season-scope-after-epl-table | PASS | 200 | 1147 ms | 4 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=244 chars. |
| competition-follow-up | PASS | 200 | 1555 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=450 chars. |
| season-certainty-follow-up | PASS | 200 | 2003 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=465 chars. |
| general-analysis-label | PASS | 200 | 159 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=595 chars. |
| tactical-comparison-not-fixture | PASS | 200 | 498 ms | 3 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=1390 chars. |
| standalone-football-explainers | PASS | 200 | 167 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=786 chars. |
| standalone-football-explainer-favourite | PASS | 200 | 163 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=603 chars. |
| standalone-football-explainer-derby | PASS | 200 | 161 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=726 chars. |
| standalone-football-explainer-chance | PASS | 200 | 167 ms | 1 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=738 chars. |
| contextual-follow-up | PASS | 200 | 422 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=525 chars. |
| user-line-pass-play | PASS | 200 | 396 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=307 chars. |
| stake-refusal-without-bankroll | PASS | 200 | 378 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=141 chars. |
| featured-fixture-opens-pricing-desk | PASS | 200 | 178 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=164 chars. |
| featured-totals-honesty | PASS | 200 | 169 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=150 chars. |
| featured-o25-scoreline-follow-up | PASS | 200 | 544 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=238 chars. |
| featured-match-briefing-is-not-pricing-desk | PASS | 200 | 198 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=2126 chars. |
| featured-tactical-matchup-keeps-a-take | PASS | 200 | 185 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=728 chars. |
| featured-explicit-preview-stays-long-read | PASS | 200 | 189 ms | 1 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=1016 chars. |
| sse-ordering | PASS | 200 | 166 ms | SSE order: grounding → delta → done. |
| client-cancellation | PASS | 200 | 190 ms | Grounding received, then client AbortError observed after 0ms. |
| malformed-history | PASS | 400 | 173 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |
| adversarial-ambiguity | PASS | 200 | 296 ms | 2 turn(s), grounding=null, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=241 chars. |
| adversarial-follow-up | PASS | 200 | 1265 ms | 2 turn(s), grounding=competition, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=239 chars. |
| adversarial-grounding | PASS | 200 | 411 ms | 2 turn(s), grounding=match, fixture=espn:eng.1:401879257, capability=priced-or-n/a, verification=not-required, citations=0, answer=201 chars. |
| adversarial-certainty | PASS | 200 | 2298 ms | 2 turn(s), grounding=season, fixture=none, capability=priced-or-n/a, verification=not-required, citations=0, answer=475 chars. |
| adversarial-malformed | PASS | 400 | 160 ms | HTTP 400: {"error":"The conversation context is invalid. Start a new chat and try again."} |

## Browser Evidence

- INCONCLUSIVE: browser check not yet attached.

## Findings

1. **FAIL — pinned-current-manager-and-result-evidence:** turn 1: positive current manager failed positiveCurrentManagerVerification; turn 1: positive current manager failed currentManagerIdentityDelivered; turn 1: positive current manager failed everyCurrentManagerIdentityCited; turn 1: positive current manager failed currentManagerIdentityUnambiguous; turn 1: verification failed verificationStatus; turn 1: verification failed positiveCurrentManagerVerification; turn 2: positive current manager failed positiveCurrentManagerVerification; turn 2: positive current manager failed currentManagerIdentityDelivered; turn 2: positive current manager failed everyCurrentManagerIdentityCited; turn 2: positive current manager failed currentManagerIdentityUnambiguous; turn 2: verification failed verificationStatus; turn 2: verification failed positiveCurrentManagerVerification
2. **FAIL — team-news-sourcing:** turn 1: answer asserts team news without a source and date after applying any abstention only to its own sentence: I haven’t verified separate injury updates for both clubs. — Bentancur (Tottenham) is listed as suspended according to a source (16 October 2026) ([Tottenham Hotspur injury, suspension list and return dates vs. Coventry: Pedro Porro, Dejan Kulusevski latest - Sports Mole](https://www.sportsmole.co.uk/football/spurs/injury-news/injuries-and-suspensions/porro-kulusevski-updates-spurs-injury-suspension-list-vs-coventry_607017.html), 2026-10-16T07:52:00+01:00). That is match-context team news, not a revised forecast. I haven’t verified separate injury updates for both clubs.; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated; turn 1: positive dated club news failed positiveNewsCountMatches; turn 1: positive dated club news failed positiveDatedNewsDelivered; turn 1: positive dated club news failed everyPositiveNewsRecordDated; turn 1: positive dated club news failed positiveNewsCountMatches

## Recommendations

No code change recommended from this run.
