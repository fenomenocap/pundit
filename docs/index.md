# Documentation index

Canonical in-repo docs for [Pundit](https://thepundit.vercel.app). GitBook publishes from this folder via [`.gitbook.yaml`](.gitbook.yaml) (`README.md` + `SUMMARY.md`).

## Product

| Page | Summary |
| --- | --- |
| [Welcome](README.md) | What Pundit is and where to start |
| [What is Pundit](getting-started/what-is-pundit.md) | Answer tiers, pricing vs recognition, non-betting scope |
| [How to use Pundit](getting-started/how-to-use.md) | Desk, paper lab, fixtures, model reference, evaluation UI |
| [Product vision](overview/product-vision.md) | Direction and design principles (not a betting stack) |
| [FAQ](support/faq.md) | Common questions |
| [Disclaimer](support/disclaimer.md) | Not a bookmaker; fair odds are `1/p` |

## How it works

| Page | Summary |
| --- | --- |
| [The model](how-it-works/the-model.md) | Fundamental v3, EPL calibration, champion vs registered challengers |
| [Data sources](how-it-works/data-sources.md) | ESPN, markets, artifacts, search, model vs market framing |
| [Chat engine](how-it-works/chat-engine.md) | Legacy production path vs eval-only agent tool-calling engine |
| [Model backtest](how-it-works/model-backtest.md) | Walk-forward EPL harness, gate, and promotion rules |

## API

| Page | Summary |
| --- | --- |
| [Overview](api-reference/overview.md) | Base URL, rate limits, cache envelopes, health |
| [Ask](api-reference/ask.md) | `POST /api/ask` streaming, grounding, verification |
| [Matches](api-reference/matches.md) | Fixtures, standings, recognized fixtures |
| [Model](api-reference/model.md) | Active probabilities and backtest gate |
| [Evaluation](api-reference/evaluation.md) | Club-season ledger and frozen WC backtest |
| [Polymarket reference](api-reference/polymarkets.md) | Legacy WC reference odds |

## Operations

| Page | Summary |
| --- | --- |
| [Environment variables](ops/environment-variables.md) | Names-only reference for API and web |
| [Chat eval runbook](ops/chat-eval.md) | Schema-17 certification, pinned gate, search replay |
| [Chat engine rollout readiness](ops/chat-engine-rollout-readiness.md) | Side-by-side daily eval gates before `CHAT_ENGINE=agent` in prod |
| [Production verification](ops/cloud-monitor.md) | `verify:prod`, diagnose playbook, automations |
| [Vercel access](ops/vercel-access.md) | Hobby team constraints |
| [Request completion](ops/request-completion.md) | Completion register governance (internal) |

## Architecture (research & history)

Dated handoffs and model research. Treat as historical unless linked from a current runbook.

| Page | Notes |
| --- | --- |
| [Model backtest detail (2026-10-16)](architecture/model-backtest-2026-10-16.md) | Full phase table and commands |
| [Model backtest xG (2026-10-16)](architecture/model-backtest-xg-2026-10-16.md) | Understat + StatsBomb offline pipeline |
| [Multi-source model foundation](architecture/multi-source-model-foundation.md) | Contributor boundaries, non-goals |
| [Prediction model improvement brief](architecture/prediction-model-improvement-brief.md) | Phase 0–3 narrative (Hull regression story) |
| [Prediction model review (2026-09-15)](architecture/prediction-model-review-2026-09-15.md) | Corrected rolling-origin evaluation |
| Other `architecture/*` dated files | QA, fixture recognition, prospective capture — superseded by shipped behavior where noted in-file |

## Repo root

| File | Role |
| --- | --- |
| [`README.md`](../README.md) | Developer quick start, deploy pointers |
| [`CLAUDE.md`](../CLAUDE.md) | Agent constraints and env summary |
| [`AGENTS.md`](../AGENTS.md) | Current product behavior and chat-eval cadence |
