# Prediction-model improvement brief

**Status:** Working analysis, not current production behaviour.  
**Dates:** Engine diagnosis 2026-08-21 · SIRE comparison 2026-08-22 · Next-action decision 2026-08-24  
**Regression example:** Hull City vs Manchester United (golden fixture `401879322`)

Any later plan or implementation must take this whole brief into account. Do not restart the diagnosis from a blank slate. Do not “improve the model” in a way that contradicts the constraints below.

Related code: `packages/api/src/services/dixon-coles.ts`, `model-contributors.ts`, `model-data.ts`, `club-ratings.ts`, `club-strength-artifact.ts`, `club-strength-cutover.ts`, `season-simulator.ts`, `model-market-odds.ts`, `fixture-market-sources.ts`, `packages/api/data/model-artifacts/clubelo/`.

Related product docs: `docs/how-it-works/the-model.md`, `docs/architecture/multi-source-model-foundation.md`.

---

## 1. Product split (do not collapse)

Two independent systems, one score grid.

| System | Owns | Does not own |
|---|---|---|
| **Pundit Fundamental (the model)** | Sealed probabilities: ratings → expected goals → score matrix → 1X2, O/U 2.5, BTTS, correct scores, season sim | Injuries, lineups, news, market juice |
| **MiniMax** | Commentary on sealed numbers; current evidence (injuries, lineups, news) | 1X2 / totals / BTTS / scoreline probabilities |

The model is highest leverage because **every bet type is a sum over the same grid**. Fix the grid once; all markets move together.

MiniMax synergises by talking about honest numbers. It is not SIRE’s “LLM is the engine.” Complete match grounding already bypasses MiniMax. Do not change MiniMax to improve the model. Change `eloToLambdas`.

Pundit “betting odds” are **fair prices** `decimal = 1 / p`. They are not a bookmaker card. Books add ~5–8% 1X2 overround. Stake / Kalshi / Polymarket are **comparison-only** no-vig 1X2. They do not enter the Fundamental forecast.

---

## 2. What the engine actually is

Pundit is **not** a fitted Dixon–Coles attack/defence model. It is:

1. ESPN fixture → registry **gate** (identity, venue, policy; no numeric inputs).
2. Pinned `clubelo@1` Elo lookup (`eng-clubs` / `uefa-clubs`). Runtime never contacts ClubElo.
3. Home-field advantage: `DEFAULT_HOME_ADVANTAGE_ELO = 42` if the competition has `homeFieldAdvantage` **and** the venue is not neutral; else 0. Applied to **Premier League and UCL qualifiers** (docs that say PL-only are stale).
4. Hand-tuned `eloToLambdas()` → expected goals.
5. Independent Poisson 0–10 score grid, Dixon–Coles `tau` on `{0,1}×{0,1}`, then renormalise.
6. 1X2 / O/U 2.5 / BTTS / top scores are **sums over that same grid**.
7. Markets are comparison-only.
8. Champion contributor: `clubelo@1` / `clubelo-elo-to-goals-dixon-coles`. `REGISTERED_CHALLENGERS` is empty. Architecture can swap engines without touching chat.

Frozen constants (not estimated at runtime):

| Constant | Value | Role |
|---|---|---|
| `ELO_SCALE` | 400 | Standard Elo scale |
| `BASE_GOALS` | 1.35 | Per-team xG when ratings are equal (2.70 total) |
| `DEFAULT_HOME_ADVANTAGE_ELO` | 42 | On/off HFA |
| `RHO` | −0.1 | Low-score correction; tiny on mismatches |
| `LAMBDA_CAP` | 5 | xG ceiling |
| `MAX_GOALS` | 10 | Truncate then renormalise |

Production artifact at analysis time: `clubelo@1:2da1616b…`, snapshot **2026-08-12**. Golden cutover `golden-cutover-v1.json` **locks 18 fixtures**, including Hull vs Man United.

Season outlook uses `simulateMatch()` = **plain independent Poisson**, not `rho`. Docs claim the same Dixon–Coles engine; that is a small inconsistency.

### Layman version

1. Look up how strong each club is from a frozen ClubElo snapshot.
2. Give the home team a small bump (+42 Elo), unless the venue is neutral.
3. Turn that gap into “how many goals each side is expected to score.” Equals get 1.35 each (2.7 total). The current formula *multiplies* one side and *divides* the other, so blowouts inflate total goals.
4. List every score from 0–0 to 10–10, weight them, and add them up. Every market comes from that list. Injuries, rest, lineups, and form since the snapshot are **not** inside the number.

---

## 3. Core defect

`eloToLambdas` keeps the **geometric** mean of lambdas at 1.35:

```
f = 10^(((eloHome + HFA) - eloAway) / 800)
lambdaHome = min(1.35 * f, 5)
lambdaAway = min(1.35 / f, 5)
```

The **ratio** `lambdaHome / lambdaAway = 10^(d/400)` is Elo-consistent. The **sum** is not: `f + 1/f ≥ 2`, so mismatches **inflate total xG**. Close games look fine; blowouts become both more one-sided **and** higher-scoring than football (or ClubElo’s own two-way formula).

ClubElo two-way (no draw) on gap `d`: `1 / (1 + 10^(-d/400))`. A rating-faithful 1X2 after draws is typically milder than the Poisson grid.

There is **no attack/defence split**. One Elo cannot represent high-event vs low-event teams; BTTS and totals are slaved to the 1X2 gap.

---

## 4. Hull City vs Manchester United (worked example)

Golden fixture `401879322`, `eng.1`, Hull home. Use this as the regression / communication example.

### Component breakdown

| Input | Value |
|---|---|
| Hull `eng-clubs` Elo | 1532.880 (Championship mid-table; Swansea 1536 / Wrexham 1527) |
| Man United Elo | 1915.316 (4th English; Villa 1921 / Liverpool 1911) |
| Raw gap | −382.4 |
| Hull + HFA 42 | 1574.880 |
| Effective `d` | **−340.436** |
| `f` | 0.3754 |
| Hull xG / United xG | **0.507 / 3.596** |
| Total xG | **4.10** (equals would be 2.70; **+1.40 goals are mapping artefacts**) |
| `tauNorm` | ≈ 0.999 |
| Hull scores in a match | ≈ 40% (`1 − e^(−0.51)`) |

HFA is not the bug. No-HFA counterfactual: United **94.2%**, total xG **4.51**.

### Current production / golden output

Fair odds are `1 / p`, not a juiced book.

| Market | Probability | Fair decimal | Fair American |
|---|---|---|---|
| Hull win | 0.0201 (2.0%) | 49.8 | +4880 |
| Draw | 0.0696 (7.0%) | 14.4 | +1340 |
| United win | 0.9103 (91.0%) | 1.10 | −1010 |
| Over 2.5 | 0.7764 (77.6%) | 1.29 | −347 |
| Under 2.5 | 0.2236 (22.4%) | 4.47 | +347 |
| BTTS yes | 0.3896 (39.0%) | 2.57 | +157 |
| BTTS no | 0.6104 (61.0%) | 1.64 | −157 |

Top scores: **0–3 12.82% (7.80), 0–4 11.53% (8.67), 0–2 10.70% (9.35), 0–5 8.29% (12.06), 1–3 6.50% (15.39)**. Combined 0–2 / 0–3 / 0–4 / 0–5 ≈ 43%.

`rho` barely matters here:

| | Hull | Draw | United |
|---|---|---|---|
| Poisson `rho=0` | 2.31% | 6.35% | 91.34% |
| Dixon–Coles `rho=-0.1` | 2.01% | 6.96% | 91.03% |

If United were **home** vs Hull: lambdas **4.58 / 0.40**, **96.5% / 2.9% / 0.6%**, over 2.5 **87%**. Mapping asymptote, not a football forecast.

Equals +42 HFA (sane region): **43.6% / 27.7% / 28.7%**, over 2.5 **51%**, top score 1–1.

ClubElo two-way on `d = -340`: United beats Hull **87.7%** with no draws. A rating-faithful three-way is roughly **United 73–80% / draw 14–18% / Hull 4–8%**, not 91 / 7 / 2.

BTTS is only 39% despite 4.1 total xG because almost all goals are on United’s side.

---

## 5. Other findings

- Product around the model (artifact pin, fail-closed ratings, deterministic grounding, market comparison, empty challenger slot) is **stronger than the maths**.
- Repo `packages/api/data/evaluation/club-season.json` had **zero** completed snapshots at analysis time. Live ledger is on Railway `/data`. You cannot yet score club-season calibration from the repo copy.
- Frozen WC 2026 backtest (same mapping, neutral venues): 104 matches, Brier **0.4383**, log-loss **0.7853**, winner accuracy **68.3%**. Includes the same 90%+ blowouts (e.g. Mexico vs South Africa 91.7%). Calibration buckets in that artifact look unusable (`actualRate: 1` in every bin).
- `docs/how-it-works/the-model.md` HFA wording (PL only) disagrees with `competitions.ts` (UCL qualifiers also true).

---

## 6. SIRE documentation comparison

Sources read in full:

- https://docs.sire.bot/research-and-development/sire-intelligence-data-science-report
- https://docs.sire.bot/research-and-development/the-multi-source-prediction-engine
- https://docs.sire.bot/how-it-works/editor-1 (GitBook draft slug; this is their Architecture page)

Also used for frame: About SIRE, How-it-works Overview, `docs/architecture/multi-source-model-foundation.md`.

### What SIRE is

SIRE is a **betting stack** (agentic on-chain sports-betting hedge fund): aVault execution, aLink terminal, fractional Kelly, +EV. Pundit is a **chat-first analysis stack**. The useful overlap is the statistical menu. The rest is a product Pundit already pivoted away from (`archive/onchain-trading-v1`; CLAUDE.md: no blockchain, database, or trading).

Four in-house 1X2 baselines they actually built:

| Model | What it is | Vs Pundit |
|---|---|---|
| Elo | 1X2 from rating difference (no score grid required) | Milder than our geometric λ mapping |
| Davidson | Bradley–Terry + draw; MLE for strength, HFA, draw param | Not present; optional later 1X2 challenger |
| Dixon–Coles | **Fitted** attack/defence + low-score τ | Name only here; empty `REGISTERED_CHALLENGERS` |
| Sarmanov | Bivariate NegBin, overdispersion + correlation | Not present; later than fitted DC |

Meta models **include bookmaker implied probability**:

- Meta Pairwise = Elo + Davidson + market. Claimed +32.96% bankroll over two top-5-league seasons; Kelly + edge threshold did a lot of that work.
- Meta Logistic = all four + market + team stats. Grid-search best cell **+370.3% on draws**; they admit the path is unstable even at 30% Kelly.

They then argue traditional models are “noise,” pivot to LLM “orthogonal signals,” and cite a Club World Cup **3x bankroll tweet** (not a method). Multi-source engine is **planned**: contributor packets (models, VLA/PVF from Bittensor SN44, humans), LLM fusion, random slot subsets, packets scored on **PnL**, up/down-weighted. Architecture (`editor-1`) writes the same loop as if operational (retrain/redeploy into aLink/aVault, on-chain). Packet scoring disagrees across pages (PnL vs calibration/Sharpe/IV). Overview says vision and multi-source optimisation are still in development.

### Honest read

- “Traditional models are noise” is a **betting** claim against sharp books, not a reason to skip fixing Hull 91% / 4.1 xG.
- They still needed the four baselines; the meta that “works” **is those models plus the book**. That is why Fundamental (no market) and Consensus (market allowed, labelled) must stay split.
- +370% on draws is a grid-search/Kelly artifact they themselves flag. Do not copy ROI headlines as a success metric.
- Their Dixon–Coles = our Phase 2. Their Elo would not have produced 0–5 as a top score.
- Internal contradictions: engine is past-tense vs planned; packet score = PnL vs calibration; architecture written as live vs Overview “in development.” Use the statistical section; do not treat the seven-step loop as a build spec.

### Mapping (do not collapse)

| Layer | SIRE | Pundit now |
|---|---|---|
| Purpose | +EV, Kelly, aVault | Fair `1/p` analysis |
| Elo | 1X2 from rating gap | ClubElo pin + geometric λ (the defect) |
| Dixon–Coles | Fitted attack/defence | Elo→goals + ρ garnish |
| Market | Feature inside the meta | Comparison-only no-vig |
| Ensemble | Meta Pairwise / Logistic | Named Consensus, not built |
| Multi-source | LLM + PnL packet weights | Typed contributor + sealed ledger + human promotion |
| LLM | Generates / fuses forecasts | MiniMax for current prose; complete match answers bypass it |
| Evaluation | Bankroll, ROI, live PnL | Brier / log-loss / calibration; in-repo club-season ledger empty |
| Train data | Implied years of top-5 leagues | PL corpus gate passed; chronological ClubElo blocked; UCL incomplete |

Pundit already has the **responsible** version of their architecture. `docs/architecture/multi-source-model-foundation.md` already lists SIRE-shaped ideas as **explicit non-goals**: no LLM probabilities, no PnL-only promotion, no autonomous champion switch, no betting execution, no new DB.

### What SIRE changes about the plan

- Does **not** replace Phase 0. Does **not** justify delaying the mapping fix for an LLM.
- Sharpens Phase 2 as “their Dixon–Coles.” Optional Davidson; Sarmanov later.
- Phase 3 Consensus ≈ Meta Pairwise **with a label**. Their +33% story is the exhibit for why Consensus must stay a second number.
- Empty club-season volume is the live-eval gap, not a missing LLM.

---

## 7. Phased recommendation (execute in order)

Keep: ClubElo pin, contributor boundary, deterministic match grounding, labelled market comparison, MiniMax as commentary-only.

### Phase 0 — fix Elo→goals mapping (do this first)

**Decision already recommended:** fixed total **2.70** xG + Elo odds ratio. Leave mild inflation for Phase 1, when ledger volume exists to fit it.

```
r = 10^(d / 400)
lambdaHome + lambdaAway = 2.70
lambdaHome / lambdaAway = r
→ lambdaHome = 2.70 * r / (1+r)
  lambdaAway = 2.70 / (1+r)
```

Hull vs United under the same ratings / HFA / DC grid:

| | Current (golden) | Fixed-total 2.70 | Mild inflation (~3.12 xG) |
|---|---|---|---|
| Hull / United xG | 0.51 / 3.60 | 0.33 / 2.37 | 0.39 / 2.74 |
| 1X2 | 2.0 / 7.0 / **91.0** | 3.3 / 14.2 / **82.5** | 2.8 / 11.4 / 85.8 |
| Fair 1X2 | 49.8 / 14.4 / **1.10** | 30.7 / 7.0 / **1.21** | 35.4 / 8.8 / 1.17 |
| Over 2.5 | **77.6%** | **50.6%** | 60.3% |
| BTTS | 39.0% | 26.2% | 30.4% |
| Top scores | 0–3, 0–4, 0–2 | **0–2, 0–1, 0–3** | 0–2, 0–3, 0–1 |

Still a big United favourite; scorelines and totals stop looking like a video game. Close games barely move. After deploy, chat and `/model` pick this up automatically because they read the same grid.

**This will fail `golden-cutover-v1.json` on purpose.** Rebuild the golden from the new mapping. Align `simulateMatch` with the same lambdas (and `rho` if docs should stay true). Update tests that pin the Python-source 2050 vs 1750 1X2.

### Phase 1 — calibrate

Once the rolling pre-kickoff ledger has volume: fit `BASE_GOALS` per competition; fit HFA (Elo points or Dixon–Coles `gamma`); fit `rho`; optionally a **fitted** mild total-xG inflation vs mismatch (not raw `f+1/f`). Metrics: 3-way Brier / log-loss vs market no-vig, plus 1X2 and O/U 2.5 reliability **segmented by Elo gap**.

### Phase 2 — real Dixon–Coles challenger

Register behind `REGISTERED_CHALLENGERS`: time-decayed attack/defence MLE; ClubElo as **prior** for promoted / low-sample clubs (exactly Hull). This is what SIRE means by Dixon–Coles, not production `eloToLambdas`. Keep current champion until the challenger wins on the ledger.

Optional extra (not a Phase 0 detour): **Davidson** as a cheap 1X2-only challenger (fitted strength, HFA, draw param). Useful as a 1X2 sanity check. It cannot replace the score matrix chat needs.

**Sarmanov / NegBin is later than DC** — overdispersion for totals/BTTS once attack/defence exist.

Corpus gate (2026-08-10): PL-only offline training is imaginable; fair champion vs challenger remains blocked until chronological pre-match ClubElo exists. UCL qualifying completeness and regulation-time scoring are unresolved. ESPN’s 7-day window cannot train a fitted DC.

### Phase 3 — market as a second labelled number

Never silently average Pundit and Stake into one probability called “the model.” Keep **Pundit Fundamental** vs **market (no-vig)**. Optional **Pundit Consensus** ≈ SIRE Meta Pairwise and must stay labelled. If 1X2 is shrunk toward market, **refit lambdas** so totals and correct scores stay consistent.

---

## 8. What not to start now

Do not start fitted Dixon–Coles, Davidson, Sarmanov, Consensus blending, injury features, or MiniMax-authored 1X2 until Phase 0 is in production and the rolling ledger has something to score. Those need a chronological ClubElo corpus, a non-empty club-season ledger, or they violate the model / MiniMax split.

---

## 9. Hard constraints

- Do **not** scrape live ClubElo at runtime. Refresh via reviewed release artifacts (consider 7-day cadence later if form lag hurts).
- Do **not** put injuries/lineups into the numeric model without a dated sourced feature feed. Chat already handles that in prose.
- Do **not** add Asian lines / player props on top of the current geometric mapping; they inherit blowout bias.
- Do **not** sneak around the golden cutover; replace it when Phase 0 lands.
- Preserve exact public capability reasons and deterministic grounded-response contracts.
- Fair odds in user-facing copy are `1/p`, not a juiced book.
- Do **not** import from SIRE: LLM-authored 1X2, PnL packet weighting, Kelly sizing, random slot dropout as a production estimator, VLA/PVF/Bittensor, aVault/aLink, on-chain, autonomous retrain/deploy, Sportsmonks-style paid feeds as a substitute for a fitted local model, or ROI headlines as a promotion metric.
- Do **not** reopen trading / blockchain / Prisma without an explicit product discussion. Standing repo rule.

---

## 10. Bottom line

The product shell is ahead of the maths. Hull vs United shows why: a real 340-Elo gap is turned into **4.1 xG and a 1.10 favourite**. SIRE confirms the missing maths is fitted 1X2 (Davidson) and fitted goals (real DC, later Sarmanov), and that markets belong in a **labelled** ensemble, not the champion.

**Next action:** implement Phase 0, fixed total 2.70. Then fit. Then estimate attack/defence with ClubElo as the prior. Keep MiniMax independent. Do not clone the betting stack.
