# Pundit data sources — The owner's list (canonical)

Source: Owner, in cloud agent bc-019f8ddf (Pundit research, Sept 2026), verbatim list. Refer back to this before any data-source work.

## Free / open (owner named)
- WhoScored — https://www.whoscored.com/
- The Analyst (Opta) — https://theanalyst.com/ (competition/premier-league, /stats, opta-football-predictions)
- Transfermarkt — https://www.transfermarkt.co.uk/navigation/statistiken
- Statbunker — https://www.statbunker.com/
- FotMob — https://www.fotmob.com/
- FBref — https://fbref.com/en/ (incl. player pages)
- Sofascore — https://www.sofascore.com/
- FootyStats — https://footystats.org/
- Also named: BBC Sport, Goal.com, Premier League + other leagues' official sites, CBS Sports
- The owner's note: "all these sources have betting data/odds too"

## Gated / paid (owner named)
- API-Football — https://www.api-football.com/documentation-v3
- playerstats.football — https://playerstats.football/
- Stats Perform Dynamic Stats API — https://www.statsperform.com/products/dynamic-stats-api/ (paid; "where else can we get such data?")

## Already in use / referenced
- ESPN (fixtures, table, form; interim; owner: don't be ESPN-myopic)
- ClubElo (pinned model input; no runtime scrape)
- Understat, StatsBomb open data (xG, backtest)
- football-data.co.uk (results + Pinnacle closes; non-commercial licence)
- Kalshi, Polymarket (market odds; Stake blocked by Cloudflare)
- FPL bootstrap-static API (injury status; interim, terms unclear)

## Standing rules (owner)
- No spray-and-pray: a small curated set, ONE primary source per field (+ at most one fallback); if those don't have the fact, say nothing.
- Don't over-rely on ESPN; don't jump to paid first; no Brave as strategy; no fixed binary allowlist (use trust tiers).
- Third-party stats/predictions never blend into our model's probabilities. Market stays separate (Consensus view).
- Paid sources need the owner's yes.

## Field → source mapping (tested 20 Oct 2026, Chelsea v Spurs; full notes /workspace/news-rca/REPORT.md)
| Field | Primary | Fallback |
|---|---|---|
| Fixture identity | Premier League official API (match ID = FPL code = Opta ID) | ESPN |
| Injuries & doubts | FPL bootstrap (PL-run) | FotMob |
| Suspensions | FPL | none |
| Confirmed lineups | PL official API | ESPN |
| Predicted lineups | DROP | — |
| Manager | PL match-day lineup manager | PL staff list only if exactly one manager |
| Form/table/H2H/rest | ESPN | FotMob |
| xG / advanced | The Analyst | FootyStats |
| Previews & quotes | BBC preview via fixture page | PL match preview |

Blocked (403): Sofascore, WhoScored, FBref. Transfermarkt lagging + ToS forbids scraping. FotMob ToS restricts automated access. FPL/PL API commercial terms unclear. Licensed single-source option: API-Football (paid, needs the owner yes).
Open web search is OUT of the fact path (discovery only). Join on IDs, not club-name patterns.

## Source groups (20 Oct 2026, free-only; machine-readable: source-groups.json in this folder)
Owner, 20 Oct: no paid sources for now. Every primary and fallback below is free. API-Football, playerstats.football and Stats Perform are **deferred (paid)**.

| Group | Primary | Fallback | Corroborate only | Access |
|---|---|---|---|---|
| Fixture identity | PL official API (matchId = Opta = FPL code) | ESPN | FotMob, Goal, BBC, FPL | structured API |
| Injuries & doubts | FPL | FotMob | Club official, PL editorial, Goal, Transfermarkt | structured API |
| Suspensions | FPL | Goal match page (new) | Transfermarkt, Statbunker, PL editorial | API / per-fixture page |
| Confirmed lineups | PL official API | ESPN | Goal, club official, FotMob | structured API |
| Manager | PL match-day lineups | Goal match page (new) | Club official, PL editorial | API / per-fixture page |
| Form / table / H2H | ESPN | FotMob | Goal, Statbunker, FootyStats | structured API |
| xG / advanced | FootyStats fixture page (new) | FPL player-xG total | Understat, The Analyst articles | per-fixture page / API |
| Player stats | FPL | none | Statbunker, Transfermarkt, The Analyst | structured API |
| Previews / quotes / press | PL editorial API by matchId (new) | Club official site (new) | BBC live page, Goal, CBS | ID-keyed API, then per-fixture page |
| Transfers / market value | Club official | PL editorial | BBC, Goal, Transfermarkt (values) | API / scoped search |
| Odds / market | Kalshi | Polymarket | football-data closes, Oddschecker, OddsPortal | structured API |
| Historical / backtest | football-data.co.uk | Understat (offline) | ClubElo artifact, StatsBomb open, FPL | CSV / offline |

Dropped or blocked: predicted lineups (all sources); Sofascore, WhoScored and FBref (403); Stake (Cloudflare); The Analyst as a data feed (its stats are JS-only, behind Stats Perform's keyed API; articles only); Understat at runtime (robots.txt disallows everything, so backtests only).

### Tested 20 Oct (box, Chelsea v Spurs 24 Oct + Spurs 3-1 Coventry 19 Oct)
- **Goal.com** match page `goal.com/en/match/{home}-vs-{away}/{uuid}` (linked from the team page): 200. The `__NEXT_DATA__` holds per-fixture injuries (Chelsea 4, Spurs 5, missing Porro), **suspensions (Bentancur)**, managers (X. Alonso, R. De Zerbi), form, H2H and a table stamped 19 Oct 20:58Z. It has the confirmed XI and formation after the match, but no doubts or % chances.
- **PL editorial API** `api.premierleague.com/content/premierleague/text/EN/?references=SDP_FOOTBALL_MATCH:{matchId}`: 200. Spurs v Coventry returned the presser, injury quotes ("De Zerbi on Savio and Bergvall…") and an injuries roundup. Che–Tot already has 4 items (Martínez surgery, match officials). Some tagged items are about the previous match, so check the content.
- **Spurs official** `api.thfc.pulselive.com/content/thfc/text/EN/?references=SDP_FOOTBALL_MATCH:{matchId}`: 200. It returned 19 items for Coventry ("Team news | Bergvall, Savio out…", the pre-match presser, confirmed line-ups, an Udogie update). It also carries women's (WSL) content, so filter that out.
- **Chelsea official**: news pages are rendered by JavaScript. The sitemap `chelseafc.com/en/sitemap.xml` (33.6k URLs with lastmod) shows the URL patterns: `confirmed-chelsea-line-up-vs-{opp}-{ddmmyy}`, `alonso-press-conference-pre-{opp}-...`. The articles themselves are server-rendered. There's no match ID, so items must name both clubs and fit the date. Women's items use the same slugs.
- **BBC**: the fixtures page links each match to `/sport/football/live/{id}`, a page of timestamped posts with quotes (Lampard post-match). The Che–Tot page isn't up yet.
- **FootyStats** `footystats.org/england/{a}-vs-{b}-h2h-stats`: 200. It shows the kickoff (24 Oct) and season xG/xGA (Chelsea 1.61/1.58, Spurs 1.62/1.45 per game), including home/away splits. robots.txt allows it.
- **Statbunker**: PL table (comp_id 791) is current to 19 Oct, but each page takes 8–15 s and it's HTML only.
- **CBS Sports**: 200. Editorial with JSON-LD dates. There's no per-fixture page, and its EPL pages are full of Kalshi-promo picks.
- **The Analyst**: 200, but the stats and predictions HTML has no data (it's loaded client-side from api.performfeeds.com with an embedded key). Articles are dated.
- Also: Understat JSON works (data to 19 Oct) but robots.txt disallows everything. football-data.co.uk CSV's last row is 12 Oct and it now has HxG/AxG. Kalshi and Polymarket return 200. api.clubelo.com timed out.

### How the build must enforce it
1. Each dossier field maps to exactly one group. The group is picked by the field, never by the query text.
2. Try the primary, then the fallback. Corroborate-only sources can confirm a fact, never add one. If neither primary nor fallback has the fact, say nothing.
3. Scoped search (only where `searchAllowed`) passes `searchIncludeDomains` as the include-domains filter. The query is sent verbatim (no LLM rewrite) and logged.
4. Accept an item only if it carries the fixture ID, or its content names both clubs and the competition and its date sits after each club's previous match and before kickoff.
5. Set the slot from the content or feed field (FPL status, Goal `suspensions[]`), never from the query that found it.
6. Join clubs by provider team ID, not name regexes. Drop women's, academy and U21 items.
7. Third-party xG, predictions and odds never set our probabilities.

Note: where this section differs from the 20 Oct field mapping above, this section wins. xG primary has moved from The Analyst to FootyStats, and the previews primary from BBC to the PL editorial API.


## Odds (override, owner 2026-10-20 13:05)
Odds are AGGREGATE-ALL, not primary/fallback: show every live source's price side by side (currently Kalshi, Polymarket) with as-of time, best price and our fair price. More free books get added as they're verified; stale/failing sources are dropped from the table. Market never feeds our probabilities.
