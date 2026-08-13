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
| API behavior and deterministic regressions | `pnpm --filter api test` | PASS — 31 files, 362 tests |
| API types | `pnpm --filter api exec tsc --noEmit` | PASS |
| Web types | `pnpm --filter web exec tsc --noEmit` | PASS |
| Schema-9 evaluator | `pnpm chat-eval:test` | PASS — 32 tests |
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

## Remaining release risks and authorization boundary

- The branch has not been pushed or deployed. Source, Railway API, and Vercel
  web SHAs therefore intentionally do not yet converge on these changes.
- Registry expansion remains disabled. Enabling it is a separate operational
  decision after source rights and `/data` persistence are verified. Friendly
  shadow collection also needs a separately reviewed private collector; the
  present flag only gates the policy library.
- Source update latency and cross-source conflict rates need a longitudinal
  shadow observation window; the read-only study cannot honestly certify them.
- Production MiniMax search, retrieval, verifier behavior, latency, SSE, and
  browser follow-ups remain untested for this branch. The only authorized next
  evaluation is one artifact-preserving run, paced at least 13 seconds between
  requests, with no retries or fixture substitution.
- A release must verify terminal deployment state, replicas, health/readiness,
  `/data`, recognized fixtures, search status, runtime version, and exact
  source/API/web SHA convergence before any PASS claim.

Release and one bounded production-evaluation authority was granted on
2026-08-13. This handoff must be amended with exact production evidence before
the release is classified.
