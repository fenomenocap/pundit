# Chronological ClubElo pre-kickoff corpus

Offline, reviewed pipeline that maps `(fixture, kickoff)` to `(homeElo, awayElo)`
as they stood **strictly before kickoff**. Runtime model, readiness, and chat
code never read these files and must never contact ClubElo or Wayback.

Lookup policy: `latest-ranking-strictly-before-kickoff-utc-date`. The ranking
date is the UTC calendar day before kickoff. Same-day ClubElo files are
rejected because they may already include earlier matches that day. Missing
clubs or dates fail closed; ratings are not invented.

## Capture (contacts ClubElo / Wayback from this script only)

Dated CSV only (`http://api.clubelo.com/YYYY-MM-DD`, then `https`). Live API
is preferred. If that date returns 5xx/empty, the script falls back to the
Internet Archive Wayback Machine **for that same calendar date only**.

Do **not** use ClubElo homepage HTML, dated ranking HTML, club time-series
CSVs (`/RealMadrid`), or the literal `/YYYY-MM-DD` placeholder as historical
ratings.

```bash
# Unique ranking dates implied by the ESPN club-history corpus (preferred)
pnpm --filter @sports-predict/api capture:clubelo-history -- --dates-from-corpus --delay-ms 1000

# Documented subset (first N uncaptured dates); resume the same command
pnpm --filter @sports-predict/api capture:clubelo-history -- --dates-from-corpus --limit 12 --delay-ms 1000

# Every day in the historical season specs, including the day before each range
pnpm --filter @sports-predict/api capture:clubelo-history -- --dates-from-specs

# Explicit inclusive UTC range
pnpm --filter @sports-predict/api capture:clubelo-history -- --from 2024-07-31 --to 2026-06-30

# Print dates without fetching
pnpm --filter @sports-predict/api capture:clubelo-history -- --dates-from-specs --dry-run
```

`--dates-from-corpus` requires a prior `build:club-history` output. Raw CSVs are
content-addressed under `raw/csv/<date>/<sha256>.csv.gz` and are gitignored.
Rerunning never replaces a different payload at the same path. Resume is
index-based: dates already in `index.json` are skipped.

After ten consecutive live API failures the remaining dates skip ClubElo and
only fetch Wayback bodies that the CDX inventory listed for that date. Ten
consecutive Wayback body failures abort the run.

### Citation

- ClubElo ratings: About page permits reuse with citation
  <https://clubelo.com/About>. That statement is not a formal API SLA.
- Wayback retrieval: Internet Archive Wayback Machine copy of the original
  dated ClubElo CSV, located via the CDX API
  (`https://web.archive.org/cdx/search/cdx`, host `api.clubelo.com`,
  `mimetype:text/csv`) and fetched as an identity capture
  (`/web/{timestamp}id_/{original}`). See
  <https://web.archive.org> and
  <https://github.com/internetarchive/wayback/wiki/CDX-Server-API>.
  Index rows that used this path set `captureSource: "internet-archive-wayback"`
  and `retrievalCitation: "internet-archive-wayback"`. Preserve both citations
  and seek permission before broader redistribution.

## Join against ESPN history

```bash
pnpm --filter @sports-predict/api build:clubelo-pre-kickoff
```

This builder does **not** contact ClubElo. It reads `club-history/latest.json`
plus `clubelo-history/index.json`, writes a content-addressed dataset, and
records whether Premier League training-eligible fixtures are fully covered.
UCL remains out of promotion until expected-count and regulation-time scores
exist, even if some qualifier ratings are present.

## Fitted Dixon-Coles trainer

```bash
pnpm --filter @sports-predict/api train:dixon-coles-mle
pnpm --filter @sports-predict/api train:dixon-coles-mle -- --force
```

Offline time-decayed attack/defence MLE (intercept, HFA, `rho`, ClubElo prior
for promoted / low-sample clubs). Fails closed without the ESPN club-history
corpus **and** a complete PL pre-kickoff ClubElo join. Emits a content-addressed
artifact plus rolling-origin split manifests under `dixon-coles-mle/` (gitignored).
Does **not** wire into model-data / chat / readiness. Registration is a
separate fail-closed helper (`register:dixon-coles-mle`) that appends
`dixon-coles-mle` only when `research/dixon-coles-mle/latest.json` validates;
without that artifact `REGISTERED_CHALLENGERS` stays empty.

Paired champion/challenger evaluation is a separate offline gate:

```bash
pnpm --filter @sports-predict/api eval:dixon-coles-mle
```

It fail-closes without the fitted artifact (and without the ESPN + pre-kickoff
join). Champion forecasts use shipped **1.35 / 42 / −0.1**. A promotion
recommendation requires held-out Brier, log-loss, and calibration to improve
on at least two rolling origins with n≥40 each. `activateProduction` stays
false; a human still has to deploy. The report is gitignored under
`dixon-coles-mle/eval-report.json`.

## What is committed

README and tests only. Raw ClubElo CSVs, generated datasets, manifests, and
`latest.json` stay local, matching the club-history corpus convention.

## Status — 2026-09-09 (tonyelhabr GitHub dump)

A **new** public ClubElo mirror, not live `api.clubelo.com` and not Wayback:

- <https://github.com/tonyelhabr/club-rankings>
- Release asset: <https://github.com/tonyelhabr/club-rankings/releases/download/club-rankings/clubelo-club-rankings.csv>
- Official header `Rank,Club,Country,Level,Elo,From,To` plus scrape `date` / `updated_at`
- 914 scrape days, **2023-03-27 → 2026-01-14** (49 MB, 581,279 rows)
- Gitignored copy: `raw/tonyelhabr/clubelo-club-rankings.csv` and `raw/tonyelhabr/inventory.json`

All **23** PL corpus clubs appear on 2024-08-15, 2025-08-15, and 2026-01-14. Against the ESPN PL corpus (760 fixtures; 223 UTC-day-before ranking dates):

| Join | Count |
|---|---|
| Exact ranking-date hits | 150 / 223 |
| From/To strict (`From <= policyDate <= To`) | **590 / 760** (370/380 in 2024–25, 220/380 in 2025–26) |
| All-club policy dates (From/To) | 166 / 223 |
| 14-day stale join (legacy) | **600 / 760** (370/380 in 2024–25, 230/380 in 2025–26) |
| Stale > 14 days | 160 |

Holes: scrape gap ~**2024-12-20 → 2025-01-03**; dump ends **2026-01-14** so **2026-01-15 → 2026-05-23** has no dated ranking. The **full-window** pre-kickoff gate remains blocked. A reviewed **590/760 partial fit** exists (artifact SHA `15e20da1…`); source `REGISTERED_CHALLENGERS` holds `dixon-coles-mle` as challenger only — **registration is not activation**; do not retrain on the partial dump without new reviewed captures.

**Re-verified 2026-09-09 evening:** gh/curl confirmed tonyelhabr release asset unchanged (asset updated **2026-01-14**, 48,935,087 B, SHA matches local). No newer GitHub mirror with official schema. `build:clubelo-pre-kickoff` reaffirmed **590/760**.

Other mirrors checked and rejected as incomplete: eddwebster `football_analytics` From/To CSVs (~2021), xgabora / Kaggle twice-monthly remapped Elo (through Dec 2024), ArturJFFreitas fork of the same release, <https://clubelo.com/About> (citation only; official CSV export is still the 502 API). FiveThirtyEight SPI and football-data Elo were not used.

## Status — 2026-09-09 (club-history Wayback probe)

The ESPN club-history corpus was rebuilt on this checkout
(`00f7065a80a5…`, 380/380 both PL seasons). A dry-run of
`capture:clubelo-history --dates-from-corpus` listed **253** unique ranking
dates. Live dated ClubElo and live per-club CSVs remain **HTTP 502**. Do not
hammer them.

Wayback dated ranking CSVs are still only five days (`2008-02-02`,
`2008-03-29`, `2017-01-01`, `2024-09-02`, `2025-01-23`); none of the 253
corpus ranking dates. Dated capture stored **0/253**.

A **separate** host CDX (`collapse=urlkey`) listed every archived
`api.clubelo.com` original. Per-club history CSVs exist for `astonvilla`
(ClubElo From/To through **2019-12-31**), `ipswichtown` (header only),
`Bayern`, and `RealMadrid` (through **2025-12-31**, not a PL club). CDX for
`Arsenal` / `ManUnited` was empty; `Liverpool` timed out, then Internet
Archive returned **Temporarily Offline** — probe aborted. **0/23** PL corpus
clubs have a From/To series covering 2024-08-15 → 2026-05-23. No club-history
artifacts were stored. Ratings were not reconstructed from results.

See `../clubelo-club-history/README.md`. Incomplete coverage fails the
**full-window** pre-kickoff join. The 590-row partial fit and source
registration above are offline only; `model-data.ts` still uses `ELO_CHAMPION`
only. The rolling-origin eval gate (`eval:dixon-coles-mle`) fail-closes without
the fitted artifact on disk.

## Status — 2026-09-10 (alt-archives probe)

Two new sources only (not live ClubElo, not Wayback, not CC CSV CDX).

| Source | Queries | Result |
|---|---|---|
| Common Crawl HTML (`clubelo.com/YYYY-MM-DD` ranking pages) | CDX spot-check | **Unreachable** — `index.commoncrawl.org` empty reply (curl 52); likely IP blocked after prior 127-index CSV scan |
| archive.ph / archive.is / archive.today | 16 (dated CSV + HTML + PL club slugs) | **None** — HTTP 429 on direct probes; `/newest/` 404 for api + Arsenal/Liverpool/ManUnited |
| ghostarchive.org | vidsearch | **None** — 0-byte body |

No downloads. From/To join unchanged **590/760**. Inventory:
`raw/alt-archives/inventory.json` (gitignored). Do not hammer archive.ph or
Common Crawl from this IP.

## Status — 2026-09-10 (Common Crawl CSV CDX)

CDX search only via `index.commoncrawl.org` (UA `pundit-commoncrawl-probe/1.0`,
500 ms pacing). **Common Crawl CSV: none.**

| Query | Indexes | Hits |
|---|---|---|
| `api.clubelo.com/*` (domain) | all 127 | **0** |
| `api.clubelo.com/2025-01-03`..`05`, `2026-01-15`..`2026-05-23` | 23 corpus-overlap | **0** |
| `clubelo.com/*` `mime:text/csv` | spot-check | **0** (HTML only) |

No downloads. From/To join unchanged **590/760**. Inventory:
`raw/commoncrawl/inventory.json` (gitignored). Do not retry Common Crawl for
this gate unless a future index publishes `api.clubelo.com` CSV captures.

## Status — 2026-09-10 (academic / supplementary channels)

Searched arXiv, Papers With Code, figshare, Dryad, Harvard Dataverse, DataCite,
ZBW Journal Data Archive, and Mendeley (excluding the 2026-09-09 Zenodo/OSF/HF
sweep). **No official-schema dump.**

| Channel | Result |
|---|---|
| arXiv (`2406.19222`, `2304.09078`, `2508.20075`, …) | Papers cite `api.clubelo.com/YYYY-MM-DD`; source bundles LaTeX-only |
| figshare / Dryad | **0** ClubElo hits |
| Harvard Dataverse / DataCite | **0** clubelo; JBNST replication has season-pair Elo only (not From/To) |
| ZBW Journal Data Archive | **1** clubelo keyword hit — aggregated Stata, not chronology |

No downloads. From/To join unchanged **590/760**.

### Resume

Need dated ClubElo (or From/To) that closes the tonyelhabr holes above.
Do not hammer live ClubElo, Wayback, or Common Crawl. Do not invent Elo from results.
Do not train on the partial tonyelhabr dump.

```bash
# Host inventory first (one request). Stop if the body is HTML / Temporarily Offline.
curl -sS -A 'Mozilla/5.0 (compatible; pundit-release-capture/1.0)' --max-time 30 \
  'https://web.archive.org/cdx/search/cdx?url=api.clubelo.com&matchType=host&output=json&fl=original,mimetype,statuscode&collapse=urlkey'

# If new PL slugs appear with From/To covering 2024-08-15..2026-05-23 for all
# 23 corpus clubs, store gitignored identity captures with citation, then:
pnpm --filter @sports-predict/api build:clubelo-pre-kickoff
pnpm --filter @sports-predict/api train:dixon-coles-mle
pnpm --filter @sports-predict/api eval:dixon-coles-mle
pnpm --filter @sports-predict/api register:dixon-coles-mle
```

Registration is not activation. Promotion still needs the eval gate plus a
human decision. Do not wire `model-data.ts` / chat / readiness to the
challenger.
