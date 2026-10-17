# Chat engine

Pundit answers through **`POST /api/ask`**. Two engines share the same grounding, verification, and analyst response-facts contract (`ANALYST_RESPONSE_V2`); they differ in how non-deterministic prose is produced.

## Production default: legacy

Unless configured otherwise, production uses the **legacy** engine:

- Server-owned facts (match pricing desk, totals, BTTS, scorelines, tables, season outlook, capability notices) are **settled deterministically** before any language model runs.
- Evidence-required turns use bounded **OpenRouter** search (`openrouter:web_search` / Exa) and claim verification.
- The pinned answer model is **`deepseek/deepseek-v4-flash`** when `OPENROUTER_API_KEY` is set; **`MINIMAX_API_KEY`** is the fallback only when OpenRouter is unset and does not serve search.

This path is what users hit on [thepundit.vercel.app](https://thepundit.vercel.app) today.

## Eval-only: agent (`CHAT_ENGINE=agent`)

The **agent** engine is an LLM **tool-calling** loop over typed data-layer accessors (fixtures, model forecast, market odds and consensus, form, standings, federated team news, managers, players). It is intended for **evaluation and comparison**, not as the default production experience.

| Control | Behavior |
| --- | --- |
| `CHAT_ENGINE=agent` | Process-wide agent mode (non-production or explicit ops choice) |
| `CHAT_ENGINE` unset or `legacy` | Legacy engine (production default) |
| Header `X-Pundit-Chat-Engine: agent` \| `legacy` | **Eval-only** per-request override; honored when search replay scope is active **or** the deploy guard is active (unset `CHAT_ENGINE` defaults to legacy and matches explicit `CHAT_ENGINE=legacy` for header policy; live sweeps use the header without replay) |

Agent mode still respects the backtest **edge gate**: when `edgeValidationActive` is false, copy must not claim betting edge, value, or +EV from model-minus-market gaps (see [Model backtest](model-backtest.md)).

Implementation (for maintainers): `packages/api/src/services/chat-engine.ts`, `chat-agent.ts`, wired from `ask.ts`. Do not remove the legacy engine; it remains the supported production path until an explicit product decision says otherwise.

## Choosing an engine in eval

- Battle-test harness: set `CHAT_EVAL_ENGINE=agent` for an agent run (see [Chat eval runbook](../ops/chat-eval.md)).
- Search replay certification can combine replay fixtures with the eval header override to compare legacy vs agent on identical retrieved evidence.

## Promoting agent to production

Production stays on **legacy** until side-by-side daily chat eval meets the flip criteria in [Chat engine rollout readiness](../ops/chat-engine-rollout-readiness.md). Do not set Railway `CHAT_ENGINE=agent` from docs alone.

## Related

- [Ask API](../api-reference/ask.md)
- [Data sources](data-sources.md) — model vs market vs external analytics
- [Environment variables](../ops/environment-variables.md) — `CHAT_ENGINE`, inference keys
- [Chat eval runbook](../ops/chat-eval.md) — certification and dual-engine merge script
