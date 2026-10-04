# Production QA — 2026-10-05 SGT

PR #221 merged as `8e50dad726287de2efb2700a0e6d6828c6c8992a`.
Railway deployment `de38ddd3-a884-4fce-b6bc-9337c42515ed` reached SUCCESS;
Vercel `dpl_215cuT8h3FYQuRSXYmikjGr7CuPJ` reached Ready. Both public
version endpoints served that exact SHA and `pnpm verify:prod <sha> <sha>` passed.

## Model mathematics and limitations

An independent Python implementation, using factorial Poisson probabilities and
the exact pinned input ratings, reproduced all 29 active fixtures' 1X2, O/U 2.5,
BTTS and top-five scoreline ranks within the four-decimal output tolerance.
Maximum probability difference was 0.000049895. Maximum omitted grid mass before
normalization was 0.000046685 (0.00467%). Using the displayed one-decimal ratings
instead produces tiny differences; those are presentation rounding, not different
forecast inputs. The artifact hash was checked on every fixture.

Over and under a half-goal line exhaust the possible outcomes without a push;
their probabilities must sum to one. These percentages are not decimal odds.
Fair decimal odds are `1 / probability`; bookmaker implied probabilities can
include a margin before normalization.

The material weakness is the fixed expected-goals total of 2.70. Elo divides
that total between the teams but cannot change match openness. The low-score
correction redistributes only the 0–0, 0–1, 1–0 and 1–1 cells, all below 2.5;
their adjustments cancel. Thus the untruncated over probability is always
`1 - exp(-2.7) * (1 + 2.7 + 2.7² / 2) = 0.506375509`.
Every active fixture publishes 50.64% over. Truncation produces only negligible
differences before output rounding. This is mathematically coherent but is not
a useful match-specific totals forecast. BTTS and scorelines do vary with the
allocation between teams, but remain subject to the same fixed-total assumption.

## Fresh production-ledger replay

The public live ledger contains 72 rows: 64 completed official seals (50 PL,
14 UCL qualifiers) and eight excluded legacy rows. Of the official seals, 43
used the historical geometric mapping and 21 the fixed-total mapping. Recomputed
current-model results must not be presented as historically published forecasts.

The existing offline calibration workflow was rerun on the live export with
2,000 paired UTC-week bootstrap draws. No sample fallback was used.

| Comparison | Matches | Current Brier | Fitted Brier |
|---|---:|---:|---:|
| Full official sample, recomputed and descriptive | 64 | 0.6572 | 0.6620 |
| Chronological PL holdout | 20 | 0.6827 | 0.7024 |

The fitted constants (1.41 / 11 / −0.05) do not improve the holdout. Twenty
held-out matches across two weeks also fail the minimum 40-match/five-week
research gates. Retain the production constants 1.35 / 42 / −0.1. No model,
registered artifact or production ledger was replaced.

The 63 paired market comparisons show current recomputed Brier 0.6624 versus
market 0.6265. These market snapshots are not necessarily contemporaneous with
the forecast seal. This is descriptive evidence of a quality gap, not a
matched-horizon trading backtest or proof of profitability.

## Immediate product and evaluation corrections

- Replace the incorrectly named FA/EFL trophy asset with the complete official
  white Premier League mark, displayed without cropping.
- Distinguish model percentages from fair decimal odds, explain complementary
  O/U probabilities, and put the fixed-total caveat beside the goals figures.
- Preserve `voice: "desk"` in production evaluation requests and add a required
  homepage briefing/follow-up scenario. The previous harness did not exercise
  the actual homepage voice. Existing standard-path scenarios remain intact.

Local source evidence is retained in the ignored directory
`packages/api/data/research/qa-20261005/`, including public API exports,
independent calculation and calibration report. These are research copies;
Railway `/data` remains production truth.

## Challenger replay and remaining model work

Rerunning the current evaluator confirms that dated prior-only coverage and
weekly expanding-window attack/defence fitting already exist in research.
The three fixed-origin runs score 1,146 pairs over 572 unique fixtures, including
216 prior-only pairs, with no coverage exclusion. The challenger still fails
promotion: it does not beat the champion across the required origins. In the
January 2026 origin, improved 1X2 Brier accompanies worse totals Brier
(0.249581 versus 0.267131).

The weekly replay has 69 origins, 730 unique holdout fixtures, 725 scored pairs,
five invalid/uncovered pairs and four prior-only pairs. It also remains blocked.
Its gate requires two origins with at least 40 scored matches; a football week
usually has far fewer matches. This gate is unsuitable for interpreting pooled
weekly evidence and should be redesigned explicitly before a new selection
experiment, rather than relaxed until the candidate passes. Coverage and
nonconvergence must still block any production recommendation.

Use only results available before each forecast, compare all markets on the same
held-out fixtures and keep parameter selection inside earlier windows. Establish
cadence-appropriate multi-market criteria, resolve invalid grids/nonconvergence,
then freeze a candidate for prospective validation. Existing research models
must not be promoted merely to remove the fixed-total limitation.

Live output certification is separate from these mathematical and research
checks. A final Schema-17 PASS must bind fresh answers, browser evidence and
agent critic review to the evaluated deployment; this document alone does not
certify the delivered prose or investment usefulness.
