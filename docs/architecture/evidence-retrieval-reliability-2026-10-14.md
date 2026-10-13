# Evidence-retrieval reliability design pass (2026-10-14)

Scope: Daily Chat Eval hard fails on `pinned-current-manager-and-result-evidence` and `dated-club-news-delivers-supported-update` at main `668c1ca` / #276. Eval gates unchanged.

## Verified retrieval and verification paths

### `pinned-current-manager-and-result-evidence`

| Turn | Route | Retrieval | Pinning / render | Harness |
|------|--------|-----------|------------------|---------|
| 1–2 Manager identity | `singleClubCurrentFactScope` → `planFederatedQueries` (manager targeted queries + raw question, cap 4→**5** after this change) → `buildEvidenceBundle` (`filterDeskEvidenceBundle` + prefetch) → `hydrateBundlePublicationDates` → `sourceOwnedManagerDraft` or desk prose → `deliverAnswer` / `settleManagerWhyFacts` | Sky/BBC/official fan-out in `federated-evidence.ts`; pages must be allowlisted (`evidenceAuthority !== "other"`) and fetchable (`evidence-page-retrieval`, max 8 pages) | Draft requires exact bundle id/url/date alignment and `ownsCurrentRole` on publisher-owned body text; answer renders `[[Sn]]` → markdown + `humaniseDeskCitationDates` | `validatePositiveCurrentManager`: sentence must match `{club}'s manager is {Name}` (or equivalent), citation link must carry a calendar date agreeing with citation metadata (21d window) |
| 3 Latest result + why | `ownedLatestResult` **before** match grounding (ESPN cache + season schedule) | No web search | Deterministic ESPN citation | `expectLatestResult.*` in `validateResponseCorrectness` (ESPN URL, ISO date in prose, coverage + causality boundary for “why”) |

**Root causes verified in code (not flaky gates):**

1. **Manager abstention when search/thin fetch**: If OpenRouter returns no allowlisted hit, fetch fails, or no page body passes `ownsCurrentRole`, `sourceOwnedManagerDraft` returns the identity abstention string (not `undefined`), so the turn never falls back to generative prose and verification ends at `supportedClaimCount: 0`. Harness fails `currentManagerIdentityDelivered` and `positiveCurrentManagerVerification`.
2. **Strict publisher binding**: `sourceOwnedManagerDraft` rejects pages when `source.url !== page.url` or `source.date !== page.date` after hydration, or when multiple distinct current identities appear on hydrated pages.
3. **Redundant post-hydration desk filter (fixed here)**: After `hydrateBundlePublicationDates`, `answerQuestionScoped` re-ran `filterDeskEvidenceBundle` on the same bundle. IDs were preserved, but this was unnecessary work on the hot path and could only drop hydrated rows via the shared 21-day desk age gate—misaligned with manager draft’s own freshness checks.
4. **Result turn** is largely ESPN-owned; failures there are usually cache freshness (`FOOTBALL_REFRESH_NORMAL_MS`), competition error flags, or prose/citation shape—not manager search. This PR does not change that path.

### `dated-club-news-delivers-supported-update`

| Stage | Behavior |
|-------|----------|
| Plan | `planResponse` → `team-news`; injury-only questions use `asksInjuryUpdatesWithoutLineups` |
| Search | Club official day-stamped queries + beat `site:` hints (BBC after #278); cap raised for injury-only so raw question is retained |
| Select | `selectTeamNewsSources` drops `authority: other`, ranks club injury titles first (max 8) |
| Settle | `settleTeamNewsFromBundle`: injury-only skips fixture-preview early exit (#277); then `extractDatedClubAvailability` → `composeDatedClubAvailabilityAnswer`, else `datedClubNewsSources` + desk JSON, else compose abstention |
| Verify | Unchanged current-claim verifier; `withTeamNewsCoverage` may append missing-club notice when `supportedClaimCount > 0` |
| Harness | `validatePositiveDatedClubNews`: every “candidate” injury sentence must be `In an update published on YYYY-MM-DD, {Club}'s {Player} …` with link date matching citation metadata; `supportedClaimCount` must equal dated record count |

**Why #277 / #278 did not fully clear the scenario:**

- **#277** fixed a logic bug: fixture-preview observations with `observedAt` short-circuited the dated club-report extractor. That removed one abstention mode but did not improve OpenRouter result quality.
- **#278** added BBC `site:` injury queries only. Production eval still abstains when the merged bundle is mostly fan blogs (`other`, dropped by `selectTeamNewsSources`) or when only fixture previews remain (fail `datedClubNewsSources` / verification). BBC-only bias is insufficient for all featured club pairs and provider variance.

**Remaining failure modes (still possible after this PR):**

- Zero allowlisted, dated, fetchable injury pages for one or both clubs → abstention or partial delivery with count mismatch.
- Verified claims present but extra undated injury-shaped sentences in the answer → `everyPositiveNewsRecordDated` fails.
- `positiveNewsCountMatches` when verifier supports fewer claims than composed dated lines.

## Smallest safe first change (this draft PR)

1. **Retrieval fan-out only** (`federated-evidence.ts`): For injury-only team-news, add Sky Sports and Football London `site:` queries per club; raise federated cap by 2 for that mode so the raw question stays in the set. For manager scoped queries, add Football London and raise manager cap to 5.
2. **Plumbing hygiene** (`ask.ts`): Remove duplicate `filterDeskEvidenceBundle` after manager hydration (JSON + stream paths).

No eval, verifier, or answer-copy changes.

## Next diagnostic if Daily Eval still fails

1. Capture production `team_news_evidence_selected` log line for the featured fixture (counts + candidate URLs).
2. Compare `supportedClaimCount` vs composed `In an update published on` sentences in the battle-test artifact.
3. For manager turns, log whether `sourceOwnedManagerDraft` returned abstention vs `[[Sn]]` draft before verification.
4. If retrieval is thin but ESPN/official club pages exist, consider one additional allowlisted domain hint (e.g. `standard.co.uk`) before touching verification or render templates.
