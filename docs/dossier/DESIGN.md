# Match dossier — design and phased plan

**Status:** Phase 2 draft (schema v2 + federated evidence write-back + dated retention). Chat does **not** read the dossier until Phase 3 behind `MATCH_DOSSIER_CHAT` (not shipped; default OFF).

**Date:** 2026-10-19

---

## 0. Research lineage (reuse, do not reinvent)

### In-repo sources consulted

| Artifact | What it contributes |
|---|---|
| `packages/api/data/research/agent-data-sources/agent-data-sources.json` | **Source roster** — tier (`fixture-spine`, `analytics`, `news`, `official`, `market-compare`), access mode (`server-owned`, `bounded-fetch`, `minimax-search`, `deferred-vendor`), and Pundit use (`grounding`, `evidence`, `compare-only`). |
| `packages/api/data/research/fixture-sources/coverage-matrix.json` | Fixture-spine rights and operations notes for ESPN / official sites. |
| `docs/how-it-works/data-sources.md` | Federated analytics retrieval (#188 family): OpenRouter `web_search` (Exa), `url_citation` only, tier-tagged evidence, **never blended into Fundamental**. |
| `docs/architecture/evidence-retrieval-reliability-2026-10-14.md` | Trust / allowlist behaviour for manager and team-news federated paths (`evidence-authority.ts`, `federated-evidence.ts`). |
| `packages/api/src/services/data-layer/*` | Typed accessors with `trustTier`, `asOf`, freshness metadata — pattern for dossier fields. |
| `packages/api/src/config/freshness-policy.ts` | Adaptive refresh tiers (`live` / `matchday` / `normal`) dossier schedules should align with. |
| `packages/api/src/services/match-context.ts` | Server-owned table/form/xG split already joined for grounding; dossier extends and persists this. |

### Prior agent / PR notes (GitHub / `gh` search)

| Ref | What dossier reuses |
|---|---|
| **[PR #188](https://github.com/fenomenocap/pundit/pull/188)** (`cursor/agent-data-rich-ad35`, merged 2026-09-15, cloud agent **bc-019f8ddf**) | Adaptive **freshness** tiers; server-owned **match grounding** (form, table, Elo, λ); **`agent-data-sources.json`** roster (23 sources); **`evidence-authority.ts`** tiers; **`federated-evidence.ts`** fan-out; desk evidence labelling. Dossier persists the same trust model on a schedule instead of per-turn search. |
| **[PR #289](https://github.com/fenomenocap/pundit/pull/289)** (`cursor/data-layer-b46e`, merged 2026-10-16, bc-90ba4309) | Typed **`data-layer/`** accessors (`getForm`, `getModelForecast`, `getTeamNews`, …) with `{ data, sources, asOf, stale }` — dossier builder calls the same caches directly in Phase 1. |
| **PR #180** (closed) | Early freshness-policy spike; superseded by #188 policy in `freshness-policy.ts`. |
| **Prediction brief / Phase 0–3** | Market compare-only; evidence never moves probabilities; fitted DC registered-not-activated. |

### Model factor breakdown (Phase 1 maths)

Counterfactuals use the same **`getResolvedActiveScoreModel`** path as `buildModelFixtureFromActive` / `/api/model/active`:

1. **Baseline** — equal strength at the midpoint of carried `forecastInputs`, neutral venue (`computeMatchModel`).
2. **Elo gap** — actual strengths, 0 HFA.
3. **Home advantage** — actual strengths + provenance HFA (champion grid).
4. **Calibration** — delta from champion HFA grid to resolved model (1X2 preserved; ≈0).

Chained `deltaPHomePct` values **sum to** `(pricingExact.pHome − baseline.pHome) × 100` (`reconciliation.deltaPHomePctResidual === 0`). Public `shipped.pHome` is the rounded fixture row; parity test locks **Tottenham vs Coventry** at **59.92%** from strengths **1799.0 vs 1706.0** (+42 HFA).

Committed samples: **`docs/dossier/samples/`** (10 fixtures, 23–25 Oct 2026 EPL), built via `pnpm exec tsx scripts/build-dossier-samples.ts` (local VM, no prod env).

---

## 1. Problem

Today the **model** sees ClubElo + HFA (+ EPL calibration shape) and **chat** pulls football context via ad-hoc federated search. They do not share a single timestamped fact layer, so answers are slow, flaky, and weakly tied to the numbers.

**Match dossier** = one shared, scheduled, per-fixture document that both model explanation and chat must read (chat wiring comes later, default OFF).

---

## 2. Dossier shape (schema v2)

One JSON document per fixture (`schemaVersion: 2`), rebuilt on a schedule. **Retention:** every build is written to `$PUNDIT_DATA_DIR/match-dossiers/{fixtureId}/{as_of}.json` (ISO `builtAt` with `:` / `.` → `-`) **and** `latest.json`. Historical copies support backtests and corroboration replay; nothing is latest-only on disk.

| Schedule | Trigger |
|---|---|
| Every **6h** | Full rebuild for active build window |
| **T−90m** | Refresh imminent fixtures (lineups slot reserved) |
| **On-demand** | Top-up + write-back (Phase 3+) |

Every populated field uses **`ProvenanceField<T>`**: `{ value, provenance: { sourceId, label, trustTier, asOf, url? } }`.

### Field inventory

| Section | Fields | Phase 1 source |
|---|---|---|
| Identity | ESPN ids, kickoff, teams | Model + ESPN (**interim** — see §2.1) |
| Table | position, points, GD | ESPN standings via `club-form` |
| Form | last 5 / 10 (WDL + GF/GA) | ESPN season schedule |
| Splits | home/away form windows | ESPN |
| Rest | rest days, matches in 14d | ESPN |
| H2H | recent meetings, W-D-L | ESPN |
| Rolling xG | per-game xG/xGA | **Not ingested** (null + candidate flag) |
| Injuries / lineups / manager | evidence items | **Phase 2** federated search write-back (when `MATCH_DOSSIER_EVIDENCE_ENABLED=true`) |
| Model | 1X2, O2.5, BTTS + **factor breakdown** | Pundit Fundamental + counterfactual Elo/HFA steps |
| Market | no-vig 1X2 rows | Stake / Kalshi / Polymarket cache (**reference only**) |
| Evidence | structured items | Federated fan-out (#188); cited-only in output |
| Feature candidates | paths → calibration track | Interface only |

### 2.1 ESPN — interim source (CTO)

Disney/ESPN site terms restrict automated extraction; the public scoreboard JSON is **not** a licensed data product. Until legal/product sign-off:

- Schema: `DossierSourceRole = "interim"` and `trustTier: "interim-spine"` on ESPN-backed fields (`espnProvenance` in `builder.ts`).
- **Do not** expand public product surface area on ESPN (new competitions, commercial reuse, or “official data” marketing).
- Existing PL/UCL server-owned integration remains; dossier labels it explicitly.

### Evidence items (Phase 2)

Each item is structured and **never** blended into Fundamental probabilities:

```ts
{
  id, claim, sourceUrl, publisher,
  publishedAt, retrievedAt,
  trustTier: EvidenceTier,          // from evidence-authority.ts (#188)
  verification: "cited" | "unverified",  // unverified dropped from dossier output
  category: "injuries" | "rotation" | "manager" | "motivation" | "tactics" | "travel-congestion",
  direction: "supports-home" | "supports-away" | "supports-draw" | "neutral" | "contradicts-model",
  relatedFactor: ModelFactorId,
  origin: "scheduled" | "on-demand"
}
```

Federated retrieval follows **#188** (grounding, freshness/trust tiers, `agent-data-sources.json` roster). **No Brave.** No new fixed domain allowlists beyond existing `evidence-authority.ts` tiering.

Build path: `planDossierEvidenceQueries` → replay or `searchWebBatch` → `federatedResultsToEvidenceItems` → `evidence[]` plus partitioned `injuries` / `lineups` / `manager` slots.

Web search jobs:

1. **Corroborate/challenge** the model (injuries, rotation, manager, motivation, tactics, travel/congestion).
2. **Explain** market gaps in prose later (Phase 4) — stored as evidence, **never** as model input.

### Model factor breakdown (Phase 1)

Counterfactual steps on the Elo→goals grid:

1. Equal rating baseline at average Elo, 0 HFA.
2. **Elo gap** → actual elos, 0 HFA.
3. **Home advantage** → actual elos + HFA Elo.
4. Optional **calibration shape** row when EPL artifact active (1X2 delta ≈ 0 by design).

Narrative example (target chat shape, Phase 4):

> Spurs **59.9%** because **Elo +93** and **home advantage**; form drags (**0W in 6**, xGA **1.9**/game); Coventry concede **1.6** away.

### Chat contract (Phase 4 — not shipped here)

- Read dossier only; cite `field` + `provenance.sourceId`.
- Order: **our call** → **football reasoning** (factors + evidence agree/doubt) → **market once** as reference.
- Unverifiable facts dropped or labelled; never sink the pricing answer.

### Model feature candidates (Phase 5+)

Dossier exposes `featureCandidates[]` (`fieldPath`, `factorId`, note). Promotion only if held-out log loss improves in the **calibration track** (separate plan). No runtime activation in Phase 1.

---

## 3. Free vs paid source inventory

Derived from `agent-data-sources.json` + existing production adapters.

| Source | Cost | Access in Pundit | Dossier role | Rate / terms (summary) |
|---|---|---|---|---|
| **ESPN scoreboard** | Free (keyless) | Server-owned, ~30m adaptive | Table, form, rest, H2H | **INTERIM** — Disney ToU restrict automated extraction; label in schema; no new public ESPN surface |
| **ClubElo artifact** | Free (snapshot) | Server-owned release pin | Model strength / factor breakdown | No runtime scrape; 30d fail-closed |
| **Stake / Kalshi / Polymarket** | Free public endpoints | Bounded fetch ~30m | Market snapshot (compare-only) | Best-effort; Stake often blocked |
| **FBref, FotMob, SofaScore, WhoScored, FootyStats, Statbunker** | Free to read | Search citations only today | Rolling xG, style (Phase 2 evidence) | No API; scraping ToU vary |
| **BBC, Goal, Sky, beat press** | Free | Federated search | Team news, lineups, manager | Citation + allowlist |
| **Transfermarkt** | Free | Search | Injuries/squad hints | No fixture IDs |
| **Premier League / UEFA official** | Free | Search corroborate-only | Status/discipline | Explicit anti-scraping |
| **Oddschecker / Oddsportal** | Free | Search compare | Extra market context in prose | Compare-only |
| **API-Football (RapidAPI)** | **Paid** | Deferred | Unified fixtures/stats/odds | Needs key + license — **decision: Xavi** |
| **StatsPerform / Opta** | **Paid** | Deferred | Event/xG feed | Enterprise — **decision: Xavi** |
| **StatsBomb Open Data** | Free (CC) | Offline research only | Not live PL | Wrong competitions for slate |
| **The Odds API** | **Paid** | Candidate (GOAL.md) | Market spine upgrade | **decision: Xavi** |

Phase 1 builder uses only **ESPN + ClubElo pin + existing market cache + local model**.

---

## 4. Implementation (draft PR)

| Deliverable | Location |
|---|---|
| Typed schema v2 | `packages/api/src/services/match-dossier/types.ts` |
| Factor breakdown | `model-factor-breakdown.ts` |
| Builder + async evidence | `builder.ts`, `dossier-evidence.ts`, `form-stats.ts` |
| Persistence | `storage.ts` → `{fixtureId}/{as_of}.json` + `latest.json` |
| Scheduler | `schedule.ts` — 6h + T−90m poll when flag on (sync build unless evidence flag on) |
| Read API | `GET /api/match-dossier/:fixtureKey` — **404 unless `MATCH_DOSSIER_ENABLED=true`** |
| Tests | `match-dossier.test.ts`, `dossier-evidence.test.ts` (replay, no network) |
| Synthetic search replay (CI only) | `search-replays/synthetic-dossier-evidence-v1.json` (`synthetic: true`, `*.example.test` URLs) |

**Build window (Phase 1):** EPL kickoffs `2026-10-23T00:00:00Z` ≤ kickoff < `2026-10-26T00:00:00Z` (23–25 Oct weekend).

**Flags (local / CI only unless explicitly enabled in prod):**

| Variable | Default | Role |
|---|---|---|
| `MATCH_DOSSIER_ENABLED` | off | API + cron |
| `MATCH_DOSSIER_EVIDENCE_ENABLED` | off | Federated evidence write-back |
| `MATCH_DOSSIER_EVIDENCE_REPLAY` | `synthetic-dossier-evidence-v1` | CI replay id (blocked on real fixtures) |
| `CHAT_EVAL_SEARCH_REPLAY_DIR` | — | Set in tests to research replays |

**Production safety:** Dossier and evidence flags default OFF; no `ask.ts` / chat wiring; no env changes on Railway/Vercel for demo freeze.

### Phase 2 eval gate

- **No fabricated “real” evidence.** Committed EPL samples keep `evidence[]` empty until search results are captured, URLs resolve (HTTP 200), and claim text is verified on-page.
- CI uses **`synthetic: true`** replays for **North Testborough FC vs South Example City** only; synthetic replays are **refused** for real fixture ids (`dossier-evidence.test.ts`).
- When live capture ships: store raw provider responses with `retrieved_at` per query; only promote rows that pass URL + on-page verification.
- Model block (`pHome` / factor breakdown) unchanged by evidence merge (asserted in tests).

---

## 5. Phased roadmap

| Phase | Ships | Eval gate | Xavi decision |
|---|---|---|---|
| **1** | Schema, builder, storage, gated API, model factor export | API Vitest green; gate file untouched | — |
| **2** (this PR) | Federated search → dossier write-back; dated retention; ESPN interim labels | Replay determinism + cited evidence gate (`dossier-evidence.test.ts`) | — |
| **3** | On-demand search tops up dossier; chat reads dossier behind `MATCH_DOSSIER_CHAT=true` (default OFF) | Schema-17 insight scenarios + citation checks | — |
| **4** | Answer shape: call → factor reasoning → corroboration → market reference | Daily eval insight pack PASS | — |
| **5** | Feature candidate export → offline calibration track | Held-out log loss gate per field | Approve each promoted feature |
| **6** | Optional paid feeds (API-Football, Odds API, Opta) | License + identity mapping review | **Paid keys / contracts** |

---

## 6. Evals (Phase 4 target)

New chat-eval scenarios (future):

- Every football fact matches dossier field values and provenance.
- Reasoning sentences align with `model.value.factorBreakdown.counterfactualSteps`.
- Every external claim has dossier evidence id or field citation.
- **Corroboration section** present when evidence items exist.
- Market mentioned once, labelled reference.

---

## 7. Open questions (stop until answered)

1. **ESPN expanded ingestion** — Interim label shipped; legal/product sign-off still required before any **new** public ESPN surface or commercial reuse.
2. **API-Football or The Odds API** — Budget and priority vs improving Stake/Kalshi/Polymarket coverage?
3. **Opta/StatsPerform** — Is enterprise xG/event data on the roadmap for Phase 2 DC, or stay search-only?
4. **Dossier retention** — **Decided:** version chain per fixture (`{as_of}.json` + `latest.json`). Optional cap/TTL for Railway volume TBD.
5. **Chat flag rollout** — Single `MATCH_DOSSIER_CHAT` vs gradual tier (match-only first)?
6. **Investor demo** — Confirm zero Railway env toggles until after tonight’s main freeze (assume yes).

---

## 8. API quick reference (non-production)

```bash
# Enable locally only
export MATCH_DOSSIER_ENABLED=true

# After model cache warm, fetch dossier
curl -s "http://localhost:3001/api/match-dossier/espn:eng.1:401999001"
```

Response includes `_meta.servedFrom` = `storage` | `built`.
