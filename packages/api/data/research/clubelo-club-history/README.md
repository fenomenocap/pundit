# ClubElo per-club history (From/To)

Separate offline path from dated `api.clubelo.com/YYYY-MM-DD` snapshots.
Runtime model, readiness, and chat never read these files and must never
contact ClubElo or Wayback.

A valid body is ClubElo's own time-series:

```text
Rank,Club,Country,Level,Elo,From,To
```

Pre-kickoff Elo is the unique window covering the UTC calendar day **before**
kickoff (`latest-ranking-strictly-before-kickoff-utc-date`). Gaps and overlapping
windows fail closed. Do not reconstruct Elo from match results.

## Status — 2026-09-09

Host CDX (`matchType=host`, `collapse=urlkey`) listed every archived
`api.clubelo.com` original. Club-like CSV paths:

| Original | Body | From/To coverage | PL corpus? |
|---|---|---|---|
| `astonvilla` (latest `20190918191146`) | ClubElo CSV, 6226 Aston Villa rows | 1946-07-07 → 2019-12-31 | No — ends 2019 |
| `ipswichtown` (`20190919103735`) | Header only | none | No |
| `Bayern` | CSV listed; not fetched after IA went offline | unknown; not a PL club | No |
| `RealMadrid` (`20250817070222`) | ClubElo CSV, 5523 Real Madrid rows | 1939-10-22 → 2025-12-31 | No — not a PL club; also misses 2026-05-23 |
| `Arsenal`, `Liverpool`, `ManUnited` | CDX `[]` / timeout then IA offline | none | Missing |

None of the **23** ESPN PL corpus clubs have a From/To series covering
2024-08-15 → 2026-05-23. Dated ranking CSVs remain the five days already
documented (`2008-02-02`, `2008-03-29`, `2017-01-01`, `2024-09-02`,
`2025-01-23`). Capture stored **0** club-history artifacts. Ratings were
not invented. Full-window chronological Elo is still blocked; a reviewed
590/760 partial-fit challenger is registered in source for offline eval only
(not production).

Citations for the two identity bodies that were inspected, not stored:

- https://web.archive.org/web/20190918191146id_/http://api.clubelo.com:80/astonvilla
- https://web.archive.org/web/20250817070222id_/http://api.clubelo.com/RealMadrid
- CDX: https://web.archive.org/cdx/search/cdx (`url=api.clubelo.com`, `matchType=host`)

## Resume

Wait until Internet Archive CDX is healthy (the 2026-09-09 probe ended on
`Temporarily Offline`). Do **not** hammer live `api.clubelo.com` (still 502).
Do **not** use homepage HTML or `/YYYY-MM-DD` placeholders.

```bash
# 1. One host inventory (stop if this is HTML offline)
curl -sS -A 'Mozilla/5.0 (compatible; pundit-release-capture/1.0)' --max-time 30 \
  'https://web.archive.org/cdx/search/cdx?url=api.clubelo.com&matchType=host&output=json&fl=original,mimetype,statuscode&collapse=urlkey'

# 2. If new PL slugs appear (Arsenal, Liverpool, ManCity, ManUnited, Chelsea, …),
#    CDX that slug, then fetch the latest identity body. Delay ≥2s.
#    Abort after two consecutive CDX/body failures.

# 3. Coverage gate: every PL corpus club must have From/To covering
#    ranking dates from 2024-08-15 through 2026-05-23. If any club is
#    missing or the series ends before that window: STOP.

# 4. Only after that gate:
pnpm --filter @sports-predict/api build:clubelo-pre-kickoff
pnpm --filter @sports-predict/api train:dixon-coles-mle
pnpm --filter @sports-predict/api eval:dixon-coles-mle
pnpm --filter @sports-predict/api register:dixon-coles-mle
```

Registration is not activation. Production champion stays `clubelo`.
