# Fixture recognition release handoff

Date: 2026-08-13

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
| API behavior and deterministic regressions | `pnpm --filter api test` | PASS — 31 files, 369 tests |
| API types | `pnpm --filter api exec tsc --noEmit` | PASS |
| Web types | `pnpm --filter web exec tsc --noEmit` | PASS |
| Schema-9 evaluator | `pnpm chat-eval:test` | PASS — 33 tests |
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
6. **Evaluator/certification — local PASS.** Schema 9 records immutable
   per-turn request, response, grounding, capability, citations, verification,
   latency, SSE, reproduction, and independent source/API/web SHAs. Required
   null or `INCONCLUSIVE` correctness blocks overall PASS; fixtures are never
   substituted.
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
`e4579eb5d5e20e8d4a02ac98e70875f5dfb7f924`. The hardened production verifier
passed health, startup, readiness, registry shadow isolation, candidate-free
fixture exposure, search/runtime status, one-replica rate limiting, CORS, and
the production bundle host check.

Railway reported one running deployment instance and a ready 5 GB volume at
`/data`. A read-only filesystem check found the registry primary and last-good
artifacts, club-season calibration artifact, and ClubElo cache. Startup restored
594 ratings from that cache after ClubElo timed out, priced 18 of 24 active
fixtures, and continued to serve `/ready` with HTTP 200. Six fixtures remained
honestly unpriced because three active teams had no bounded rating input.

The single authorized production evaluation was run once, with 28 requests
paced at 13 seconds, no retries or fixture substitution, and exact deployment
identity. Its p90 latency was 9.223 seconds and every request completed within
the 90-second deadline. The final browser/critic-backed classification is
`ISSUES FOUND`, not PASS. Evidence is preserved under the ignored
`artifacts/chat-evals/2026-08-13T05-21-38-959Z*` files.

That run exposed three material defects now covered by local regressions in the
follow-up hotfix: stable fixture context did not disambiguate two legs between
the same clubs; current team-news prose could survive a zero-supported
verification abstention; and generated model/market prose could contradict
structured probabilities. It also exposed mutable request-history evidence,
which is now snapshotted by value. A 390x844 browser check reproduced the
fixture-context failure, found no console errors or horizontal overflow, and
confirmed New Chat reset. Screenshot capture itself timed out twice, so the
browser evidence correctly remains failed rather than claiming an image.

## Remaining release risks and authorization boundary

- Registry expansion remains disabled. Enabling it is a separate operational
  decision after source rights and `/data` persistence are verified. Friendly
  shadow collection also needs a separately reviewed private collector; the
  present flag only gates the policy library.
- Source update latency and cross-source conflict rates need a longitudinal
  shadow observation window; the read-only study cannot honestly certify them.
- The production evaluation has already consumed its one authorized run and
  cannot honestly be upgraded to PASS after code changes. The follow-up hotfix
  must pass CI, deploy, and pass deterministic production verification; another
  paced evaluator run requires fresh authority.
- The evaluator's season/SSE probes returned 503 because the season simulator
  had no usable preseason outlook. With no same-schema prior comparator these
  remain `INCONCLUSIVE`, not a proven regression.
- ClubElo was unavailable during release startup. Last-good persistence worked
  as designed, but the missing AEK Athens, LASK Linz, and Viking FK inputs left
  six fixtures unpriced.
- The MiniMax credential was inadvertently exposed in protected release-tool
  output. It was never copied into the repository or report, but it must be
  rotated after the authorized release work.

Release and one bounded production-evaluation authority was granted on
2026-08-13. This handoff records the exact evidence and the non-PASS production
classification without substituting fixtures or rerunning failed scenarios.
