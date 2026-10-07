# The Model

Fundamental v3 preserves Pundit's rating-and-home-advantage win/draw/loss probabilities while calibrating the score shape for ordinary Premier League home fixtures. A historical fit estimates shrunk team-event total-goal rates, an Elo-based home/away allocation and a Dixon–Coles low-score correction. It then rescales each home-win, draw and away-win region to the unchanged baseline 1X2 mass. Totals, BTTS, likely scores and calibrated expected goals come from that final joint distribution.

The calibration is pinned by raw SHA-256 `a502e436d89d84e73647602117060a1ee2c824435ebd05a3ad6f93b859f627c7`, method `outcome-anchored-shrunk-goals-v2`, with origin `2026-10-07T00:00:00Z`. Its release fit uses 3,090 earlier goal outcomes and 996 dated-rating allocation rows. The 50 completed current-season results contribute goals only; they have no retrospective ratings manufactured for allocation. Production loads this artifact and the pinned ClubElo ratings locally.

UCL qualifiers, neutral fixtures and kickoffs before the calibration origin retain the baseline 2.70-total score shape. Current ordinary EPL fixtures fail closed on missing, invalid, future or more-than-30-day-old calibration; they never silently revert to fixed totals. The active fixture set retains its 21-day horizon and adaptive refresh cadence, without contacting ClubElo at runtime. Refreshing a fixture cache does not refit the calibration; a new fit, content-addressed artifact and pin require a reviewed release.

### Active fixture model

For each recognized, policy-eligible upcoming club fixture in the active window:

* **Win, draw, or loss probabilities** (`pHome`, `pDraw`, `pAway`) — the preserved rating/HFA baseline for that specific matchup
* **Over/under 2.5, BTTS, and likely scorelines** — derived from the resolved final score grid
* **Calibrated expected goals** — probability-weighted home/away score means from that grid. Raw fitted lambdas describe the shape before outcome anchoring; they are not the published xG
* **Home-field advantage** applied for Premier League and UEFA Champions League qualifier home teams when the venue is not neutral (not for neutral-site tournaments)

Team strength comes from a pinned `clubelo@1` snapshot, scoped by competition rating profile (domestic league vs continental). Its selector, payload hash, source timestamp, minimum coverage and 30-day freshness are validated before use. A corrupt, expired or incomplete artifact fails closed rather than guessing ratings.

The team effects shrink toward zero; a club absent from the fit has an explicit zero-effect extrapolation. This is a statistical team scoring-rate adjustment, not a live injury or tactical counterfactual.

Fixture recognition is a gate, not a numeric input. The registry binds approved structured source IDs to canonical teams, kickoff, venue/neutral state, competition, and status. Cancelled, postponed, unsupported, ambiguous, or incomplete fixtures fail closed before pricing; this does not alter the numeric output for existing eligible fixtures.

### Season outlook simulator

For Premier League title-race and top-four questions, Pundit runs a **Monte Carlo simulation** over remaining scheduled fixtures:

* Uses current ESPN standings as the starting state
* Resolves each remaining fixture through the same calibration/baseline policy, then samples 90-minute scores from its full joint 0–10 grid; it does not rebuild an independent Poisson distribution from published xG
* Reports title probability and top-four probability per team

The default simulation seed is derived from the complete standings, remaining fixtures, ratings, run count, active contributor identity and goal-calibration artifact hash. Identical grounded inputs therefore replay to identical probabilities across follow-up turns; changing a grounded input changes the replay. Tests may still inject an explicit random source.

The simulator uses the same score-model policy beyond the per-fixture active cache, gated on a complete schedule and rating coverage. The paper lab samples the supplied joint grid too; calibrated rows without a coherent grid fail closed. Legacy paper rows without a grid retain their separately disclosed simulation fallback.

### How the desk uses it

For a recognized, priced fixture in the 21-day window, Pundit treats the fixture's precomputed probabilities as ground truth. Every complete no-search match response is rendered deterministically from that grounding payload. MiniMax is reserved for evidence-required current turns and general/ungrounded open-ended analysis. Follow-ups that name a market already on the grid — 1X2, over/under 2.5 (including `o2.5`), BTTS, or likely scorelines — quote those facts. They do not fall back to restating the favourite.

Pundit then:

1. Compares the Fundamental win/draw/loss read with complete active Stake, Kalshi and Polymarket 1X2 prices when available. Labelled **Pundit Consensus** remains separate: when a Fundamental grid is supplied, it reanchors that score shape to its market-adjusted 1X2 target and derives its own markets and expected-goal means. It does not replace the calibrated shape with a fixed-total refit or become the Fundamental headline.
2. Requires evidence for externally current injuries, suspensions, lineups and transfers. Narrow latest-result requests can use fresh supported ESPN records; broader requests retain search. Positive current-news claims cite their source and publication date, without implying a verified numerical lineup effect or guaranteed future availability
3. Responds in plain language from server-owned facts, including fair prices `1/p`. Calibrated EPL totals vary with the fitted score shape while 1X2 remains unchanged. Over and Under 2.5 are complementary probabilities summing to one; their decimal fair odds are reciprocals, not percentages.

Odds and market questions also retain mandatory search. If verification supports no external claim, Pundit discards the generated prose and deterministically renders only complete same-source market rows already present in match grounding. The verification remains `abstain` or `unavailable`, citations are empty, and an incomplete or absent grounded market is omitted rather than guessed.

Competition questions use ESPN standings only. Season questions add the Monte Carlo outlook on top of standings.
The word “current” alone does not send an owned table or season-outlook fact to external search. When every current-table row is tied at zero and the user explicitly asks for a ranking based only on that table, Pundit states that the table cannot identify a leader and omits the season probabilities because they also use ratings and the remaining schedule.

Recognized non-priced fixtures use a separate fixture grounding contract with a typed capability reason and no Pundit probabilities or scorelines. Their notice preserves the exact status and reason supplied by the capability decision; it does not ask MiniMax to infer why an input is missing. Discovery-only candidates are not grounding and never reach the model.

### Evaluation and calibration

Two read-only evaluation artifacts measure how well pre-kickoff probabilities matched reality:

| Artifact | Path | Method |
|---|---|---|
| **Club season (rolling)** | `/evaluation/club-season` | First eligible forecast sealed in the 90-minute pre-kickoff window (`pre-kickoff-90m-v1`). Live volume is on Railway `/data`, not the empty in-repo seed. |
| **WC 2026 (frozen)** | `/evaluation/wc-2026` | Reconstructed pre-kickoff probabilities for every finished World Cup 2026 match |

The Model page and recalculated historical fixture rows are exploratory views using release inputs. Targets before the EPL calibration origin retain the historical baseline; they never receive later-trained calibration parameters. Recalculation with a release ratings snapshot is not a look-ahead-free backtest.

The older **offline Phase 1b calibrator** (`pnpm --filter @sports-predict/api calibrate:champion`) still writes research reports from sealed club-season rows. It does not select the active v3 artifact or change runtime constants. The in-repo ledger seed is not production truth — Railway `PUNDIT_DATA_DIR=/data` is. MiniMax does not author match probabilities.

The separate fitted attack/defence Dixon–Coles challenger remains **registered, not activated**. It is distinct from the active shrunk goal-rate calibration. The preserved rating/HFA baseline still supplies Fundamental 1X2 and unsupported calibration scopes.

### Historical evidence for v3

The outcome-anchored V2 evaluation refits each weekly origin using earlier outcomes with a 24-hour availability lag. Candidate selection uses earlier-origin forecasts only. The initial development results on 341 primary 2023–24 fixtures across 33 UTC weeks were:

| Metric | Candidate minus baseline | Retrospective 95% interval |
|---|---:|---:|
| Exact-score log loss | −0.0863 | [−0.1219, −0.0511] |
| Over/Under 2.5 Brier | −0.01450 | [−0.02408, −0.00507] |
| BTTS Brier | −0.02285 | [−0.03164, −0.01387] |
| 1X2 log loss | 0 | Preserved by outcome anchoring |

Lower is better. V2 followed diagnosis of V1's failed 1X2 regression gate. The 2023–24 and secondary cohorts were already exposed during development; their results are chronological retrospective development evidence. The later family-unexposed validation below was fixed before its labels were acquired. Neither is prospective superiority proof. Dated ratings were retrieved from an archival mirror; they are an availability proxy rather than original sealed forecasts or proof that no historical ratings were revised. The intervals are unadjusted paired retrospective uncertainty after that development history.

The 580-fixture exposed secondary cohort showed a score-log-loss change of −0.02843 and BTTS Brier change of −0.01180. Its totals Brier change was −0.00225 with interval [−0.00937, +0.00483], which crosses zero. Broader totals improvement is therefore uncertain. The checks support a bounded historical improvement in score shape while preserving 1X2; they do not establish best possible performance or guaranteed future accuracy.

### Later family-unexposed retrospective validation

The first unused family reserve, 353 fresh-rated 2017–18 fixtures, **failed** its declared gates. The score-log-loss interval upper bound was +0.006864, so improvement was not established; the BTTS Brier upper bound was +0.005759, above the declared +0.005 noninferiority margin. That failure remains preserved.

The unchanged V2 family was then tested on all five EPL seasons from 2009–10 through 2013–14, fixed before outcome acquisition under protocol SHA-256 `988820c1d7c7f027396575c96d7a87628b78f531e58c300b4a3413113f0cf467`. These seasons had not been used in family development. The method, candidates, metrics and thresholds were not retuned after the 2017–18 failure or after seeing the new labels. On 1,770 fresh-rated fixtures across 182 UTC weeks, with zero fallbacks, the declared gates passed:

| Metric | Candidate minus baseline | Paired 95% interval |
|---|---:|---:|
| Exact-score log loss | −0.014175 | [−0.024269, −0.003894] |
| Over/Under 2.5 Brier | −0.000698 | [−0.003184, +0.001845] |
| BTTS Brier | −0.005319 | [−0.008193, −0.002368] |
| 1X2 log loss | 0 within floating precision | Preserved by outcome anchoring |

Scoreline and BTTS losses improved in this cohort. Totals met the predeclared +0.005 noninferiority margin; their interval includes zero, so significant totals superiority was not established. Another 130 stale-rated rows remain reported separately and do not inflate the primary denominator.

The same source-calendar availability proxy and 24-hour result lag apply. These are retrospectively acquired data, not original forecast seals. The paired UTC-week intervals are unadjusted for choosing an additional historical cohort after the earlier reserve failed. The entire five-season cohort was fixed before new labels, without optional stopping within it; this does not erase sequential research uncertainty. The result supports bounded retrospective validation of the unchanged family, not guaranteed future accuracy or best possible performance. The current pinned release fit remains 3,090 goal outcomes and 996 dated-rating allocation rows; the validation did not alter it or establish a merged/deployed release.

The source-bound prospective candidate `2b5bc111…` belongs to the previous model sources. Before releasing v3, disable it with `PROSPECTIVE_MODEL_CAPTURE=false` and preserve its `/data/prospective-model` cohort. The old 40-match requirement remains historical cohort policy, not a prerequisite for this retrospective improvement. Any future collector must use a newly reviewed candidate and source binding; future results provide additional monitoring.

### Historical note: World Cup 2026

The live World Cup tournament model (100k bracket simulations, neutral venues, eloratings.net TSV) is **retired**. Credibility for WC 2026 lives in the frozen backtest at `/evaluation/wc-2026` only.
