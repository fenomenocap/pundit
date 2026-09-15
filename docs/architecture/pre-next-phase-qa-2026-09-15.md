# Pre-next-phase QA — 2026-09-15

Receipt after desk/chat hardening, evaluator integrity, and a documentation freeze. **Do not start a new model-shipping phase from this receipt.** The next allowed model work is recalibration after more official PL seals, or MLE work listed in [prediction-model-next-session.md](./prediction-model-next-session.md).

## What was checked (2026-09-15, after PR #186)

| Surface | Result |
|---|---|
| Railway API | `4784eefbe7ebcabba0c874fe272575a786046a2b`. Deployment `3667ff8c-86f4-47be-87e7-b95fc9886902`. This is [PR #186](https://github.com/fenomenocap/pundit/pull/186) on `main`. |
| Vercel web | `0224c955d2bfcf2a832b18f67ab6ab03c7ad8e2e`. Web did not rebuild for #186 because `packages/web` was unchanged. Same desk product as before the evaluator merge. |
| `/ready` | `ready`. Analyst V2 on. 11 active PL fixtures. Pin `clubelo@1:1da9aa95…`, age 1 day, refresh not due. Search: MiniMax only (Brave configured but disabled). `inference.dedicatedKey` false. Stake Cloudflare-blocked; Kalshi 0/11; Polymarket 11/11. |
| `/api/model/active` | All 11 rows Fundamental version `"2"`. Every Over 2.5 is **0.5064** (fixed-total 2.70 mapping). |
| `/api/evaluation/club-season` | 62 rows; **54** `pre-kickoff-90m-v1` / `scheduled_window` (40 PL, 14 UCL quals); 8 `legacy-transition-v0` excluded. Metrics `fixtureCount` **53** completed. Official `modelVersion` mix `"1"` (53) and `"2"` (1). First v2 seal: Leeds–Newcastle (`401879280`), still without a result in the ledger — do not count it in calibration n. |
| Evaluator tests (this tree) | Conversational architecture: 9/9 passed. Broader API run for #186: 54 files, 991 tests. |
| Chat grid settle | On production web `0224c95` / API `4784eef`: 1X2, O/U 2.5 (including `o2.5` / `U2.5`), BTTS, and scoreline boards settle from server facts. Unpriced markets must abstain, not dump the favourite. |

## Closed in product (desk + ask, already on production web)

- Analysis **desk** is the homepage (`/`). Legacy chat remains at `/legacy`.
- Paper (`/board`), Draft (`/draft`), and Vaults (`/vault`) are a **local paper lab**. Not a bookmaker, not a fund, not on-chain.
- Desk numbers come from the live model row (`pOver2_5`, form, scorers). MiniMax does not author 1X2.
- Priced-grid follow-ups (BTTS, totals, scorelines) no longer fall through to “favourite at 50%”.
- Schema-17 browser capture and chat-eval harness live under `scripts/`. Paid production eval is still manual, not CI.

## Closed in research (PR #186, production API, champion unchanged)

[PR #186](https://github.com/fenomenocap/pundit/pull/186) (`4784eef`):

- Chronological champion calibration and challenger eval (each origin refits).
- Paired weekly bootstrap; scheduled-window research gate; invalid-objective trainer rejection.
- Docs: [review](./prediction-model-review-2026-09-15.md), standing [next-session](./prediction-model-next-session.md), updated brief + cursor rule.

**This is not a production model change.** Constants, registration, and `model-data.ts` stay as shipped. Promotion remains blocked.

## Docs freeze (this follow-up)

Public and standing docs still described a chat-chip homepage and, in the old next-session file, a challenger Brier win. Those claims are corrected to: desk + paper lab, fixed-total 2.70, registered-not-activated MLE, PR #186 as production evaluator, and the 2026-09-15 review as the only promotion evidence.

Desk match chips now include `BTTS?` and `Over 2.5?` so the rail asks the markets the composer already settles.

## Still parked — next shipping phases

| Phase | Why it is parked |
|---|---|
| Recalibrate / promote MLE | Review forbids both until more held-out official PL seals **and** a human **promote**. |
| Odds API | EV% needs a captured decimal. Polymarket/Kalshi/Stake are mostly no-vig **p**. Stake public adapter remains Cloudflare-blocked. |
| `claim_id` / CLV | Needs sealed forecasts + results plumbing beyond the ledger UI. |
| Brave / dedicated inference key | Ops optional. Production search is MiniMax-only; `inference.dedicatedKey` is false. |
| Force-redeploy Vercel to `4784eef` | Unnecessary unless web files change; `/api/version` on Vercel staying at `0224c95` is expected after an API-only merge. |
| Davidson / Sarmanov / lineup features | After a fitted DC is champion, not before. |

## Known production honesty, not bugs

- Totals sit near 50% on every active row because every match uses 2.70 expected goals. Chat must keep saying so; do not sell Over 2.5 as match-specific insight.
- Stake public odds remain best-effort (Cloudflare has blocked the Stake adapter). Kalshi often has no matching fixtures. Polymarket coverage is the usual comparison source.
- `/ready` can show `rejectedDrafts` while V2 is on: invalid MiniMax drafts fall back to the server composer. That is the intended fail-closed path.
- Leeds–Newcastle is sealed as Fundamental `"2"` but is not yet a completed calibration row.
