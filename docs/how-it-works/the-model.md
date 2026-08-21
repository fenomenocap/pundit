# The Model

Pundit's match probabilities come from a **Dixon-Coles Poisson model** calibrated on a reviewed **ClubElo** ratings artifact and computed locally inside the API. The content-addressed ratings snapshot ships with a release; the active fixture set (14-day horizon across enabled competitions) is recomputed hourly without contacting ClubElo at runtime.

### Active fixture model

For each recognized, policy-eligible upcoming club fixture in the active window:

* **Win / draw / win probabilities** (`pHome`, `pDraw`, `pAway`) — Dixon-Coles output for that specific matchup
* **Over/under 2.5, BTTS, and likely scorelines** derived from the score matrix
* **Home-field advantage** applied for Premier League home teams (not for neutral-site tournaments)

Team strength comes from a pinned `clubelo@1` snapshot, scoped by competition rating profile (domestic league vs continental). Its selector, payload hash, source timestamp, minimum coverage and 30-day freshness are validated before use. A corrupt, expired or incomplete artifact fails closed rather than guessing ratings.

Fixture recognition is a gate, not a numeric input. The registry binds approved structured source IDs to canonical teams, kickoff, venue/neutral state, competition, and status. Cancelled, postponed, unsupported, ambiguous, or incomplete fixtures fail closed before pricing; this does not alter the numeric output for existing eligible fixtures.

### Season outlook simulator

For Premier League title-race and top-four questions, Pundit runs a **Monte Carlo simulation** over remaining scheduled fixtures:

* Uses current ESPN standings as the starting state
* Samples match outcomes from the same Dixon-Coles engine used for individual fixtures
* Reports title probability and top-four probability per team

The default simulation seed is derived from the complete standings, remaining fixtures, ratings, run count, and active contributor identity. Identical grounded inputs therefore replay to identical probabilities across follow-up turns; changing a grounded input changes the replay. Tests may still inject an explicit random source.

This is separate from the per-fixture active cache — it answers "who wins the league?" rather than "who wins this match?"

### How the chat uses it

For a recognized, priced fixture in the 14-day window, Pundit treats the fixture's precomputed probabilities as ground truth. Every complete no-search match response is rendered deterministically from that grounding payload. MiniMax is reserved for evidence-required current turns and general/ungrounded open-ended analysis. Pundit then:

1. Compares the model's win/draw/win read with complete active Stake, Kalshi, and Polymarket 1X2 prices when available
2. Runs a live web search whenever the question touches injuries, suspensions, lineups, form, transfers, or a recent result — for a specific fixture that information changes the read, so Pundit searches rather than answering from memory. Every item it reports names its source and date, and it says plainly where a search turned up nothing
3. Responds in plain language: headline odds, 1–2 likely scorelines, and what the underdog would need

Odds and market questions also retain mandatory search. If verification supports no external claim, Pundit discards the generated prose and deterministically renders only complete same-source market rows already present in match grounding. The verification remains `abstain` or `unavailable`, citations are empty, and an incomplete or absent grounded market is omitted rather than guessed.

Competition questions use ESPN standings only. Season questions add the Monte Carlo outlook on top of standings.
The word “current” alone does not send an owned table or season-outlook fact to external search. When every current-table row is tied at zero and the user explicitly asks for a ranking based only on that table, Pundit states that the table cannot identify a leader and omits the season probabilities because they also use ratings and the remaining schedule.

Recognized non-priced fixtures use a separate fixture grounding contract with a typed capability reason and no Pundit probabilities or scorelines. Their notice preserves the exact status and reason supplied by the capability decision; it does not ask MiniMax to infer why an input is missing. Discovery-only candidates are not grounding and never reach the model.

### Evaluation and calibration

Two read-only evaluation artifacts measure how well pre-kickoff probabilities matched reality:

| Artifact | Path | Method |
|---|---|---|
| **Club season (rolling)** | `/evaluation/club-season` | Immutable pre-kickoff snapshots captured when fixtures leave the scheduled window |
| **WC 2026 (frozen)** | `/evaluation/wc-2026` | Reconstructed pre-kickoff probabilities for every finished World Cup 2026 match |

The live Model page recalculates older fixtures with the release's **pinned, freshness-gated** ratings artifact — useful for exploration, but not a look-ahead-free backtest. Rigorous calibration uses the evaluation artifacts above.

### Historical note: World Cup 2026

The live World Cup tournament model (100k bracket simulations, neutral venues, eloratings.net TSV) is **retired**. Credibility for WC 2026 lives in the frozen backtest at `/evaluation/wc-2026` only.
