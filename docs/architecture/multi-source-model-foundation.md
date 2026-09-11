# Multi-source model foundation

## Decision

Pundit's production champion remains the current ClubElo rating pair plus the
competition's fixed home-field adjustment, transformed through the existing
Elo-to-goals and Dixon-Coles/Poisson implementation. This work must not change a
live probability, substitute a default rating, or weaken the existing
fail-closed behavior when a fixture cannot be priced.

The first milestone is evidence and replaceability, not a new prediction model.
Elo is moved behind a typed contributor boundary and its forecasts are recorded
with enough immutable provenance to compare a later challenger fairly.

## Product model names

- **Pundit Fundamental** is the market-independent forecast. Its champion is
  `clubelo@1` (method `clubelo-elo-to-goals-dixon-coles`); future independent contributors may include a fitted
  attack/defence Dixon-Coles model, lineup/availability features, or other
  football-performance inputs, but only after their data and evaluation paths
  are independently auditable.
- **Pundit Consensus** is a future market-aware view that can combine a sealed
  Fundamental forecast with timestamped no-vig market probabilities. Market
  prices remain benchmark evidence today and are never inputs to the
  Fundamental champion.

No contributor is enabled merely by registration. The challenger registry is
empty until a real offline-trained model and its versioned artifact exist.

## Forecast identity and provenance

Every new evidence-ledger row has a stable identity derived from competition,
fixture, contributor, contributor version, checkpoint policy, and forecast time. The sealed
forecast portion records:

- ledger schema, Pundit model, contributor and method identifiers/versions;
- forecast/checkpoint time, fixture identity, teams and scheduled kickoff;
- home/away input ratings, rating profile, rating snapshot time and age, and
  whether the whole rating set was live or restored from durable cache;
- home-field adjustment and all Elo-to-goals/Dixon-Coles constants;
- 1X2, totals and BTTS probabilities; and
- any no-vig market rows available at the checkpoint, with their source-cache
  timestamp.

Forecast fields are immutable after sealing. Later fixture results and distinct
pre-kickoff market observations are append-only evidence linked to that
forecast; neither can replace the sealed probabilities. Legacy rows load as
schema-v1 partial-provenance records without inventing timestamps they never
stored. They remain visible, but legacy, incomplete-source, invalid-timestamp,
and post-kickoff forecasts are excluded from official metrics and counted by
exclusion reason.

## Checkpoint policy

`pre-kickoff-90m-v1` seals the first valid scheduled forecast observed from 90
minutes before kickoff until kickoff. This is deterministic against ESPN's
30-minute and model/ratings' 60-minute refresh cadences, captures before the
event, and avoids choosing a forecast after seeing the result. A final
scheduled-to-live observation may use a cached model only when its recorded
generation time is before kickoff. If no eligible model was observed, the
ledger records one idempotent missed-checkpoint row with a reason rather than
recomputing retrospectively.

## Release migration and rollback

Before the first schema-v2 release, run the backup command in the API service
with the mounted volume configured:

```bash
PUNDIT_DATA_DIR=/data pnpm --filter @sports-predict/api backup:club-season-ledger
```

The command creates a timestamped, byte-verified sibling of
`/data/evaluation/club-season.json` and prints its exact path. Confirm that path
exists before deployment. The runtime also performs the same non-destructive
backup automatically before its first schema-v2 persistence if it sees a
legacy target. Rollback means stopping the new writer and copying the verified
backup back to `club-season.json`; never merge or reconstruct ledger rows by
hand. This procedure is intentionally release-only and must not be run against
production during ordinary tests.

## Evaluation and promotion gate

Evaluation is chronological and rolling-origin: train only on fixtures strictly
before a split, freeze model/contributor artifacts, forecast the next time
block, then advance the origin. Reports must segment at least by contributor and
version, competition, season/time block, checkpoint policy, rating-source state,
and sample count. Each segment reports multiclass Brier score, log loss,
calibration buckets and outcome accuracy. Zero observations report unavailable
metrics, not perfect zero loss.

A challenger can be recommended for promotion only when held-out Brier, log
loss and calibration improve consistently over the same champion fixtures and
remain stable across relevant competitions and seasons. The recommendation must
state uncertainty and sample-size limits. Deployment remains a separate,
human-approved decision.

## ESPN data audit and challenger backlog

The runtime ESPN ingestion cannot currently support a fitted attack/defence
Dixon-Coles challenger. It requests a moving window with only seven days of past
matches, does not persist a chronological training corpus, and does not version
raw source observations or fixture corrections. Building a trainer from that
cache would silently select an incomplete sample.

Before an offline trainer is implemented, a source pipeline must provide:

1. at least two complete seasons per relevant competition, including stable
   fixture/competition/season identifiers, scheduled kickoff and final 90-minute
   home/away scores;
2. postponement, cancellation, venue/neutral-site and correction handling;
3. raw-source retrieval time, immutable source snapshots and a documented team
   identity mapping;
4. completeness checks against expected competition fixture counts and explicit
   missing/duplicate records; and
5. a train-only fitting contract for attack, defence, intercept, home advantage,
   Dixon-Coles rho and time-decay parameters, with rolling-origin split manifests.

Once that contract is satisfied, add an offline-only trainer that emits a
content-addressed artifact and paired champion/challenger forecasts. Do not wire
it into readiness or production selection until the promotion gate passes.

The trainer (`train:dixon-coles-mle`) and the paired rolling-origin eval
(`eval:dixon-coles-mle` in `challenger-eval.ts`) exist. Both fail closed without
a complete pre-kickoff ClubElo join and a validated fitted artifact. Empty
holdouts report unavailable metrics, not zero loss. A promotion recommendation
still requires a human deploy; `activateProduction` stays false and
`model-data.ts` continues to use `ELO_CHAMPION` only.

### Corpus gate result — 2026-08-10

The protected prior-worktree audit produced a content-addressed ESPN corpus.
Both completed Premier League seasons passed strict round-robin validation (380
fixtures, 20 teams, 38 per team, full home/away pairing). UCL qualifying was
inconclusive: the two seasons contained 90 and 92 structurally valid fixtures,
no independent expected count was encoded, and six matches per season finished
after extra time or penalties without a guaranteed 90-minute score field. This
checkout includes the reproducible builder and validation tests, but that older
generated corpus is not treated as current certification evidence.

This clears Premier League-only offline training, not promotion. Paired
champion/challenger evaluation remains blocked until chronological pre-match
ClubElo inputs are acquired. Cross-competition promotion also remains blocked
until UCL qualifying completeness and regulation-time scoring are resolved.

## Explicit non-goals

- no LLM aggregation or generation of probabilities;
- no PnL- or betting-ROI-only fitting, weighting, or promotion decision;
- no autonomous deployment or champion switch;
- no betting or trading execution; and
- no database, Prisma, Postgres, or replacement persistence system.
