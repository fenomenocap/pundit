# Conversation and browser certification regressions

Baseline: complete Schema-17 run `2026-09-14T10-02-34-543Z`, source `4bdb834afdc62e495a64c1dcbaa49aa13f25357f`. Evidence remains in the ignored evaluation artifacts; this patch does not amend the historical report.

The report records lost fixture context on third-club scorer turns and internal terminology in an ambiguous follow-up. The browser capture selected a different fixture from the API report, then timed out on a team-name alias. These are distinct product and harness defects; a safe clarification alone does not satisfy fixture retention or browser certification.

## Totals and risk language

The active Elo-to-goals calculation allocates a shared total of `2 * BASE_GOALS` (2.7) between the teams. The consensus mapping also preserves that total. This patch changes no forecast inputs, constants, probabilities or price thresholds. Totals copy explains the practical limitation once per answer containing totals: it cannot identify whether this particular fixture will be more open or tighter. Risk and edge labels describe estimated price disagreement and forecast uncertainty, including negative gaps; they do not establish that a positive return is real.

A future fixture-specific totals model is separate work. It requires dated attacking/defensive inputs, held-out calibration and scoring comparisons against the fixed-total baseline, leakage checks, model-version provenance and reviewed promotion. Wording changes are not evidence for promoting different mathematics.

## Local and production evidence

Targeted tests must first reproduce the observed failures, then pass alongside the full API, web and evaluator suites. Local mocks cannot establish live provider quality or current production certification. A new exact-SHA production run, browser capture and independent critic are still required after explicit approval; do not backfill the failed baseline or treat local success as production PASS.

## Local certification completed 2026-09-15 (SGT)

- API: 53 test files, 992 tests passed; API build and pinned-artifact verification passed.
- Web: 25 unit tests passed; production build, TypeScript check and full 37-test Chromium run passed, including desktop/mobile Desk and canonical cross-surface probability attributes with display aliases.
- Evaluator: 105 tests passed; API and browser dry-runs passed without production traffic. Deployment-SHA and Vercel ignored-build policy tests passed.
- Baseline reproductions: totals limitation regression failed before copy changes; Desk resolved-switch regression failed with the old pin; API scorer routing previously returned general/null; browser canonical-selection failure is recorded in the complete production baseline and covered locally by alias/order/fallback and timeout persistence tests.
- Independent local critic: PASS after fixing competition-neutral scorer history, avoiding redundant fixture requests, and rejecting capitalized conceptual topics as club switches. This is a code/test review, not a live generated-response evaluation.
- All changed clarification and scorer settlement branches are deterministic; targeted tests were repeated during integration. No live inference, deployment or production configuration changes were performed.

The initial full browser run exposed old fixture-ID and edge-label expectations (34 passed, two failed). Expectations now assert canonical IDs and the required plain-language definitions; the next complete run passed all 37 tests. The shared UI totals sentence was updated as well as API copy. No forecast mathematics or assertion of numerical provenance was loosened.

Production release remains pending explicit approval to push and deploy the final commit to Railway and Vercel, then run one paced Schema-17 evaluation, the cooldown-bound browser capture, a critic and finalization. Local evidence cannot guarantee live search availability, provider prose quality or that the evaluated fixture remains in the active window.

## Authorized production attempt: interrupted

The user approved SHA `0224c955d2bfcf2a832b18f67ab6ab03c7ad8e2e`. It was fast-forwarded to `main`; Railway deployment `2bdab572-d9d6-48d0-b06f-e998319a99ec` reached SUCCESS and both production version endpoints matched. Production verification and remote CI passed.

One paced evaluation began at `2026-09-14T17:45:42.293Z`. During it, an external `main` change (`4784eefbe7ebcabba0c874fe272575a786046a2b`, PR #186) triggered replacement deployment `3667ff8c-86f4-47be-87e7-b95fc9886902`. The approved container stopped at `17:49:43.819Z`; subsequent team-news/scorer requests received three 502 responses. Once the changed version was confirmed, this task terminated its evaluator. The checkpoint records 42 scenarios and 25 request starts, with minimum observed spacing 13,025.78 ms. It is incomplete, not certified. No browser chat capture, retry or backfill followed.

The captured golden-path third-club answer correctly retains Leeds–Newcastle and requests Liverpool’s opponent. A local reproduction identified a separate evaluator false negative: the direct-answer opening whitelist excluded this exact intentional clarification. The follow-up patch admits only the specific opponent-before-switch opening, with straight/curly apostrophe and alias tests; process preambles and unsupported scorer inference still fail. All 106 evaluator tests and the dry-run pass. This correction does not change the saved failed production checkpoint.

Artifacts: `2026-09-14T17-45-42-293Z.partial.json`, `.interruption.json`, and `.runtime-evidence.json` in ignored `artifacts/chat-evals/`. A fresh exact-SHA certification requires a coordinated stable deployment window and fresh approval; do not redeploy the old commit over the concurrent release.

## Follow-up local candidate

The unpushed correction was rebased onto concurrent release `4784eefbe7ebcabba0c874fe272575a786046a2b`, preserving its research changes. The partial independent critic reviewed all 22 saved HTTP-200 turns: it found no new numerical/capability regression but identified baseline-existing jargon in candidate and missing-input copy. Candidate and all non-priced notices now use direct first-person language while keeping typed capability reasons, no-probability behavior and citation protection unchanged. Candidate confirmation is explicitly not presented as sufficient for pricing.

The evaluator now tests every plain-language capability reason and still rejects wrong reasons and fabricated squad/lineup requirements. New copy tests failed before the fix. Final local verification: 54 API files / 1,003 tests pass; API build and artifact check pass; 107 evaluator tests and dry-run pass. The web source is unchanged from the prior complete 37-test browser / 25-test web-unit verification. No follow-up production actions were taken. All historical production artifacts remain unchanged; the independent partial review is saved as `.partial-critic.json` with no certification claim.
