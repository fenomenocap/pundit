# AGENTS.md — Pundit

Read `CLAUDE.md` first for architecture, data sources, and standing constraints.

## Current state

Pundit is a deployed analysis desk for the club season (Premier League + UCL qualifiers). It has no blockchain or database; the former trading platform is archived at `archive/onchain-trading-v1`. World Cup 2026 live pipelines are retired — credibility lives on the frozen backtest at `/evaluation/wc-2026`.

| Area | Current behavior |
|---|---|
| Desk homepage | Live slate + analyst pane (`packages/web/src/desk`). Status-aware errors, New Chat, grounding labels (match/recognized fixture/competition/season/general), active market comparisons. Featured briefing and tactical chips are football takes — they do not open the EV desk or blank when current-news sources conflict. Paper (`/board`), Draft (`/draft`), and Vaults (`/vault`) are a local paper lab on the same slate — not a bookmaker. Legacy chat remains at `/legacy`. Recognized non-priced fixtures retain context and show distinct outside-coverage, temporary-unavailability, or missing-input labels without Pundit probabilities. Suggestions and the rail only offer fixtures the model has priced. |
| `POST /api/ask` | Four tiers: active-match model grounding (pinned club-strength artifact + HFA), competition standings grounding (ESPN table), Premier League season outlook (Monte Carlo title/top-four), and clearly labelled general football analysis. Every no-search response with complete server grounding is deterministic and bypasses the answer model. “Current” alone does not trigger external search for an owned table, model, or season-outlook fact; injuries, managers, odds and other externally current facts still do. `current table` and `current standings` are explicit referential cues: they retain the most recent competition named by the user, or default to the Premier League when no competition is in view because it is the only supported league-style table. Arbitrary pronouns do not inherit competition context. An all-zero table explicitly requested as the sole source cannot rank a champion or leak ratings-and-schedule probabilities. Non-priced capability and identity-not-established candidate notices are always deterministic; mandatory current searches cannot alter capability or promote identity. A market search that establishes no supported claim falls back to complete structured market rows already in match grounding, with no generated counterfactual or citation. MiniMax is limited to supported evidence-required prose plus general/ungrounded open-ended analysis. Identical complete season inputs use a stable replay seed. Uses aliases, a 12-turn/12,000-character history cap, a shared 90-second request deadline, deterministic pre-search for clearly current questions, one bounded ambiguous fallback, and a 10 requests/minute deployment-wide limit divided across replicas. Positive current-news claims require same-sentence server-owned citations; unsupported claims are removed or the answer abstains. |
| Active model | Fundamental v3 serves the unchanged rating/HFA 1X2 with calibrated EPL totals/BTTS/scorelines and final-grid expected goals, using pinned `outcome-anchored-shrunk-goals-v2`. UCL qualifiers, neutral and pre-origin fixtures retain the baseline 2.70-total score shape. |
| Fixture registry | Approved structured identities persist atomically under `/data`; `/api/fixtures/recognized` exposes read-only capability decisions. Candidates/search never become grounding. Expanded routing is flag-gated and friendlies remain outside public model coverage. |
| Featured fixtures | Next N active fixtures across enabled competitions (EPL priority), joined to model rows for chat suggestions and market odds. |
| Fixture markets | `fixture-market-sources.ts` fetches Stake/Kalshi/Polymarket by market profile; `model-market-odds.ts` caches no-vig 1X2 for the active fixture set. Source failures stay isolated. |
| `/fixtures` | Multi-competition live schedule/history and standings from ESPN, with competition tabs and links onto the desk. |
| `/model` | Native read-only view of active club fixture model probabilities; links to WC backtest. |
| `/evaluation/club-season` | Rolling 90-minute pre-kickoff seal ledger (read-only JSON; live volume on Railway `/data`). |
| `/evaluation/wc-2026` | Frozen WC 2026 backtest artifact (read-only, no cron). |
| CI | `.github/workflows/ci.yml` runs TypeScript checks, API Vitest, web build, and Playwright smoke tests on pull requests. |

The default-on conversational response path is `ANALYST_RESPONSE_V2`. It plans a response mode before expression, settles exact-score/fair-price/market, **totals, BTTS, scoreline boards**, and unsupported player/lineup turns from typed server facts, and renders all match numbers through server-owned fact slots. Generated prose may connect those facts naturally in first person, but it cannot author probabilities, fair odds, gaps, source IDs, betting recommendations, or lineup effects. A named market that is not on the grid abstains instead of repeating 1X2. Current team news remains evidence-required. Set the flag exactly to `false` only for emergency legacy rollback; `/ready` reports the active version and process-local accepted/rejected/guard counters.

Narrow latest club-result requests use fresh, error-free ESPN completed records, including the complete Premier League season schedule during an empty rolling window. They return a dated event citation and explicit competition coverage, with no forecast grounding; a score cannot establish why a side won. Unsupported result scope still requires search. Team-news queries also retrieve current club updates before fixture previews exist. Dated club reports no more than seven days old can support exact verified status notes, with explicit limits on future kickoff availability; player markets and lineups retain fixture-specific evidence requirements.

Direct current-manager answers settle from verified, source-bound role facts, including when no fixture is selected. Requested appointment history retains only the same manager's source-owned date precision. A requested appointment or retention reason uses a short, explicitly attributed source statement or a verification boundary; editorial achievements never become the club's proven decision reason. JSON and streaming delivery share this contract, including unavailable verification.

`packages/api` has focused Vitest coverage. `packages/web` has Playwright smoke tests only (`pnpm --filter web test:e2e`); no component unit tests unless explicitly requested.

## Production and secrets

- **Vercel access:** Hobby team `fenomenocap` is owner-only — see [`docs/ops/vercel-access.md`](docs/ops/vercel-access.md). Do not invite collaborators or upgrade plans without an explicit Owner decision.

- `MINIMAX_API_KEY` is configured on the Railway `@pundit/api` service. Never read it back, log it, hardcode it, or store it in the repository.
- Optional `ALLOWED_ORIGINS` (comma-separated) restricts browser CORS; leave unset only while debugging, and set it to the Vercel frontend origin(s) in production.
- `/health` is liveness. `/ready` reports model, ESPN, active-fixture, and market-odds cache readiness without exposing secrets.
- Cache refresh cadences: ESPN fixtures/standings and active market odds every 30 minutes; the active model every hour. Club strengths come from a reviewed local release artifact; production runtime never contacts ClubElo.
- `PUNDIT_DATA_DIR=/data` on Railway is a mounted volume. It holds the rolling club-season calibration history, club-strength artifact current/last-good recovery copies, atomic recognized-fixture registry plus last-good recovery copy, and (only when separately enabled) the private friendly-shadow ledger. This state must survive deploys, since the container image is rebuilt each time. Unset locally, paths fall back to `packages/api/data`.
- Before the v3 release, retire the old source-bound prospective candidate `2b5bc111e5b7c1bc411ff8cc79375b7d16dcc807c2bc8015b7786f1ea07feb87`: set `PROSPECTIVE_MODEL_CAPTURE=false`, preserve `/data/prospective-model`, and verify `/ready.prospectiveModel` is disabled. Do not let changed model sources contaminate that frozen cohort. The historical 40-match policy remains in its old receipts; future outcomes are additional monitoring, not a prerequisite for the new retrospective improvement. The read-only evaluator remains available for preserved evidence; any new collector candidate needs its own reviewed source binding.
- Reviewed recognition-only fixtures ship in `packages/api/data/fixture-registry/approved-fixtures-v1.json`. A friendly requires an ESPN stable event ID plus an official competition, federation, or club URL; it remains outside public pricing and is merged into the atomic registry at startup.
- Club-strength artifact hash, coverage and 30-day freshness fail closed. A 7-day `/ready` `ratingsRefreshDue` warn and `[ClubRatings] WARN` log do not withhold forecasts. Monitor `model.ratingArtifactId`, `model.ratingArtifactSha256`, `model.ratingsAgeDays`, `model.ratingsRefreshDue`, and `[ClubRatings] ALERT` log lines. Refresh after each PL weekend with `pnpm --filter @sports-predict/api refresh:clubelo-snapshot`; new snapshots enter production only through reviewed releases.

### Active EPL calibration

`epl-goal-calibration-artifact.ts` pins raw SHA-256 `a502e436d89d84e73647602117060a1ee2c824435ebd05a3ad6f93b859f627c7`, with activation origin `2026-10-07T00:00:00Z`. Its shrunk team-event total rate, fitted Elo allocation and low-score correction supply the score shape; outcome anchoring preserves exact champion 1X2. Calibrated published xG is the final grid mean, not the raw fitted lambda. Fixture markets, labelled Consensus, season sampling and paper scores use this joint-grid pipeline. Current ordinary EPL fixtures must fail closed on missing/corrupt/future/>30-day calibration; no silent fixed-total fallback. `/ready.model.goalCalibration` exposes the pin and error. UCL qualifiers, HFA0 neutral fixtures and pre-origin historical targets retain the baseline shape.

The reviewed release fit remains 3,090 goal outcomes and 996 dated-rating allocation rows; 50 current-season results are goal-only. Frozen V2 passed the later five-season 2009–10 through 2013–14 validation: 1,770 fresh-rated fixtures, 182 UTC weeks, zero fallbacks; score-log-loss change −0.014175 (95% interval [−0.024269, −0.003894]), BTTS Brier −0.005319 [−0.008193, −0.002368], and totals Brier −0.000698 [−0.003184, +0.001845]. Totals passed the declared noninferiority margin, not significant superiority; 1X2 is preserved. The complete five-season cohort and unchanged family were frozen before these labels under protocol SHA-256 `988820c1d7c7f027396575c96d7a87628b78f531e58c300b4a3413113f0cf467`.

Preserve every earlier result: V1 failed its 1X2 gate; V2's 341-fixture 2023–24 and 580-fixture secondary development cohorts were exposed (secondary totals interval crosses zero); the first family-unexposed 353-fixture 2017–18 reserve **failed**, with score-loss interval upper +0.006864 and BTTS upper +0.005759 above the +0.005 margin. No method was retuned after that failure. The later five-season cohort was unexposed during family development and fixed before acquisition, but all results remain retrospective with source-calendar availability proxies and no sequential-cohort research adjustment. Do not claim prospective superiority, guaranteed future accuracy, best possible performance, or a merged/deployed release from these tests. See [`docs/how-it-works/the-model.md`](docs/how-it-works/the-model.md).

## Production verification

### Whole-request completion

[`docs/ops/full-request-completion.json`](docs/ops/full-request-completion.json) is the authoritative register for the user's entire October QA/fix request, including predictive calibration and completion governance. Track implementation, testing, deployment and product acceptance separately. Before saying the task, "everything", or the full request is complete, run `pnpm verify:completion` and require `complete: true`. A release certification PASS, merged PR, zero open PRs, or working collector proves only its own scope; it cannot close unresolved calibration. Use `pnpm completion:status` for ongoing status without a completion claim. See [`docs/ops/request-completion.md`](docs/ops/request-completion.md) for evidence and calibration receipt requirements.

Keep working on ongoing items. A worse candidate, uncertainty, optional live slate absence, or insufficient future observations is not an external blocker. Blocked work requires a concrete external condition, missing input, attempted actions, evidence, responsible owner and unblock action. Historical matches can establish retrospective improvement without waiting for future results. Preserve previous release receipts and failures unchanged; new evidence must bind to the actual source and deployment under review. Scope changes require explicit user instructions and corresponding register/guard review; an agent cannot self-approve a product boundary in place of predictive improvement.

Live URLs: **Web** [thepundit.vercel.app](https://thepundit.vercel.app) · **API** [thepundit.up.railway.app](https://thepundit.up.railway.app)

After Vercel or Railway env/config changes that affect production, run `pnpm verify:prod` from the repo root (~15s). For local dev against running servers, use `bash scripts/verify-local.sh`.

## Chat eval cadence

Production chat eval (`pnpm chat-eval:production`) hits live OpenRouter credits — run manually after Tier 1+ deploys as a post-deploy smoke, not in CI. Unit tests for the harness run via `pnpm chat-eval:test` (no production traffic). Dry-run config check: `pnpm chat-eval:dry-run`.

Four-step certification loop after a Railway + Vercel deploy that contains the work under test. Do **not** put the paid eval or live browser capture in CI.

1. **Battle-test** — `pnpm chat-eval:production` writes `artifacts/chat-evals/latest-run.json` (Schema-17, ≥13s pacing). Burns OpenRouter credits.
2. **Browser JSON** — `pnpm chat-eval:browser` reads that run and writes `<runId>.browser.json` against the evaluated production web origin (mobile + desktop). Use `--dry-run` to print the required checks without launching a browser or hitting production.
3. **Agent critic JSON** — review the battle-test answers and write a critic file (`runId`, `schemaVersion`, `sourceSha`, `deploymentId`, per-scenario and per-turn verdicts). The critic is agent-authored, not a repo script.
4. **Finalize** — `pnpm chat-eval:finalize --browser-json <path> --critic-json <path>` binds evidence onto the latest run. Release decisions require report `overall: "PASS"`.

The Schema-17 production evaluator fails certification when delivered answers contain internal jargon (`Dixon-Coles`, `ClubElo`, `model-grounded`), raw search/tool payloads or bracketed search directives, orphaned section labels, or a structurally incomplete ending. Match-grounded evaluation checks explicit combined-scoreline percentages, team/score orientation, grounded scoreline rank/count/mass claims, and invented lineup/tactical probability counterfactuals after verification abstains. Model-only and season prompts have explicit request-fidelity and table-source-fidelity assertions. General analysis checks high-line geometry across bounded prose and Markdown boundaries, while independently rejecting contradictory reversed geometry. Certainty checks are clause-scoped: `cannot guarantee`, `no guarantee`, and `not a certainty` are refusals, but a separate affirmative guarantee still fails. Product scope, categorical source-nonexistence claims, and false denial of supplied history remain guarded. Team-news abstention protects only its own sentence; later availability claims still require a source and date. The artifact also records post-run readiness and the deployment-wide pre/post web-search counter delta for bounded diagnostics, without claiming that delta is per-turn attribution.

Production runs must preserve at least 13,000 ms between every request start. Schema 17 records monotonic start offsets and observed gaps as well as wall-clock timestamps, adds a 25 ms scheduling safety margin, rechecks after waking, and fails certification unless the preserved start count, derived gaps, reported gaps, and minimum interval all agree. Final PASS requires every required scenario to pass, no optional material failure, only explicitly safe observational `INCONCLUSIVE` results, the required-traffic latency gate, the observed pacing gate, per-target build-floor SHA convergence, a real deployment ID, clean browser evidence, and critic PASS coverage for every successful HTTP-200 turn. A timeout or other failure without a comparable prior run is `FAIL`, not an unproven `EXISTING ISSUE`; release decisions require report `overall: "PASS"`.

Match scenarios report per-turn `observations.oddsSourceCount` so a fixture reaching the model with no market line is visible in the report. Empty market coverage does **not** fail by default (public sources are best-effort); set `expectOddsSources: true` on a scenario for a strict run.

## Future

- **Paid unified odds API** — candidate provider [The Odds API](https://the-odds-api.com/) when Stake/Kalshi/Polymarket scraper coverage becomes insufficient. Model probabilities stay local; market comparison would move to a single normalized feed.

## Key file map

```text
packages/api/src/
  index.ts                         — Express routes, readiness, ordered cache bootstrap
  routes/ask.ts                    — validation, history limits, 10/min limiter
  services/
    ask.ts                         — four-tier MiniMax orchestration and grounding
    club-strength-artifact.ts      — pinned artifact schema/hash/freshness validation
    club-ratings.ts                — local artifact adapter by rating profile
    dixon-coles.ts                 — preserved rating/HFA baseline and score-grid primitives
    active-score-model.ts          — shared EPL calibration/baseline fixture resolver
    epl-goal-calibration-artifact.ts — raw-hash pin, fit validation and freshness/readiness
    outcome-anchored-score-grid.ts — conditional score shape with preserved 1X2
    model-data.ts                  — active-club fixture model cache
    football-data.ts               — ESPN fixtures/results/standings cache
    club-form.ts                   — last-5 league form, table row, and scorers from that cache
    fixture-registry.ts            — recognized identities, capabilities, atomic persistence
    active-fixtures.ts             — 21-day active fixture index
    featured-fixtures.ts           — cross-comp featured selector
    fixture-market-sources.ts      — Stake/Kalshi/Polymarket by market profile
    model-market-odds.ts           — normalized active fixture 1X2 cache
    wc-evaluation.ts               — frozen WC backtest read path
    club-season-snapshots.ts     — rolling pre-kickoff snapshot persistence
    season-simulator.ts          — PL title/top-four Monte Carlo
    champion-calibration.ts      — offline Phase 1b fit (research only)
    challenger-eval.ts           — chronological MLE rolling-origin eval
    dixon-coles-mle.ts           — registered fitted DC (forecast throws)

packages/web/src/
  app/page.tsx                     — analysis desk
  app/board/page.tsx               — local paper board
  app/draft/page.tsx               — draft room
  app/vault/page.tsx               — paper model books
  app/legacy/page.tsx              — previous chat homepage
  app/fixtures/page.tsx            — multi-comp schedule/history and standings
  app/model/page.tsx               — active club fixture model reference
  app/evaluation/club-season/page.tsx — rolling club-season calibration UI
  app/evaluation/wc-2026/page.tsx  — frozen WC backtest UI
  desk/                            — slate, analyst pane, intel, paper lab
  lib/api.ts                       — typed API boundary
  lib/mock-data.ts                 — mock-aware fixture/standing wrappers
  e2e/smoke.spec.ts                — Playwright UI shell smoke (mock mode)
  playwright.config.ts             — chromium-only, mock-mode webServer

scripts/
  capture-chat-eval-browser.mjs  — post-deploy Schema-17 browser JSON (pnpm chat-eval:browser)
```

## GitHub authentication on macOS

GitHub CLI credentials are stored in the macOS keyring, and GitHub HTTPS operations use `gh auth git-credential`. A sandboxed `gh auth status` may report an invalid token because it cannot access Keychain even when host authentication is valid. Before asking the user to authenticate again, rerun `gh auth status` with escalated/host permissions. Never work around Keychain isolation by writing a GitHub token to the repository, shell profile, or plaintext config.
