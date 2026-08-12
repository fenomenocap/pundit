# Fixture source study

**Audit date:** 2026-08-13

**Scope:** fixture recognition only; no forecast inputs, probabilities, or runtime changes

**Companion matrix:** `packages/api/data/research/fixture-sources/coverage-matrix.json`

## Decision

ESPN is the best technical primary source among the sources tested: one public
scoreboard shape covers domestic leagues, domestic cups, UEFA club
competitions, club friendlies, senior internationals, qualifiers, and
international friendlies. Its event, competition, team, and venue identifiers
are materially stronger identity evidence than names found by search.

That conclusion does **not** establish permission to expand automated use.
ESPN's endpoint is undocumented and keyless, has no published service level or
rate limit, and the Disney terms linked from ESPN prohibit automated access or
copying without express written permission. UEFA and The FA also expressly
prohibit automated collection, while Premier League terms prohibit re-use to
create a database without prior written approval. No public FIFA fixture API
license was found. Accordingly:

1. Preserve the existing ESPN integration while product/legal ownership
   confirms its authorization; do not expand ingestion merely because another
   ESPN league slug responds.
2. Treat an ESPN event as technically eligible for recognition only after the
   competition slug and season have passed completeness and change-handling
   validation.
3. Admit a free official structured feed only when its owner documents machine
   use or grants written permission and it passes the same contract tests.
4. Use official competition, federation, and club pages to corroborate a
   discovered fixture manually or through ordinary bounded search. Their
   presence is not permission to scrape them and their names are not stable
   fixture identity.
5. Search results are discovery evidence only. They never create a recognized
   fixture, source mapping, model fixture, or forecast.

This is a technical and product-risk assessment, not legal advice.

## Method

The audit read Pundit's ESPN implementation, queried bounded public scoreboard
windows without retaining raw responses, and compared sampled records with
current primary-source pages and terms. The probes covered these ESPN slugs:

| Category | Sampled ESPN slug | Bounded result |
|---|---|---|
| Domestic league | `eng.1` | 380 events for 2025/26; sampled event, team, venue, and UTC kickoff IDs present |
| Domestic cup | `eng.fa`, `eng.league_cup` | 123 FA Cup and 93 League Cup events for 2025/26; AET and penalties represented distinctly |
| UEFA club competition | `uefa.champions`, `uefa.champions_qual` | 189 Champions League and 92 qualifying events for 2025/26 |
| Club friendly | `club.friendly` | 141 events in the sampled 2025/26 window; at least one retained cancellation |
| Senior international tournament | `fifa.world` | 104 World Cup events in the sampled 2026 tournament window |
| Qualifier | `fifa.worldq.uefa` | 156 events in the sampled 2025/26 window |
| International friendly | `fifa.friendly` | 457 events in the sampled 2025/26 window; cancelled events retained |

Counts demonstrate response coverage, not completeness certification. Only the
Premier League sample has a simple independent expected count (380). Friendly
coverage is especially open-ended and cannot be certified from an ESPN count.

No raw response or page capture was written to the repository. The observations
below are reduced contract evidence only.

## Measured source contracts

### 1. ESPN public soccer scoreboard

**Shape observed.** The endpoint returns league `id`/`uid`/`slug`; event
`id`/`uid`; an ISO-8601 UTC kickoff; a competition ID; competitors with stable
team IDs, UIDs, display names, and home/away roles; a venue ID/name when known;
`neutralSite`; `wasSuspended`; and structured status fields (`id`, `name`,
`state`, `completed`, `description`, `detail`). Final-after-extra-time and
final-after-penalties are distinct. `STATUS_CANCELED` was observed for both a
club friendly and international friendlies.

**Identity.** Use the ESPN league slug plus ESPN event ID as the external key;
retain event UID, competition ID, both source team IDs, and the source team
names observed at ingestion. ESPN IDs are not interchangeable with official
competition IDs. For example, Liverpool v Bournemouth on 2025-08-15 is ESPN
event `740596` but Premier League match `2561895`.

**Kickoff and changes.** The sampled kickoff is UTC, but there is no source
observation timestamp, revision number, original kickoff, or explicit local
timezone in the core scoreboard object. A refreshed event can therefore show a
new kickoff without explaining the change. Pundit must store its own
`observedAt` history and never overwrite a prior schedule observation. The
Premier League says fixtures may change date or kickoff time and publishes
amendment circulars; its official calendar updates automatically when fixtures
are rescheduled.

**Venue and neutral state.** Venue ID/name, `neutralSite`, and `wasSuspended`
are valuable but nullable. Null is unknown, not false. Names can conflict
without the venue being different: the sampled World Cup opener used ESPN's
`Estadio Banorte` while FIFA's official schedule called it `Mexico City
Stadium`. Cross-source venue aliases require explicit mapping, not string
replacement.

**Statuses.** Preserve the complete ESPN status type. The current Pundit
transformer maps every non-`post`, non-`in` state to `SCHEDULED`, so a cancelled
event whose ESPN state is `post` but `completed` is false is currently
misclassified as `FINISHED`. A universal registry must map exact status names
and fail closed on unknown names; it must not infer cancellation or
postponement from `state` alone.

**Latency and conflicts.** ESPN publishes no per-event update timestamp or SLA,
so source update latency could not be measured from this one-day audit. The
existing 30-minute polling cadence bounds Pundit's *detection* latency after an
ESPN change, not ESPN's publication latency. Certification requires a
longitudinal shadow log comparing changes with timestamped official notices.

**Terms and rate limits.** The endpoint is undocumented. No official quota,
rate limit, uptime commitment, schema version, or redistribution license was
found. Disney's current terms prohibit automated access, monitoring, copying,
or extraction without express permission. Treat authorization and capacity as
unresolved release gates rather than interpreting a successful HTTP response
as a license.

### 2. Premier League website and ECAL calendar

The official match page exposes a stable-looking match path ID, teams, kickoff,
stadium, matchweek, and result. The official downloadable calendar covers all
380 fixtures and says it updates automatically when matches are rescheduled.
The publications page provides dated fixture-amendment circulars. Together
these are strong corroboration for Premier League scheduling changes.

They are not an approved registry feed. The website terms limit use to private
and personal use and prohibit reproducing or reusing the site to create a
database without prior written approval. ECAL is a third-party calendar service
linked by the league; no machine-ingestion license, stable UID contract, status
taxonomy, venue/neutral guarantee, or rate limit was found. Do not automate it
unless written permission and the ECAL terms explicitly cover Pundit's use.

### 3. UEFA match centre and information kits

UEFA fixture pages and media information kits cover UEFA club competitions,
European qualifiers, senior internationals, and friendly matches. Match URLs
include a match number (for example `2040264`), and pages can expose teams,
kickoff, score, officials, and detailed match information. Competition rules
also define formal rescheduling and venue-change authority.

UEFA's general terms prohibit systematic collection, automated scraping, and
using platform content to develop software or models. The internal JSON used
by UEFA's own site/app is therefore not an eligible free structured feed.
UEFA pages remain excellent official corroboration through bounded ordinary
search or human review, but cannot fill ESPN gaps automatically without a
separate license.

### 4. FIFA public tournament pages

FIFA's official World Cup schedule publishes teams, dates, local kickoffs,
venues, results, groups, and the 104-match tournament structure. It is valuable
for completeness and venue/timezone corroboration. FIFA pages also document
schedule revisions: the 2026 schedule article says the allocation evolved from
the February 2024 version and was later finalized after the draw and play-offs.

No documented, unauthenticated public fixture API, machine-use license, rate
limit, immutable event ID contract, or cancellation/postponement taxonomy was
found in the audit. The public page is consequently corroboration only. Do not
reverse-engineer its private web payload into a registry source.

### 5. The FA and England Football

The FA publishes official FA Cup fixtures/results and dated postponement or
round-date notices; England Football publishes senior-team fixtures, venues,
localized kickoff times, results, and a calendar link. These sources help
corroborate English domestic cups and England senior internationals/friendlies.

The FA's terms explicitly prohibit web scraping or crawling. The FA's own
grassroots support forum also states that Full-Time does not provide the
requested public API and instead offers administrator-controlled embeds.
Neither The FA pages nor the England calendar are approved automated registry
inputs.

### 6. Official club fixture pages

Club pages are often the first authoritative notice of a newly arranged or
cancelled friendly and can establish opponent, date, local time, and venue.
There is no cross-club schema, common identifier, status taxonomy, update SLA,
or shared terms. A club page may corroborate an ESPN friendly or trigger
discovery, but it cannot by itself produce a registry identity unless it
exposes an approved stable structured event ID and a second approved source
confirms the mapping.

## Required source hierarchy

Apply the hierarchy per field, not by copying one source object wholesale:

1. **Recognized identity:** approved structured source with stable competition,
   event, and team IDs. ESPN is the technical primary where its competition is
   validated and use is authorized.
2. **Official structured gap-fill:** competition/federation feed only when its
   machine-use terms are explicit and its IDs/change semantics pass contract
   tests. None evaluated here is approved today.
3. **Official corroboration:** competition, federation, and club pages for
   matchup, kickoff, venue, neutral state, or status conflict resolution. A
   corroboration record links to an already recognized fixture; it does not
   mint one.
4. **Reputable secondary corroboration:** only when official evidence is
   unavailable, retained with source and observation time.
5. **Search discovery:** creates `FixtureCandidate` only. It never supplies
   grounding, model context, a fixture badge, or probabilities.

When approved sources conflict, keep every observed value and timestamp. Do
not merge by team-name similarity alone. Prefer the competition organizer for
competition status/venue decisions, the federation for national-team status,
and the club only for its own announcement. If stable IDs cannot be mapped or a
required field remains disputed near kickoff, classify the fixture as
`insufficient-model-input(required-context-missing)` rather than guessing.

## Coverage recommendation

| Category | ESPN technical result | Official corroboration | Registry recommendation |
|---|---|---|---|
| Domestic leagues | Strong for sampled Premier League | League match pages, calendar, amendment circulars | Validate competition-by-competition; existing PL only until rights review and longitudinal change test pass |
| Domestic cups | Strong top-level FA/EFL samples; round completeness varies | Organizer fixtures and notices | Recognize only validated rounds; do not assume early qualifying coverage |
| UEFA club competitions | Strong sampled main/qualifying coverage | UEFA match centre and competition rules | ESPN primary technically; UEFA manual/search corroboration only under current terms |
| Club friendlies | Broad but unbounded and incomplete by nature | Both clubs and organizer, when any | Candidate until ESPN stable ID plus authoritative corroboration; always outside public model coverage |
| Senior internationals | Strong sampled World Cup coverage | FIFA/federation schedule | Validate tournament completeness; organizer wins venue/status conflicts |
| Qualifiers | Strong sampled UEFA qualifier coverage | UEFA/FIFA/federation | Validate each confederation separately; do not generalize UEFA results globally |
| International friendlies | Broad but cancellations and late changes common | Host/away federations, UEFA information kits where applicable | Require stable ESPN ID plus federation/organizer corroboration; outside public model coverage by policy |

## Certification work still required

- Obtain written machine-use/redistribution authorization or a documented open
  license before expanding any automated source.
- Run a shadow registry for at least one complete scheduling/change cycle and
  record source observation times, kickoff/venue/status revisions, conflicts,
  and detection latency. Latency is **INCONCLUSIVE** in this audit.
- Encode expected fixture counts or independent completeness checks per
  competition/round; a responding slug is not coverage certification.
- Contract-test exact cancellation, postponement, suspension, abandonment,
  delayed kickoff, AET, penalties, and unknown status values.
- Preserve source names and IDs alongside canonical mappings. Team aliases must
  never replace source identity evidence.
- For neutral-site and friendly forecasts, fail closed when venue or neutral
  state is missing or conflicting.

## Primary evidence

- ESPN bounded scoreboard endpoints for `eng.1`, `eng.fa`, `eng.league_cup`,
  `uefa.champions`, `uefa.champions_qual`, `club.friendly`, `fifa.world`,
  `fifa.worldq.uefa`, and `fifa.friendly` (observed 2026-08-13).
- [Disney Terms of Use](https://disneytermsofuse.com/) and the
  [English terms PDF](https://disneytermsofuse.com/app/uploads/2022/03/Disney-US-English-Terms-of-Use-060920a22.pdf).
- [Premier League terms](https://www.premierleague.com/en/terms-and-conditions),
  [fixture FAQ](https://www.premierleague.com/en/about/faq/fixtures),
  [official calendar notice](https://www.premierleague.com/en/news/1235133/download-the-202627-premier-league-fixtures-to-your-calendar/),
  [fixture publications](https://www.premierleague.com/en/news/62625), and
  [Liverpool v Bournemouth match page](https://www.premierleague.com/en/match/2561895/liverpool-vs-bournemouth/info).
- [UEFA terms](https://www.uefa.com/termsconditions/),
  [information kits](https://www.uefa.com/news-media/mediaservices/informationkits/competitions/uefachampionsleague/),
  [friendly information kits](https://www.uefa.com/news-media/mediaservices/informationkits/competitions/friendlies/), and
  [2026/27 Champions League rescheduling rules](https://documents.uefa.com/r/Regulations-of-the-UEFA-Champions-League-2026/27/Article-27-Rescheduling-of-matches-Online).
- [FIFA World Cup 2026 official schedule](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums) and
  [schedule revision announcement](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/updated-fifa-world-cup-2026-match-schedule-now-available).
- [The FA terms](https://www.thefa.com/public/terms),
  [FA Cup round dates](https://www.thefa.com/news/2025/jun/13/fa-cup-vase-trophy-youth-cup-round-dates-2025-26-season-confirmed-20251306),
  [England senior fixtures](https://www.englandfootball.com/england/mens-senior-team/fixtures-results), and
  [The FA Full-Time API position](https://grassrootstechnology.thefa.com/support/discussions/topics/48000566273).
