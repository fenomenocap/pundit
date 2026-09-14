# Prediction-model next session

> **Superseded performance evidence (2026-09-15):** The full workflow was completed in one sitting. Read [the completed review](./prediction-model-review-2026-09-15.md). The old challenger rolling-origin figures below leaked held-out outcomes through full-corpus fitted parameters. Corrected evaluation does not support promotion. This handoff remains historical context.

**Handoff date:** 2026-09-14
**Production SHA:** `7a5df13` (Railway API + Vercel web)
**Purpose:** Operating plan for a better Fundamental. Not a new diagnosis. Read this first in a new session, then the full brief if you need the Hull / SIRE background.

Related: [`prediction-model-improvement-brief.md`](./prediction-model-improvement-brief.md) · [`.cursor/rules/prediction-model-improvement.mdc`](../../.cursor/rules/prediction-model-improvement.mdc)

---

## Already true — do not undo

- **Phase 0 shipped.** `eloToLambdas` is fixed total `2 * BASE_GOALS` (2.70) split by Elo odds ratio. Do **not** remake it. Do **not** restore geometric-mean λ. Hull vs Man United (`401879322`) is the regression story for why.
- **Shipped constants stay 1.35 / 42 / −0.1** until a better official-ledger fit *and* a human copy. `productionAutoLoad: false`.
- **Ledger seals.** Policy `pre-kickoff-90m-v1` keeps the first eligible forecast. 15-minute checkpoint + football-cadence tick. Railway `/data` is production truth. In-repo `packages/api/data/evaluation/club-season.json` stays an empty seed — never overwrite `/data` with it.
- **Phase 2 registered, not activated.** `REGISTERED_CHALLENGERS` has `dixon-coles-mle@4cfcbe57…`. `forecast` / `sampleScore` throw. `model-data.ts` still calls `ELO_CHAMPION` only. Chat still says Pundit Fundamental.
- **Phase 3 shipped, not the headline.** Labelled **Pundit Consensus** shrinks 1X2 halfway toward one complete same-source no-vig market, then `refitLambdasToTarget1x2`. Never present Consensus as Fundamental.
- **Leftovers shipped.** Season sim samples the Dixon–Coles score grid (ρ included). `PUNDIT_FUNDAMENTAL_MODEL_VERSION = "2"`. Desk uses server `pOver2_5`. Live pin `clubelo@1:1da9aa95…` (ranking date 2026-09-13). MiniMax never authors 1X2.

Promote the MLE challenger **only** if the rolling-origin gate says yes **and** a human says **promote**.

---

## What actually improves forecasts

One Elo cannot do attack vs defence, so totals and BTTS stay slaved to the 1X2 gap. The registered MLE challenger is the real Dixon–Coles (time-decayed attack/defence, ClubElo only as a prior for Hull-like clubs). It already wins Brier on the rolling-origin cuts; it failed promotion because calibration MAE was slightly worse on the first origin. That is the right gate.

Markets beat the champion on the live sample (no-vig Brier ~0.62 vs model ~0.67). That is expected. Do not silently blend books into Fundamental.

---

## Do this, in order

### 1. Seal this week, then recalibrate the champion

Leeds–Newcastle (2026-09-14T19:00Z) is the first Fundamental `"2"` seal candidate. After the weekend, Premier League official n should clear the 40 bar.

1. Confirm seals on production: `GET https://thepundit.up.railway.app/api/evaluation/club-season`
   Official rows are `checkpointPolicyId: "pre-kickoff-90m-v1"` + `checkpointReason: "scheduled_window"`. Ignore the 8 legacy post-kickoff rows.
2. Download that JSON to a research path (gitignored):

   ```bash
   mkdir -p packages/api/data/research/champion-calibration/ledgers
   curl -fsS "https://thepundit.up.railway.app/api/evaluation/club-season" \
     -o packages/api/data/research/champion-calibration/ledgers/production-YYYY-MM-DD.json
   ```

3. Fit. Never write `dixon-coles.ts` or Railway `/data`:

   ```bash
   pnpm --filter @sports-predict/api calibrate:champion -- \
     packages/api/data/research/champion-calibration/ledgers/production-YYYY-MM-DD.json
   ```

4. **Ship new 1.35 / 42 / −0.1 replacements only if** 1X2 Brier is clearly better (fitted + 0.005 < shipped) **and** bootstrap ΔBrier 10–90% lies entirely below 0 **and** PL official n ≥ 40. Last run (2026-09-14): fitted 1.40 / 0 / −0.115, Brier 0.666 vs 0.668, PL n=39. **Do not ship HFA=0.**

### 2. Refresh the ClubElo pin after each PL weekend

The champion is only as current as the pin. Runtime never scrapes ClubElo.

```bash
pnpm --filter @sports-predict/api refresh:clubelo-snapshot
pnpm --filter @sports-predict/api check:club-strength-freshness
```

Review the new `clubelo@1` artifact, commit, deploy. Monday CI (`clubelo-freshness.yml`) fails if the committed pin is ≥7 days old. `/ready` `ratingsRefreshDue` warns at 7 days; the 30-day gate still fails closed.

### 3. Retrain the MLE challenger on the same weekend’s results

ClubElo is a **prior** for promoted / low-sample clubs, not the living strength source.

```bash
pnpm --filter @sports-predict/api train:dixon-coles-mle -- --force
pnpm --filter @sports-predict/api eval:dixon-coles-mle
```

Historical join uses the last published From/To window on or before the UTC day before kickoff — ClubElo’s own number, not interpolation. Do not train on ESPN’s 7-day window.

Register a new artifact only if eval + a human agree. **Do not** wire `model-data.ts` to the challenger unless the user says **promote**.

Last eval: 1146 paired forecasts; challenger Brier better on all three origins (e.g. 0.586 vs 0.621); `recommendPromotion: false` / `activateProduction: false` because calibration MAE was slightly worse on the first origin.

### 4. Leave Consensus labelled

It is the sharper number vs books because it uses a book. Using it as the headline is the SIRE Meta Pairwise path, not a better Fundamental. MiniMax still authors no 1X2.

---

## Do not do

- Ship HFA=0 or any Phase 1 fit that loses on 1X2 Brier / bootstrap.
- Promote on Brier alone.
- Blend Stake / Kalshi / Polymarket into Fundamental.
- Let MiniMax write probabilities.
- Remake Phase 0 or restore geometric-mean λ.
- Train on ESPN’s 7-day window.
- Overwrite Railway `/data` with the in-repo empty seed.
- Scrape live ClubElo at runtime.
- Clone Kelly, PnL promotion, LLM-authored 1X2, aVault, or on-chain.

---

## Later — only after the fitted DC is champion

- **Davidson** as a cheap 1X2-only sanity check (cannot replace the score matrix).
- **Sarmanov / NegBin** for totals / BTTS overdispersion.
- Recapture dated ClubElo if the API recovers (`capture:clubelo-history` → `build:clubelo-pre-kickoff` → train/eval) so last-known windows are shorter than the tonyelhabr 2026-01-14 cutoff.
- UCL qualifying completeness and regulation-time scoring are unresolved and must **not** drive promotion.

---

## Evidence to re-check at session start

| Surface | What to confirm |
|---|---|
| `GET /ready` | `ratingArtifactId`, `ratingsAgeDays`, `ratingsRefreshDue`, `version.sha` |
| `GET /api/model/active` | `forecastProvenance.modelVersion` is `"2"`; constants 1.35 / 42 / −0.1 |
| `GET /api/evaluation/club-season` | Official n, PL n, `modelVersion` of new seals |
| `REGISTERED_CHALLENGERS` | Still one challenger; `forecast` still throws |
| `model-data.ts` | Still `ELO_CHAMPION.forecast` only |

If the user says **promote**, switch production forecasts to the registered MLE only after reading the latest `eval:dixon-coles-mle` report and stating the gate result in the PR.
