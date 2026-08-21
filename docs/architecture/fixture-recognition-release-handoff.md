# Fixture recognition release handoff (historical gate record)

Date: 2026-08-13

This document preserves the evidence and disposition of the August 13 fixture-recognition release. Test counts and deployment identities below belong to the recorded branch and run; they are not a claim about current `main`. Current Schema-15 release certification must record its exact source and deployment identity, per-target API/web build-floor convergence, and immutable evaluator artifact; its per-turn critic evidence, observed pacing gate, post-run readiness/search telemetry, and stronger semantic matrix are intentionally non-comparable with the historical Schema-10 through Schema-14 runs.

## Scope and lineage

This branch is rooted in the exact deployed Schema 8 commit chain:

- `323ccb0` — runtime release controls.
- `ea31774` — evidence provenance binding.
- `5fdfb3e` — immutable forecast ledger.

Before feature work, the Railway API and Vercel web version endpoints both
reported `5fdfb3e1aed5391e6e0de98203c2073fdb0bfbfb`. The feature branch was not
pushed, deployed, or used for production MiniMax traffic during implementation.

## Local acceptance evidence

Run from the repository root:

| Gate | Reproduction | Result on this branch |
|---|---|---|
| API behavior and deterministic regressions | `pnpm --filter api test` | PASS — 34 files, 403 tests |
| API types | `pnpm --filter api exec tsc --noEmit` | PASS |
| Web types | `pnpm --filter web exec tsc --noEmit` | PASS |
| Schema-10 evaluator | `pnpm chat-eval:test` | PASS — 38 tests |
| Evaluator configuration | `pnpm chat-eval:dry-run` | PASS; production traffic false; pacing 13,000 ms |
| Production builds | `pnpm build` | PASS — API and web |
| Browser smoke | `pnpm --filter web test:e2e` | PASS — Chromium 9/9 |
| Patch hygiene | `git diff --check` | PASS |

The protected representative model payload is pinned by SHA-256
`bbed9ea46635bf3f15bf3475f376e182b9d5ccf80d403ca543ff2403b2ee6959` in
`model-data.test.ts`. Recognition adds an eligibility gate but no numeric model
input.

## Gate disposition

1. **Schema 8 reconciliation — local PASS.** Exact commits are ancestors of
   this branch; Schema 8 ledger rows and exclusions were not rewritten.
2. **Fixture-source study — PASS with constraints.** The report and normalized
   matrix cover all seven requested categories. Update latency remains
   `INCONCLUSIVE` without longitudinal observation. ESPN and official-source
   terms require permission before expanded automated collection; no paid feed
   or raw sample was added.
3. **Registry and capability — local PASS, shadowed.** Candidates cannot enter
   the persisted registry. Recognized identities are strictly validated,
   written atomically with last-good recovery, fail closed without overwriting
   when both copies are invalid, bounded for routing, and exposed
   through the read-only certification endpoint. Expansion remains disabled by
   default.
4. **Routing/API/UI — local PASS.** Typed fixture precedence, retained context,
   matchup replacement, table detours, token boundaries, capability labels,
   held SSE for non-priced fixtures, and New Chat are covered by API and browser
   tests.
5. **Response correctness — local PASS.** Current-fact search, bounded pinned
   retrieval, one no-retry verifier call, correction acknowledgement, citation
   binding, scoreline arithmetic, and fail-closed external markets have focused
   service tests. The evaluator runs the built deterministic utility contracts;
   end-to-end generated-answer correctness is separately critic-gated and is not
   inferred from a helper result. Generated bookmaker numbers are omitted unless
   a server-owned record proves all three same-source/time decimal legs.
6. **Evaluator/certification — local PASS after Schema 10 hardening.** Schema 10 records immutable
   per-turn request, response, grounding, capability, citations, verification,
   latency, SSE, reproduction, and independent source/API/web SHAs. Required
   null or `INCONCLUSIVE` correctness blocks overall PASS; fixtures are never
   substituted. Permanent friendly, temporary, replacement, and neutral-input
   behavior is exercised against the built routing/capability implementation
   with controlled recognized identities, so live fixture availability cannot
   waive those gates. Separate production-discovery probes remain observational
   and become `INCONCLUSIVE` when no exact live identity exists. Final critic
   review preserves the original same-schema comparator, so a critic-created
   failure remains a `REGRESSION` when the prior run passed.
7. **Private friendly shadow policy — local PASS, disabled and library-only.**
   It has no public route or UI, applies zero HFA and wider uncertainty, fails
   closed on missing inputs, and can write a recoverable immutable private
   ledger with chronological Brier, log-loss, calibration, and segment metrics.
   This release intentionally has no scheduled collector or automatic public
   promotion; setting the flag alone does not acquire or append forecasts.

The four screenshot-class failures are permanent local contracts: stale-manager
era conflict, correction-cue detection plus re-verification service behavior,
`1-1` settlement against over 2.5, and complete/attributed 1X2 validation. Live
generated answers require an explicit per-scenario critic verdict before the
report can pass. An authoritative friendly is locally tested as recognized and
outside public coverage; live discovery is informational when no exact friendly
exists and fixtures are never substituted.

## Production release and certification evidence

Release authority was granted and the feature release plus startup hotfixes
were merged through PRs 53-55. Railway deployment
`0ae16866-c90e-46bd-9d7f-c3911f3d6307` reached terminal `SUCCESS`; Railway API,
Vercel web, and source all reported
`e4579eb5d5e20e8d4a02ac98e70875f5dfb7f924`. The production-evaluation fixes
were then merged in PR 56 and deployed as Railway deployment
`d3b60bec-779b-479d-af74-4fac2ef5602c`; Railway API, Vercel web, and source all
reported `32ada0a47ae09d77be6dcdb57cbbf679732da20c`. The hardened production
verifier passed after both deployments: health, startup, readiness, registry
shadow isolation, candidate-free fixture exposure, search/runtime status,
one-replica rate limiting, CORS, and the production bundle host check.

Railway reported one running deployment instance and a ready 5 GB volume at
`/data`. A read-only filesystem check found the registry primary and last-good
artifacts, club-season calibration artifact, and ClubElo cache. Startup restored
594 ratings from that cache after ClubElo timed out, priced 18 of 24 active
fixtures, and continued to serve `/ready` with HTTP 200. Six fixtures remained
honestly unpriced because three active teams had no bounded rating input.

The subsequent local artifact cutover removes ClubElo availability from the
runtime path without changing the 18 already priced fixtures. The permanent
`golden-cutover-v1.json` gate reconstructs those fixtures from the pinned
content-addressed artifact and compares their home/away inputs plus every
public 1X2, totals, BTTS and top-score field exactly. All 18 pass; explicit AEK
Athens, LASK Linz and Viking FK aliases add the six previously unpriced fixture
IDs without rewriting the baseline. Artifact verification runs in the API
build as well as CI. Model construction also refuses `neutralVenue: null`, and
production verification enforces the registry/model priced join in both
directions. These statements are local release evidence until the artifact
cutover itself is merged and deployed.
The artifact loader additionally rejects ratings outside a defensive 500–3,000
Elo range and validates the provider, retrieval timestamp, citation/rights
status, profile counts, unique-club count, payload format and rating unit before
any row can reach model construction.

The single authorized production evaluation was run once, with 28 requests
paced at 13 seconds, no retries or fixture substitution, and exact deployment
identity. Its p90 latency was 9.223 seconds and every request completed within
the 90-second deadline. The final browser/critic-backed classification is
`ISSUES FOUND`, not PASS. Evidence is preserved under the ignored
`artifacts/chat-evals/2026-08-13T05-21-38-959Z*` files.

That run exposed three material defects now fixed, regression-tested, merged,
and deployed in the follow-up hotfix: stable fixture context did not
disambiguate two legs between the same clubs; current team-news prose could
survive a zero-supported verification abstention; and generated model/market
prose could contradict structured probabilities. It also exposed mutable
request-history evidence, which is now snapshotted by value. A 390x844 browser
check against the evaluated pre-hotfix deployment reproduced the
fixture-context failure, found no console errors or horizontal overflow, and
confirmed New Chat reset. Screenshot capture itself timed out twice, so the
browser evidence correctly remains failed rather than claiming an image.

## Recorded release risks and later disposition

One real friendly is now bundled as an approved, source-bound registry record:
Arsenal–Real Betis, ESPN event `401867142`, corroborated by Real Betis' official
fixture announcement. It persists into the atomic registry, is asserted by the
production verifier, retains recognized context, and is always classified
`outside-coverage / friendly-policy-disabled`; it cannot join the model or emit
Pundit probabilities. This is a reviewed fixture record, not an automated
friendly collector. New records require the same stable structured identity
and official corroboration.

- Registry expansion remains disabled. Enabling it is a separate operational
  decision after source rights and `/data` persistence are verified. Friendly
  shadow collection also needs a separately reviewed private collector; the
  present flag only gates the policy library.
- Source update latency and cross-source conflict rates need a longitudinal
  shadow observation window; the read-only study cannot honestly certify them.
- The recorded evaluation consumed its authorization and remains immutable; it
  cannot be upgraded to PASS after code changes. A later exact-identity run must
  create a new artifact. Fresh release and one bounded production-evaluation
  run were subsequently authorized by the owner.
- The first evaluator's season probes returned 503 because the simulator had no
  usable preseason outlook. That was a structural availability defect, not
  evidence that SSE transport itself failed. Schema 10 decouples its required
  SSE transport scenario from season simulation and keeps season behavior as a
  separate gate; the season runtime remediation and a new production run must
  supply the final production classification.
- This release still used the earlier ClubElo last-good runtime cache. The later
  reviewed artifact cutover removed runtime ClubElo networking: current
  releases load a content-addressed local `clubelo@1` snapshot with hash,
  coverage and freshness gates. Future rating-source replacement remains a
  separate evidence-led model decision, not an availability hotfix.
- The MiniMax credential was inadvertently visible in protected release-tool
  output but was never copied into the repository or report. The owner has
  explicitly accepted the current key; rotation is therefore not a release
  blocker.

Release and one bounded production-evaluation authority was granted on
2026-08-13. This handoff records that exact evidence and the non-PASS production
classification without substituting fixtures or rerunning failed scenarios; it
must not be used as current certification evidence.
