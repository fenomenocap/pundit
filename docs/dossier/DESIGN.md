# Match dossier — design and phased plan

**Status:** Phase 1 draft (schema + builder + storage + gated API). Chat does **not** read the dossier until a later phase behind explicit wiring.

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

### Prior agent / PR notes

- **#188 federated search:** Evidence layer for chat; grounding + freshness + trust tiers. Dossier **stores** the same class of items on a fixture schedule instead of re-searching per turn.
- **Cloud agent bc-019f8ddf:** No transcript found in this environment; the roster above (`agent-data-sources.json`, dated 2026-09-15) is the durable research output to reuse.
- **Prediction brief / Phase 0–3:** Market stays comparison-only; evidence never moves probabilities; fitted DC remains registered-not-activated.

---

## 1. Problem

Today the **model** sees ClubElo + HFA (+ EPL calibration shape) and **chat** pulls football context via ad-hoc federated search. They do not share a single timestamped fact layer, so answers are slow, flaky, and weakly tied to the numbers.

**Match dossier** = one shared, scheduled, per-fixture document that both model explanation and chat must read (chat wiring comes later, default OFF).

---

## 2. Dossier shape (Phase 1 schema)

One JSON document per fixture (`schemaVersion: 1`), rebuilt on a schedule:

| Schedule | Trigger |
|---|---|
| Every **6h** | Full rebuild for active build window |
| **T−90m** | Refresh imminent fixtures (lineups slot reserved) |
| **On-demand** | Top-up + write-back (Phase 3+) |

Every populated field uses **`ProvenanceField<T>`**: `{ value, provenance: { sourceId, label, trustTier, asOf, url? } }`.

### Field inventory

| Section | Fields | Phase 1 source |
|---|---|---|
| Identity | ESPN ids, kickoff, teams | Model + ESPN |
| Table | position, points, GD | ESPN standings via `club-form` |
| Form | last 5 / 10 (WDL + GF/GA) | ESPN season schedule |
| Splits | home/away form windows | ESPN |
| Rest | rest days, matches in 14d | ESPN |
| H2H | recent meetings, W-D-L | ESPN |
| Rolling xG | per-game xG/xGA | **Not ingested** (null + candidate flag) |
| Injuries / lineups / manager | evidence items | **Empty placeholders** (Phase 2 search write-back) |
| Model | 1X2, O2.5, BTTS + **factor breakdown** | Pundit Fundamental + counterfactual Elo/HFA steps |
| Market | no-vig 1X2 rows | Stake / Kalshi / Polymarket cache (**reference only**) |
| Evidence | structured items | `[]` in Phase 1 |
| Feature candidates | paths → calibration track | Interface only |

### Evidence items (Phase 2+)

```ts
{
  id, capturedAt, headline, detail?, url?,
  trustTier: EvidenceTier,
  direction: "supports-home" | "supports-away" | "supports-draw" | "neutral" | "contradicts-model",
  relatedFactor: ModelFactorId,
  origin: "scheduled" | "on-demand"
}
```

Web search jobs:

1. **Corroborate/challenge** the model (injuries, rotation, manager, congestion, tactics).
2. **Explain** why our price and the market’s differ — stored as evidence, **never** as model input.

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
| **ESPN scoreboard** | Free (keyless) | Server-owned, ~30m adaptive | Table, form, rest, H2H | Undocumented JSON; Disney ToU restrict automated extraction — existing integration only |
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

## 4. Phase 1 implementation (this draft PR)

| Deliverable | Location |
|---|---|
| Typed schema | `packages/api/src/services/match-dossier/types.ts` |
| Factor breakdown | `model-factor-breakdown.ts` |
| Builder | `builder.ts`, `form-stats.ts` |
| Persistence | `storage.ts` → `$PUNDIT_DATA_DIR/match-dossiers/{fixtureId}/latest.json` |
| Scheduler | `schedule.ts` — 6h + T−90m poll when flag on |
| Read API | `GET /api/match-dossier/:fixtureKey` — **404 unless `MATCH_DOSSIER_ENABLED=true`** |
| Tests | `match-dossier.test.ts` |

**Build window (Phase 1):** EPL kickoffs `2026-10-23T00:00:00Z` ≤ kickoff < `2026-10-26T00:00:00Z` (23–25 Oct weekend).

**Production safety:** Default OFF flag; no `ask.ts` changes; no env changes on Railway/Vercel for demo freeze.

---

## 5. Phased roadmap

| Phase | Ships | Eval gate | Xavi decision |
|---|---|---|---|
| **1** (this PR) | Schema, builder, storage, gated API, model factor export, unit tests | API Vitest green; gate file untouched | — |
| **2** | Federated search → dossier write-back (injuries, manager, rotation); pre-kickoff lineup slot | Insight scenarios: facts ⊆ dossier | — |
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

1. **ESPN expanded ingestion** — Legal/product sign-off for any server-side fetch beyond current PL/UCL scope?
2. **API-Football or The Odds API** — Budget and priority vs improving Stake/Kalshi/Polymarket coverage?
3. **Opta/StatsPerform** — Is enterprise xG/event data on the roadmap for Phase 2 DC, or stay search-only?
4. **Dossier retention** — How many historical builds per fixture on Railway `/data` (latest-only vs version chain)?
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
