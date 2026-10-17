# Chat engine rollout readiness (`CHAT_ENGINE=agent`)

Production remains on **legacy** until the checks below pass on scheduled **Daily Chat Eval** side-by-side runs (legacy hard-gated, agent report-only). Do not flip Railway `CHAT_ENGINE` from this document alone.

## Flip criteria

| Gate | Requirement |
|------|-------------|
| Deterministic monitor | Pinned gate **16/16** on every daily run (unchanged). |
| LLM judge overall | Agent **≥ legacy** on the same scenario set (`llmJudgeSummary.score` and `agentEval.llmJudgeSummary.score` in merged report). |
| Citations | Agent `citationCoverage` **≥ legacy** in `engineQualityComparison`. |
| Abstain discipline | Agent `abstainRate` not materially lower than legacy when news tools return empty (avoid silent invention). |
| Latency / cost | Agent p90 ask latency and OpenRouter spend per turn tracked in sweep artifacts; no sustained regression vs legacy without quality gain. |
| Structural templates | Agent `templateShare` (structural markers only — excludes 18+ compliance boilerplate) **≤ legacy** or justified by judge gain. |

## How side-by-side eval runs

- Workflow: [`.github/workflows/chat-eval-daily.yml`](../../.github/workflows/chat-eval-daily.yml) — cron **09:05 UTC**, default `workflow_dispatch` mode **both**.
- Legacy sweep: full certification path, output under `artifacts/chat-evals/legacy/`.
- Agent sweep: `--non-gating`, eval headers `x-pundit-chat-eval-search-replay` + `x-pundit-chat-engine: agent`, output under `artifacts/chat-evals/agent/`.
- Merge: `scripts/merge-dual-engine-chat-eval.mjs` writes `latest-run.json` with `engineQualityComparison` and dual judge summaries (uses repo `OPENROUTER_API_KEY` secret in Actions).

## Baseline snapshot (pre-fix, production @ `541f8e4`)

Measured with eval-only agent override (no production `CHAT_ENGINE` flip):

| Metric | Legacy | Agent | Notes |
|--------|--------|-------|-------|
| citationCoverage | 8.5% | 5.7% | Agent must improve link density on news turns. |
| templateShare (old classifier) | 14.1% | 50.0% | Inflated by mandatory 18+ / “no bet” compliance; daily metrics now use structural markers for agent turns. |
| abstainRate | 7.0% | 5.7% | Watch for under-abstaining on empty search. |
| nearDuplicateRate | 2.8% | 1.9% | — |
| LLM judge | n/a | n/a | Prior VM run lacked `OPENROUTER_API_KEY`; Actions secret is authoritative. |

## Fixes in flight (agent path)

- **Fixture lookup:** `findModelFixtureByPublicRef` accepts `espn:comp:id` (match grounding id), spine `comp:id`, and model fixture keys — fixes `model_fixture_not_found` on O/U questions when the model passed ESPN ids to tools.
- **Probability guard:** `finalizeChatAgentAnswer` strips percentages not on the Fundamental sheet for priced fixtures.
- **Seeded Fundamental block:** match turns preload Fundamental vs market consensus JSON before tool loop.
- **Prompt:** separate Fundamental vs market; require markdown citations from search tools; abstain on empty search.

## Recommendation log

| Date | SHA | Recommend flip? | Reason |
|------|-----|-----------------|--------|
| 2026-10-17 | _(pending merge)_ | **Not yet** | Side-by-side daily eval with judge not run on fixed agent; citation and abstain gaps vs legacy. Revisit after first green **both** sweep post-merge. |
