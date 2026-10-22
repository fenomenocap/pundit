# Methodology and data sources

Status: current as of 22 October 2026 (origin/main, API package). This page describes how Pundit produces its football forecasts, which data it uses, what market prices are used for, how the model has been calibrated and tested, and where it is known to be weak. All times are UTC unless marked SGT (UTC+8).

## 1. Summary

1. Every forecast for a match comes from **one score grid**: a probability for every scoreline from 0-0 to 10-10. The 1X2, totals (over/under 2.5), both-teams-to-score (BTTS), expected goals and most-likely scorelines are all read from that same grid, so they cannot contradict each other.
2. Team strength comes from **ClubElo** ratings, captured offline and pinned by content hash. The service never calls ClubElo at runtime.
3. For the Premier League, the **shape** of the grid (how many goals, how they split, how often low scores occur) comes from a goal-rate model fitted to past Premier League results. The **1X2** comes from the Elo ratings. The goal-rate grid is rescaled so that its 1X2 equals the Elo 1X2 ("outcome anchoring").
4. **Market prices are not a model input.** Exchange and bookmaker prices are fetched for comparison and display only.
5. Two pinned inputs expire after 30 days and must be refreshed by hand: the EPL goal calibration (expires **2026-11-06 00:00 UTC, Fri 6 Nov 08:00 SGT**) and the ClubElo ratings pin (expires **2026-11-19 11:52 UTC, Thu 19 Nov 19:52 SGT**). A daily check alerts 7 days before each date (section 8).

## 2. Data sources

| Source | URL | Refresh cadence | What it feeds | Model input? |
|---|---|---|---|---|
| ClubElo ratings (live snapshot) | `http://api.clubelo.com/YYYY-MM-DD` (capture script only) | Manual capture, build, verify and deploy; target weekly; hard expiry 30 days after capture | Team strength for every club fixture (`packages/api/data/model-artifacts/clubelo/`, selected by `production.json`) | Yes |
| ClubElo history (daily mirror) | `https://github.com/tonyelhabr/club-rankings` (release `clubelo-club-rankings.csv`) | Offline, at calibration time only | Ratings dated before kickoff for calibration and backtest rows | Calibration only |
| football-data.co.uk Premier League results | `https://www.football-data.co.uk/mmz4281/<season>/E0.csv` (2425, 2526, 2627) | Offline, at calibration time only | Final scores used to fit and test the goal calibration (`model/calibration-2026-10-22/raw/`) | Calibration only |
| ESPN site API: scoreboard and standings | `https://site.api.espn.com/apis/site/v2/sports/soccer/...`, `https://site.api.espn.com/apis/v2/sports/soccer/...` | Every 30 min; 10 min on match day; 2 min while a match is live | Fixture list, kickoff times, results, form, league table, 21-day active window. Also the source of the 2018–2026 results used by the earlier (7 Oct) calibration | Fixtures only (which matches to forecast) |
| Kalshi | `https://api.elections.kalshi.com/trade-api/v2/events` | Every 30 min; 10 min on match day; 5 min live | Market 1X2 comparison | No |
| Polymarket (gamma) | `https://gamma-api.polymarket.com/events`, `/public-search` | As Kalshi | Market 1X2 comparison | No |
| Stake | `https://stake.bet/_api/graphql` | As Kalshi | Market 1X2 comparison | No |
| Fantasy Premier League | `https://fantasy.premierleague.com/api/bootstrap-static/` | Per dossier build | Injuries and availability in match dossiers | No |
| Premier League (pulselive) | `https://footballapi.pulselive.com/football/fixtures/<id>` | Per dossier build | Fixture identity in match dossiers | No |
| FotMob | `https://www.fotmob.com/api/data/matchDetails?matchId=<id>` | Per dossier build | Injuries and doubts in match dossiers | No |
| eloratings.net | `https://www.eloratings.net/` | Retired | The former World Cup model only | No (retired) |

Notes:
- The file `packages/api/src/services/football-data.ts` is named for historical reasons. It calls ESPN, not football-data.co.uk.
- The forecast cache is recomputed every 60 minutes normally, 30 minutes on match day and 15 minutes while a match is live (`packages/api/src/config/freshness-policy.ts`). Ratings and calibration do not change between manual re-pins, so a recompute only reflects new fixtures and clock-driven expiry.
- No source requires a paid licence. No API key is used for any model input.

## 3. How a forecast is computed

The code path is `packages/api/src/services/active-score-model.ts`.

### 3.1 Ratings and home advantage
- Each club's rating is read from the pinned ClubElo snapshot for the competition's profile (`eng-clubs` or `uefa-clubs`).
- The home side receives **+42 Elo** unless the venue is neutral.
- Elo is slow-moving by design: it carries several seasons of history, so a side low in the current table can still be rated above a side higher up.

### 3.2 1X2 (home, draw, away)
1. The Elo gap `d = home + 42 − away` gives an odds ratio `r = 10^(d/400)`.
2. A fixed total of **2.70 goals** is split as home `2.70·r/(1+r)`, away `2.70/(1+r)`, each capped at 5.
3. A Dixon–Coles grid with low-score correction **ρ = −0.10** is built over 0..10 goals and renormalised.
4. The home-win, draw and away-win probabilities of this grid are **the published 1X2**, for every competition.

### 3.3 Goal shape (Premier League only)
For non-neutral Premier League fixtures with kickoff on or after 2026-10-22 (the activation origin of the current pin; 7–21 Oct fixtures used the retired pin `a502e436…`), the grid shape comes from the pinned goal calibration (`packages/api/data/model-artifacts/epl-goal-calibration/<sha256>.json`):
- Total expected goals = `exp(intercept + effect_home + effect_away)`, with team effects shrunk toward zero.
- Home share = `sigmoid(slope · ln10 · (Elo_home − Elo_away)/400 + homeOffset)`.
- A Dixon–Coles grid is built from these two rates with the fitted ρ.

Pinned coefficients (artifact `02d8bbcd…`, origin 2026-10-22): intercept 1.040, slope 0.532, home offset 0.237, ρ −0.06, 180-day half-life weighting, team precision 100, 3,110 results through 2026-10-19 (1,101 with a pre-kickoff rating). The retired pin `a502e436…` was intercept 1.030, slope 0.623, home offset 0.212, ρ −0.11 (3,090 results through 2026-09-20).

If the calibration is missing, invalid or expired, Premier League rows **fail closed**: they are not published. There is no silent fallback.

### 3.4 Outcome anchoring
The goal-shape grid is rescaled inside each outcome region (home win, draw, away win) so the three regions sum to the 1X2 from 3.2. The relative probabilities of scorelines inside each region are preserved (`outcome-anchored-score-grid.ts`).

Consequence: the published expected goals are the **means of the anchored grid**, not the rates that produced it. For Arsenal v Everton on the 20 Oct pin, the goal model alone gives 1.90–0.67; after anchoring to the more confident Elo 1X2 the grid means are 2.12–0.56.

### 3.5 Markets derived from the grid
| Market | Computation |
|---|---|
| 1X2 | Sum of grid cells where home > away, home = away, home < away |
| Over/under 2.5 | Sum of cells with total goals ≥ 3 |
| BTTS | Sum of cells with both scores ≥ 1 |
| Expected goals (labelled xG) | Mean home and away goals of the grid. This is the model's expected goals, **not** shot-based xG |
| Most likely scorelines | The five largest cells |

The web client re-derives each published market from the grid and refuses to display a row if any differs by more than 5×10⁻⁵.

### 3.6 Season simulation and paper scores
- The season simulator samples from the same grids with a seed derived from its inputs, so results are reproducible.
- "Paper" scores in the desk lab are single random draws from a grid. They are simulations, not projections; the most likely scoreline is the modal cell (3.5).

## 4. What market prices are used for
- Kalshi, Polymarket and Stake prices are fetched into a separate `oddsSources` field and shown next to the model for comparison.
- Prices are converted to no-vig probabilities for display. They are **never** blended into the model, used to fit it, or used to choose between model variants.
- "Pundit Consensus", where shown, is a separate, labelled, market-adjusted view and is not the model.
- Statements that the model has an "edge" over the market are not published (`MODEL_EDGE_CLAIMS_ALLOWED=false`).

## 5. Calibration

### 5.1 Production pins
**Current: `02d8bbcd…` (22 Oct 2026).** Method `outcome-anchored-shrunk-goals-v2`, origin 2026-10-22T00:00Z, expires 2026-11-21T00:00Z. Built by `scripts/build-epl-goal-calibration-2026-10-22.ts` from the #404 configuration (every EPL result from 2018/19 through 24 hours before the origin, decay 180, precision 100). Every source, training and evaluation file it cites is in git; the receipt is `model/epl-pin-2026-10-22/pin-receipt.json`. The 1X2 temperature flag is not part of the pin and stays OFF. Changing the pin moves no published 1X2 (the grid is anchored to the Elo 1X2); it changes totals, BTTS, expected goals and scorelines.

**Retired: `a502e436…` (7 Oct 2026).** It is kept in `EPL_GOAL_CALIBRATION_PINS`, so the 7–21 Oct forecasts built under it still replay and score.
- Artifact `a502e436…`, method `outcome-anchored-shrunk-goals-v2`, origin 2026-10-07T00:00Z.
- Training: ESPN Premier League results 2018-19 to 2026-27 (3,090 matches through 2026-09-20), 996 of them with a ClubElo rating dated before kickoff.
- Its original review files lived under `artifacts/historical-calibration-2026-10-07/`, which is **not in git**. That gap is closed for the re-fit below.

### 5.2 Re-fit, 22 Oct 2026 (evidence in git; not yet pinned)
All inputs, code and outputs are committed under `model/calibration-2026-10-22/`:

| File | Content |
|---|---|
| `raw/E0-2425.csv`, `raw/E0-2526.csv`, `raw/E0-2627.csv` | football-data.co.uk results, as downloaded |
| `raw/clubelo-eng-mirror.csv` | English ClubElo ratings from the daily mirror, July 2024 to 14 Jan 2026 |
| `prepare_inputs.py` | Joins results to ratings (rating published strictly before the kickoff UTC date, at most 14 days old) |
| `inputs/matches.json`, `inputs/manifest.json` | 830 matches, 650 with ratings; SHA-256 of every input |
| `scripts/refit-epl-goal-calibration-2026-10-22.ts` | Fit, backtest, reliability, ECE and bootstrap, using the production model code |
| `report.json` | All results below |
| `candidate-fit.json` | Re-fitted coefficients at origin 2026-10-22 |
| `backtest-predictions.json` | Every out-of-sample prediction |

Fit at origin 2026-10-22, current plus last season (2025-26 and 2026-27, 450 results through 2026-10-19, 280 with ratings): intercept 1.028, slope 0.501, home offset 0.281, ρ −0.08.

The candidate has not replaced the production pin. A later walk-forward study, `model/epl-repin-2026-11-06/`, refit the same production options on 2018–2026 (3,110 results, 1,101 with a pre-kickoff rating) instead of this 450-row window. On 2024/25 and 2025/26 that shorter window was slightly worse and was rejected. The study's keep rule then accepted only T = 1.286, but T was not chosen independently of that study's evaluation seasons; section 5.5 gives the corrected, smaller estimate. The production pin and the temperature flag are unchanged; section 5.5 is the recommendation for the 6 Nov re-pin.

### 5.3 Backtest (out of sample)
Method: weekly rolling origins from 2025-09-01 to 2026-10-19. For each week the goal model is fitted only on results available 24 hours before the week starts, and forecasts that week. Ratings are always dated strictly before kickoff. Window: 250 matches in 26 weeks (Sept 2025–Jan 2026 and Aug–Oct 2026; Feb–Jul 2026 has no dated rating in the mirror and is excluded).

| Metric (lower is better) | Published 1X2 | 1X2 with T = 1.286 | Goal model 1X2 alone |
|---|---|---|---|
| Log loss | 1.0455 | 1.0290 | 1.0354 |
| Brier (3-way) | 0.6269 | 0.6180 | 0.6224 |
| RPS | 0.2156 | 0.2116 | 0.2129 |
| ECE home win | 0.084 | 0.053 | 0.069 |
| ECE draw | 0.020 | 0.008 | 0.021 |
| ECE away win | 0.076 | 0.087 | 0.057 |

| Market | Fixed-2.70 baseline | Production (anchored) | Observed rate |
|---|---|---|---|
| Over 2.5, log loss / ECE / mean forecast | 0.6917 / 0.054 / 50.6% | 0.6921 / 0.038 / 53.8% | 56.0% |
| BTTS, log loss / ECE / mean forecast | 0.7020 / 0.077 / 48.7% | 0.6867 / 0.069 / 53.9% | 56.4% |
| Exact scoreline log loss | 2.9806 | 2.9447 | — |

Bootstrap (2,000 match resamples, seed 20261022), difference in mean loss, negative = first is better:
- 1X2 log loss, T = 1.286 minus published: −0.0165 (95% CI −0.0327 to −0.0007).
- 1X2 RPS, T = 1.286 minus published: −0.0039 (95% CI −0.0080 to 0.0000).
- Over 2.5 log loss, anchored minus baseline: +0.0004 (95% CI −0.0110 to +0.0122), no difference.
- BTTS log loss, anchored minus baseline: −0.0153 (95% CI −0.0338 to +0.0023).

Reliability tables for home win, draw, away win, over 2.5 and BTTS are in `report.json` → `reliability`. The published home-win probability is too high above 60%: forecasts of 70–80% won 58% of the time (n = 26).

### 5.4 1X2 temperature (T = 1.286), OFF
- Temperature scaling divides the 1X2 log-probabilities by T and renormalises, which softens strong favourites.
- It is implemented behind the flag `ONE_X_TWO_TEMPERATURE_ENABLED`. It is **off** unless that variable is exactly `true`. When on, the tempered 1X2 becomes the anchoring target, so the grid, totals, BTTS and scorelines stay consistent with the published 1X2.
- Turning it on is a product decision and requires the owner's approval.

| Fixture (20 Oct pin) | 1X2 now | 1X2 with T = 1.286 |
|---|---|---|
| Arsenal v Everton | 77.4 / 17.1 / 5.5 | 69.6 / 21.5 / 8.9 |
| Ipswich v Forest | 26.7 / 27.6 / 45.7 | 28.2 / 28.9 / 42.9 |
| Man City v Burnley | 86.6 / 11.6 / 1.8 | 79.5 / 16.7 / 3.8 |
| Liverpool v Chelsea | 51.0 / 26.7 / 22.3 | 47.0 / 28.3 / 24.7 |

## 5.5 Re-pin recommendation (22 Oct 2026 study; not yet pinned)

Evidence: `model/epl-repin-2026-11-06/report.json`, `experiment-log.json`, `reliability.json`. The script is `scripts/epl-repin-walkforward-2026-10-22.ts`. It does not change the live pin.

Walk-forward on 2024/25 and 2025/26 (600 rated matches; Feb–May 2026 has no ClubElo publication inside 14 days and is not scored). Parameters that needed a search were chosen on 2023/24 only. T = 1.286 was not one of them: it was fixed before this study, with no recorded fit, and it is not independent of these seasons (see "Corrections" below).

| Config | 1X2 log loss | 1X2 Brier | Accuracy | ECE (5 buckets) | O2.5 Brier | BTTS Brier |
|---|---|---|---|---|---|---|
| Production spec, T off (baseline) | 1.0191 | 0.6093 | 51.0% | 0.0448 | 0.2466 | 0.2481 |
| T = 1.286, long-history goal fit (kept) | 1.0058 | 0.6020 | 51.0% | 0.0150 | 0.2462 | 0.2479 |

T = 1.286 minus baseline, 2,000 match resamples, seed 20261022: 1X2 log loss −0.0133 [−0.0241, −0.0026], 1X2 Brier −0.0072 [−0.0135, −0.0008], ECE −0.0298 [−0.0348, −0.0085]. Over 2.5 and BTTS Brier intervals include 0. Home-win ECE 0.063 → 0.031 and away-win ECE 0.066 → 0.047 on this sample. The 22 Oct 250-match window had found the opposite away-ECE movement; that window is not this study's selection sample.

**Corrections (independent review, 23 Oct 2026).** The figures above are reproducible byte-for-byte, but they overstate how independent the T result is. Evidence: `model/epl-repin-2026-11-06/review/`.
- **T = 1.286 was not pre-specified independently of the evaluation.** No fit for it is recorded (it first appears in #374). Fitting T on the pooled 2023/24–2025/26 rated matches gives 1.295, which is essentially 1.286. The study's own selection season, 2023/24, prefers T ≈ 1.10, and on it T = 1.286 is slightly worse than no temperature (+0.0011 log loss). Per-season optima: 2022/23 1.07, 2023/24 1.105, 2024/25 1.36, 2025/26 1.59 (`review/temperature-by-season.json`).
- **Honest gain.** When T is learned only from earlier seasons and then scored on the next one, the 1X2 log-loss gain on the same 600 matches is **−0.0094**, not −0.0133. The T learned from all seasons before 2026/27 is **1.27**. Softening helps in every season since 2024/25, so the direction holds. The size claimed above is about 30% optimistic (`review/temperature-walk-forward.json`).
- **The holdout was not untouched for T.** The #402 backtest in section 5.3 already scored T = 1.286 on 250 matches that include 50 of the 70 EPL holdout matches, and those results were known before this study ran. The holdout is not independent evidence for T. Its over 2.5 and BTTS differences also compare against sealed rows that, before 7 Oct, came from the uncalibrated fixed-total baseline, so they do not measure this refit against pin a502e436.
- **No edge versus the market close.** On 580 of the 600 development matches with Pinnacle closing odds (proportional de-vig), log loss minus the close is **+0.031** [+0.012, +0.053] for the current specification and **+0.021** [+0.006, +0.036] with T = 1.286. Both are significantly worse than the close. T narrows the gap by about a third; it does not create an edge (`review/market-close.txt`).
- The goal refit itself does not move the published 1X2: the score grid is re-anchored to the Elo 1X2 (with or without T). The refit changes only totals, BTTS, expected goals and scorelines.

Rejected on that same rule: the 450-row two-season window, a temperature chosen on 2023/24 (it picked 1.10), home advantage 70, rho 0, half-life 365, team precision 25, a higher total-goals scale, a 50/50 Elo and goal-model 1X2 blend, and an attack/defence Dixon–Coles grid. The attack/defence point estimate was slightly better and its interval included 0. Historical free E0 files do not contain xG before 2026/27, so no xG fit was trained. Shots on target are stored on the input rows and were not a separate candidate.

**One config for the 6 Nov re-pin:** keep decay 180 and team precision 100, refit on every Premier League result from 2018/19 through 24 hours before the pin origin (not the 450-row window), and, as a separate owner decision, consider turning `ONE_X_TWO_TEMPERATURE_ENABLED` on so the tempered 1X2 is the anchor (expected gain about −0.009 log loss, not −0.013; see Corrections). A review fit at origin 2026-10-22, which already includes results through 2026-10-19 and is therefore not an out-of-sample score of those matches, is intercept 1.040, slope 0.532, home offset 0.237, rho −0.06 (3,110 results, 1,101 rated). Refit again on the pin day so the 30-day clock starts then. The flag stays off in this revision. The change beats the model's own baseline on the development seasons. It does not beat the market-close bar in `model/backtest/backtest/promotion_criteria.json`, which was not re-run and previously failed, so the pin and the flag are not switched on here.

The 84-match holdout (which overlaps the #402 backtest for T, so it is not independent evidence for T), with the goal model frozen on 1 Jul 2026 and the sealed pre-kickoff ratings, moves in the same direction (EPL 1X2 log loss 1.0552 → 1.0239, Brier 0.6264 → 0.6120, ECE 0.0560 → 0.0402; the full 84, UCL rows left sealed, 1X2 Brier 0.6243 → 0.6123 and ECE 0.0617 → 0.0499). Every holdout interval includes 0. Accuracy is unchanged. That sample is too small to confirm the development result on its own.

## 6. Earlier backtests
- `docs/how-it-works/model-backtest.md` and `model/backtest/` record earlier backtests. Model-page recalculation using the release ratings snapshot is **not** a look-ahead-free backtest, because that snapshot was taken after the matches it scores.

## 7. Known limits
1. **1X2 overconfidence at large rating gaps.** The 1X2 uses a fixed 2.70-goal total and has not been re-fitted. It is more confident than markets and than its own goal model for heavy favourites (section 5.3). Temperature scaling corrects most of this but is off.
2. **Two components.** The 1X2 (Elo) and the goal shape (calibrated rates) are separate models joined by anchoring, which moves the displayed expected goals toward the Elo 1X2.
3. **Totals and BTTS run low.** In the backtest window the observed over-2.5 rate was 56.0% against a mean forecast of 53.8%; BTTS 56.4% against 53.9%.
4. **Ratings are static between pins.** Results do not move ratings until the next manual ClubElo refresh.
5. **Rating coverage gap in calibration data.** The free ClubElo history mirror ends on 14 Jan 2026; Feb–Jul 2026 matches have no dated rating and only inform the total-goals part of the re-fit.
6. **Small samples.** The 22 Oct backtest has 250 matches; reliability bins at the extremes hold 10–30 matches.
7. **No lineups, injuries or schedule congestion** enter the model. They appear only in dossiers.
8. **"xG" naming.** The card's xG is model expected goals, not shot-based xG.

## 8. Expiry dates and refresh procedure

| Pin | Issued | Hard expiry | Alert from |
|---|---|---|---|
| EPL goal calibration `02d8bbcd…` | 2026-10-22 00:00 UTC | **2026-11-21 00:00 UTC (Sat 21 Nov 08:00 SGT)** | 2026-11-14 00:00 UTC (Sat 14 Nov 08:00 SGT) |
| ClubElo pin `13d23cc4…` | 2026-10-20 11:52 UTC | **2026-11-19 11:52 UTC (Thu 19 Nov 19:52 SGT)** | 2026-11-12 11:52 UTC |

- `pnpm --filter @sports-predict/api check:model-expiry` exits non-zero from 7 days before either expiry. It runs today inside the weekly `clubelo-freshness.yml` job (Mondays 08:00 UTC), which also flags a ClubElo pin older than 7 days. The daily version (00:00 UTC, 08:00 SGT) is ready at `docs/ops/pending-workflows/model-pin-expiry.yml` and goes live once copied into `.github/workflows/` by an account with the GitHub `workflow` permission.
- To re-pin the calibration: use the 6 Nov recommendation in section 5.5 (`model/epl-repin-2026-11-06/`), not the rejected 450-row candidate in `model/calibration-2026-10-22/`. Writing a new artifact still means a schema-v1 file under `packages/api/data/model-artifacts/epl-goal-calibration/<sha256>.json`, an update to `EPL_GOAL_CALIBRATION_ARTIFACT_SHA256` and `EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN`, the previous pin appended (not deleted) to `EPL_GOAL_CALIBRATION_PINS` so cached and stored rows built under it still replay (`retired-calibration-pin.test.ts`), the API tests, and a deploy. This changes live forecasts and needs sign-off. This revision does not do that, and it does not turn `ONE_X_TWO_TEMPERATURE_ENABLED` on.
- To refresh ClubElo: `packages/api/scripts/refresh-clubelo-snapshot.ts` (capture, build, verify), then deploy.
