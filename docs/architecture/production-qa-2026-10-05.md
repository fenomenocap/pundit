# Production QA — 2026-10-05 SGT

PR #221 merged as `8e50dad726287de2efb2700a0e6d6828c6c8992a`.
Railway deployment `de38ddd3-a884-4fce-b6bc-9337c42515ed` reached SUCCESS;
Vercel `dpl_215cuT8h3FYQuRSXYmikjGr7CuPJ` reached Ready. Both public
version endpoints served that exact SHA and `pnpm verify:prod <sha> <sha>` passed.

## Model mathematics and limitations

An independent Python implementation, using factorial Poisson probabilities and
the exact pinned input ratings, reproduced all 30 active fixtures' 1X2, O/U 2.5,
BTTS and top-five scoreline ranks within the four-decimal output tolerance.
Maximum probability difference was 0.000049895. Maximum omitted grid mass before
normalization was 0.000046685 (0.00467%). Using the displayed one-decimal ratings
instead produces tiny differences; those are presentation rounding, not different
forecast inputs. The artifact hash was checked on every fixture.

Over and under a half-goal line exhaust the possible outcomes without a push;
their probabilities must sum to one. These percentages are not decimal odds.
Fair decimal odds are `1 / probability`; bookmaker implied probabilities can
include a margin before normalization.

The material weakness is the fixed expected-goals total of 2.70. Elo divides
that total between the teams but cannot change match openness. The low-score
correction redistributes only the 0–0, 0–1, 1–0 and 1–1 cells, all below 2.5;
their adjustments cancel. Thus the untruncated over probability is always
`1 - exp(-2.7) * (1 + 2.7 + 2.7² / 2) = 0.506375509`.
Every active fixture publishes 50.64% over. Truncation produces only negligible
differences before output rounding. This is mathematically coherent but is not
a useful match-specific totals forecast. BTTS and scorelines do vary with the
allocation between teams, but remain subject to the same fixed-total assumption.

## Fresh production-ledger replay

The public live ledger contains 72 rows: 64 completed official seals (50 PL,
14 UCL qualifiers) and eight excluded legacy rows. Of the official seals, 43
used the historical geometric mapping and 21 the fixed-total mapping. Recomputed
current-model results must not be presented as historically published forecasts.

The existing offline calibration workflow was rerun on the live export with
2,000 paired UTC-week bootstrap draws. No sample fallback was used.

| Comparison | Matches | Current Brier | Fitted Brier |
|---|---:|---:|---:|
| Full official sample, recomputed and descriptive | 64 | 0.6572 | 0.6620 |
| Chronological PL holdout | 20 | 0.6827 | 0.7024 |

The fitted constants (1.41 / 11 / −0.05) do not improve the holdout. Twenty
held-out matches across two weeks also fail the minimum 40-match/five-week
research gates. Retain the production constants 1.35 / 42 / −0.1. No model,
registered artifact or production ledger was replaced.

The 63 paired market comparisons show current recomputed Brier 0.6624 versus
market 0.6265. These market snapshots are not necessarily contemporaneous with
the forecast seal. This is descriptive evidence of a quality gap, not a
matched-horizon trading backtest or proof of profitability.

## Immediate product and evaluation corrections

- Replace the incorrectly named FA/EFL trophy asset with the complete official
  white Premier League mark, displayed without cropping.
- Distinguish model percentages from fair decimal odds, explain complementary
  O/U probabilities, and put the fixed-total caveat beside the goals figures.
- Preserve `voice: "desk"` in production evaluation requests and add a required
  homepage briefing/follow-up scenario. The previous harness did not exercise
  the actual homepage voice. Existing standard-path scenarios remain intact.
- Keep the conditional football fallback when the prose provider returns no
  text; previously this fell through to a generic numeric draft.

Local source evidence is retained in the ignored directory
`packages/api/data/research/qa-20261005/`, including public API exports,
independent calculation and calibration report. These are research copies;
Railway `/data` remains production truth.

## Challenger replay and remaining model work

Rerunning the current evaluator confirms that dated prior-only coverage and
weekly expanding-window attack/defence fitting already exist in research.
The three fixed-origin runs score 1,146 pairs over 572 unique fixtures, including
216 prior-only pairs, with no coverage exclusion. The challenger still fails
promotion: it does not beat the champion across the required origins. In the
January 2026 origin, improved 1X2 Brier accompanies worse totals Brier
(0.249581 versus 0.267131).

The weekly replay has 69 origins, 730 unique holdout fixtures, 725 scored pairs,
five invalid/uncovered pairs and four prior-only pairs. It also remains blocked.
Seven weekly fits did not converge. Across the 725 scored pairs, sample-weighted
1X2 Brier improves from 0.62844 to 0.62048, but totals Brier worsens from 0.24928
to 0.25791; BTTS improves from 0.25779 to 0.25058. These pooled descriptions
include the unconverged weeks and exclude the five invalid pairs, so they are
diagnostics, not validated production-performance estimates.
Its gate requires two origins with at least 40 scored matches; a football week
usually has far fewer matches. This gate is unsuitable for interpreting pooled
weekly evidence and should be redesigned explicitly before a new selection
experiment, rather than relaxed until the candidate passes. Coverage and
nonconvergence must still block any production recommendation.

Use only results available before each forecast, compare all markets on the same
held-out fixtures and keep parameter selection inside earlier windows. Establish
cadence-appropriate multi-market criteria, resolve invalid grids/nonconvergence,
then freeze a candidate for prospective validation. Existing research models
must not be promoted merely to remove the fixed-total limitation.

Live output certification is separate from these mathematical and research
checks. A final Schema-17 PASS must bind fresh answers, browser evidence and
agent critic review to the evaluated deployment; this document alone does not
certify the delivered prose or investment usefulness.

## First live output review and follow-up repair

PR #222 merged as `f3a2ec873352ad8ed1a6c8387bf9b7e5cd9e61c2` and both
production targets served that SHA. The fresh run `2026-10-04T16-42-07-476Z`
completed 63 scenarios and 55 successful HTTP-200 answer turns. Its first
complete browser and critic artifacts were retained and finalized as
`ISSUES FOUND`, rather than overwritten or treated as a release certificate.

Semantic review found that broad previews called a live, upcoming forecast
"sealed" without an immutable pre-kickoff ledger seal. Live previews and
Consensus attribution now describe model-only versus market-adjusted views;
the evaluator rejects unsupported seal claims in active-match answers.

Browser fixture retention preserved the correct identity, but its check still
expected an expanded card on every follow-up. It now opens the compact context
disclosure and checks the revealed fixture identity and canonical probabilities.
The opening board and all other retention checks remain required.

The homepage also lacked cancellation and a client deadline. It now has Stop,
a 95-second client deadline around the complete fetch/JSON operation (the server
deadline is 90 seconds), prompt restoration on failure, and protection against
late replies after cancellation or unmount. A successful but empty response
raises a retryable error rather than echoing the user's question as an answer.
Playwright covers cancellation on phone and desktop, late replies, deadline
recovery, empty answers, and retries without dangling history.

The repaired application deployed as `f440a3a7a07000fe1ba3591aeffce68d93d2de07`;
Railway `13409c91-763d-445a-821d-f64b9cf9d97c` reached SUCCESS and Vercel
`dpl_Cy8o5dQgimeN8KQJf3UXfyokjVbw` reached Ready. Both public versions matched,
and production verification passed. Run `2026-10-04T17-16-34-156Z` passed the
required API scenarios, all 55 reviewed successful answers and all 11 browser
product contracts, but strict certification still failed: a wall-clock interval
was 12,927 ms while its monotonic interval was 13,026 ms. Original timestamps
and captured evidence were retained; a separate reviewed copy corrected the
capture's erroneous pacing PASS flag, and the report was finalized as
`ISSUES FOUND`. This is a QA tooling defect, not evidence of a failed fixture
retention or model-output contract.

The browser pacer now enforces both clock intervals and records the exact samples
it checked. Forward clock jumps cannot bypass monotonic spacing, and backward
corrections cannot bypass wall-clock spacing. Neither the 13-second minimum nor
the finalizer's strict checks are weakened. A new evaluation is required after
this repair; the prior reports remain preserved.

## Runtime dependency security repair

The production-only pnpm audit reported 95 advisories (2 critical, 40 high,
45 moderate, 8 low) on the previous lockfile. This is a dependency finding,
not evidence that every advisory was exploitable in this deployment. The
Windows-specific Next.js critical path does not match the Linux production
host; image-optimization issues also depend on enabled features.

Upgrade Next.js 14.2.35 to supported Maintenance LTS 15.5.27, with React 19
and matching React types and eslint-config-next. The official
`next-async-request-api` codemod inspected 73 files and required no edits.
Patch Express to 4.22.3 and express-rate-limit to 8.7.0. Remove the unused
shadcn scaffolding CLI dependency; generated UI components remain local.
Next.js still pins PostCSS 8.4.31, so the root pnpm override selects the patched
same-major PostCSS 8.5.28. The isolated upgraded production dependency audit
reports zero advisories across 280 dependencies. CI now checks high/critical
production dependency advisories before type checks.

Primary references: [Next.js September security release](https://nextjs.org/blog/september-2026-security-release),
[Next.js support policy](https://nextjs.org/support-policy),
[version 15 migration guide](https://nextjs.org/docs/app/guides/upgrading/version-15).
Release acceptance also requires full API and web regressions, exact deployed
SHA verification and a fresh paced API/browser/critic certification on the new
deployment. Earlier output certification does not certify this dependency upgrade.

The full development-and-production audit was then reduced from 48 remaining
advisories to one high advisory by updating Vitest to 4.1.11 with a supported
Vite 8 peer and applying same-major patched overrides to vulnerable transitive
parsers/glob utilities. Source test discovery is explicit under Vitest 4, so
compiled `dist` copies are not accidentally rerun. The sole remaining finding
is [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
upstream lists no patched version as of this audit. It appears only in trusted
repository development/build glob processing, not the production dependency
tree. Do not feed untrusted brace patterns into these tools. The advisory is
retained in the full audit, without an ignore or a false claim of remediation.
CI separately rejects critical advisories across development dependencies.

## Independent scenario review and immediate repairs

Three QA agents independently reviewed API routing/output, browser journeys and
quant mathematics. The browser suite now includes keyboard Enter/Space selection
for paper fixtures and draft players. Complete 88-pick draft legality, reload
persistence, paper credit accounting, settlement and reset were exercised twice
with mocked APIs; these checks do not establish live provider quality. Next.js
file tracing is pinned to the repository rather than an unrelated parent lockfile.

A live generic question about pressing traps against a narrow midfield was
incorrectly classified as an unidentified fixture. Generic tactical comparisons
now consume only bounded concepts and framing; unknown clubs decorated with
those concepts still fail closed, including after retained fixture context. The
production evaluation includes the exact failed question and rejects a fixture
refusal. Grounding validation now checks both totals and BTTS complements.

Independent synthetic quant reproduction exposed pre-match forecasts on an
in-play Arsenal–Leeds fixture at 0–4: Under 2.5 still showed 49.36%. The champion
does not condition on elapsed time or live score. Public pre-match pricing and
market comparison therefore exclude underway fixtures and expire at scheduled
kickoff, including stale cached rows before ESPN updates its status. Recognized fixtures retain an explicit live-forecast-unavailable
capability. Neutral-venue narrative grounding now derives home advantage from
the actual forecast provenance, matching the zero-HFA calculation.

A separate numerical grid exercise passed 13,164 invariants covering
normalization, orientation/symmetry, complements, reciprocal fair odds, rating
extremes and zero goal means. Mathematical correctness does not establish
forecast quality. Fixed total expected goals remain a substantive limitation.
The chronological challengers remain unpromoted; their totals performance
deteriorates despite some 1X2 improvements. Before future model promotion, the
research gate must evaluate totals, BTTS, scoreline loss and uncertainty as well
as its existing 1X2 measures. Existing thresholds were not relaxed and production
constants were not changed.

The final mocked browser suite passed all 60 scenarios twice after the last
component change. Two in-play scenarios cover both desk JSON and legacy SSE:
no probability board or live-market gap, visible capability reason, retained
recognized fixture ID on follow-up, and replacement when the user names a new
matchup. Eleven API synthetic regressions cover exact kickoff with a lagging
status feed, independent cache/status transitions, retained identity, market
suppression and actual home advantage. Historical seal tests explicitly freeze
their replay clock; production kickoff guards were not weakened.

## Semantic follow-up after deployed routing repair

PR #227 deployed as `8aeb3b89c0b394b5aead4578c389b88b69d40ca9` on both
public targets, with production verification PASS. The exact tactical prompt
then reached general analysis, but independent semantic review rejected its
incomplete pressing-trap mechanism, irrelevant team-news abstention and
unsupported effectiveness claim. The manual delivered-output screenshot is
preserved under `artifacts/chat-evals/production-tactical-copy-review-8aeb3b8.jpg`.
This is not a production certification PASS.

The foundational generic comparison now has a complete deterministic explanation
of the invited pass, trigger, covered outlets, short combinations and wide
escape risks. The bounded parser still excludes club-specific or pricing
questions. A fresh deployment and full output certification are required.

## Latest certification and bounded follow-up

PR #228 merged as `3d0352899e1213d592337524a3c8106fa3d896f9` and
Railway deployment `13eff73a-ea0e-4cd6-a8fc-d368cfc179f8` reached SUCCESS.
The API served that SHA; the unchanged web served its build floor
`8aeb3b89c0b394b5aead4578c389b88b69d40ca9`. Production verification passed.

Run `2026-10-04T20-43-02-953Z` completed 65 scenarios: 60 passed and five
absence-only observations were safely inconclusive. All 56 successful delivered
answer turns passed independent semantic review. The required-traffic p90 was
6,802 ms and the 59 API requests preserved at least 13,025 ms between starts.
This is not a complete release certificate: desktop browser capture timed out
on “Back to that match: what will the 1X2 be?”. Mobile retention had completed.
The server recorded HTTP 200 in 19,353 ms for the desktop return request.
Long browser timing gaps suggest suspension, but no timeout DOM/network snapshot
was preserved, so the root cause remains unresolved. The original failed browser
artifact is retained, and the finalizer rejected its missing postflight version
and timing evidence. The report remains `ISSUES FOUND`.

The capture harness now preserves bounded request outcomes, prompt, viewport,
composer/alerts/DOM and a screenshot before closing a failed browser context.
Timeouts, pacing, deployment checks and acceptance criteria are unchanged.
Independent review also qualified the early-table caveat: a table alone does
not establish fixture-order causality or how many places one result will move
a club. Wide-point-gap and completed-season regressions guard this wording.
A fresh API/browser/critic cycle is required after this follow-up release.

Settled mobile and tablet images were recaptured after the viewport transition;
the earlier immediate-resize images are invalid visual evidence and are retained
only as such. The settled images show readable wrapping with no document overflow.

## Next model experiment

Repair the five invalid weekly grids and seven unconverged fits before assessing
performance: validate all four corrected low-score cells, not just the observed
training result, and retain every failure in the coverage denominator. Freeze
a dated, prior-only experiment manifest and choose parameters inside earlier
windows. Compare 1X2 Brier/log loss, totals Brier, BTTS Brier and scoreline log loss
on the same unique held-out fixtures, with paired week-level uncertainty and
coverage strata. Overlapping origin forecasts are not independent matches.

Predeclare cadence-appropriate multi-market acceptance rules and any justified
noninferiority margins before observing a new holdout. Derive data requirements
from earlier-window uncertainty; do not invent thresholds or retrospectively
relax the existing gates. A qualifying candidate must then be frozen for
prospective pre-kickoff seals and a separate promotion decision. Season
calibration across historical seasons and fixed-strength sensitivity remain
separate research work. Asynchronous market snapshots do not prove tradable edge.

The completed independent PR #227 review found two additional medium issues.
The tactical framing allowlist now accepts natural “what” and “why” questions,
while whole-side consumption continues to reject unknown clubs dressed in
tactical terms. The required live tactical scenario now includes both variants.
Fallback desk chips become explicit general-football explainers, with standalone
history and no fixture/line attachment. They no longer promise an unavailable
slate aggregation or inherit an unpriced pin. The transcript and pin are retained
for a subsequent typed match follow-up; priced match chips remain scoped.

## Delivered-answer failures after PR #229

PR #229 merged as `d93af6f59cf16ebc28831a9bf52548c723ee1272`,
with matching ready Vercel and successful Railway deployments. Required CI and
production verification passed. Run `2026-10-04T22-15-04-325Z` completed
66 scenarios, with no automated required failures, but independent review of
all 62 successful answer turns rejected five materially incomplete or unsupported
answers. The four general desk explainers leaked example percentages, made
unqualified derby claims or lost their explanation after claim pruning. The
match-scoped “Tactical matchup” answer supplied probabilities and a lineup caveat
without a tactical mechanism. The failed answers are retained as regression
fixtures; this release is not certified.

The browser wait also timed out despite saved HTTP 200, a complete scorer
abstention, three assistant bubbles and an enabled composer. A local Chromium
reproduction proves that default animation-frame polling can miss a completed
answer when animation frames stop. It does not establish why frames or timing
stalled in production. The finalizer rejected incomplete browser evidence;
original run, screenshots, critic and rejection artifacts remain intact.

The bounded follow-up makes the four general educational requests complete
server-authored answers, removes irrelevant latest-news searching from pure
concept questions, and requires a conditional football mechanism for the
match-scoped tactical request. Live evaluator scenarios match the UI's standalone
requests, and semantic assertions reject the five actual failures. Browser
completion uses interval polling with the same timeout, DOM conditions, pacing
and certification requirements. No model constants or promotion gates change.

Independent inspection of the failed browser's POST request-event diagnostics
also found an actual start gap of 12,861 ms despite click-intent pacing above
13,025 ms. Different click-to-network dispatch delays caused the discrepancy.
The follow-up records and anchors pacing to actual POST request events using
both monotonic and wall clocks; the mandatory 13-second traffic requirement
and cooldown remain unchanged. This is another reason the failed run cannot
certify the release.

Adversarial current-fact tests also reproduced uncited manager identities and
recent results surviving desk delivery after an empty mandatory search. The
repair preserves current evidence requirements and reuses bounded result/price
guards, adding manager identity protection. Separate conditional or refusal
clauses cannot shelter an affirmative unsupported fact; owned structured match
and table numbers retain their existing deterministic path.

The final answer/capture repair passed 1,186 API tests across 59 files twice,
154 evaluator-harness tests twice and 63 mocked Chromium scenarios twice.
API build and pinned artifact verification passed with all 18 golden fixtures
unchanged. Independent source and semantic review accepted the repairs,
including current-claim clause controls and actual-network pacing. These are
local checks; a fresh production certificate remains required.

Completed automated review identified an appositive manager-name escape and a
generic-coach false positive. Final regressions also reproduced unsupported
colon/dash clauses, quoted bookmaker prices and bare direct answers. The
bounded repair binds identities to roles, preserves genuine hypotheticals and
source-backed claims, and refuses direct current facts with no verified support.
Pinned manager/latest-result requests previously skipped search and returned
the pricing board; they now retain match context while requiring current
evidence. Generic defensive-role questions remain no-search explanations.
Final focused coverage passed 358 tests twice; full API coverage passed 1,197
tests twice. Build and all 18 golden forecasts remain unchanged.

Final-head review reproduced possessive manager questions and identity/result
requests with an appended "why" still closing on the pricing board. Identity
and dated-result intent now precedes the explanatory-word exclusion; named
current-price comparisons cannot evade evidence because they also mention the
model. Generic geometry and owned fair-price calculations retain their paths.
The required live manifest now has 70 scenarios, including three pinned
manager/result requests whose relevance and source support need critic review.

Independent browser review also reproduced finalization overwriting the API
completion timestamp, invalidating the saved browser cooldown binding. The
finalizer preserves that timestamp and records `finalizedAt` separately. A
regression runs finalization twice and validates the persisted evidence each
time. This repairs evidence consistency without weakening any release gate.

The resulting source passed 1,204 API tests across 59 files twice, 365 focused
tests twice and 155 evaluator-harness tests twice. Build and pinned artifact
verification passed with all 18 golden fixtures unchanged. These checks do not
replace the required fresh production API/browser/critic certificate.

## Offline fitter numerical repair

The research fitter now requires all four low-score correction factors to be
finite and nonnegative for each training matchup. An unobserved zero remains
admissible; the observed likelihood retains its existing `tau > 1e-12` safeguard.
Forecasts independently reject invalid full grids, record resolved rejections as
`invalid-score-grid`, and retain those holdout rows. The clipped-rate derivative
is zero strictly beyond either eta bound, with the existing interior-sided
endpoint convention retained.

The 41 focused regressions passed twice; the unchanged-source control failed
11 new cases. Applied to the complete repository, the repair passed 1,219 API
tests across 59 files twice and the complete API build. All 18 golden production
forecasts remain unchanged. The independent probe at
`artifacts/model-qa/mle-gradient-check.cjs` also passed against this repository's
compiled fitter: 306 finite-difference coordinates and seven admissibility
cases, with maximum scaled error 1.25e-7. Reproduction details and before/after
evidence are in `artifacts/model-qa/mle-review.md`.

Clipped stationary convergence does not establish a global optimum, usable
forecast or calibration, nor resolve the seven historical nonconverged origins.
Preserve prior reports and require a fresh chronological replay with full
coverage and paired multi-market uncertainty. The production champion's fixed
2.70 total, constants, artifact and promotion gates remain unchanged; these
numerical checks support no promotion.
