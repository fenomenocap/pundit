# How to Use Pundit

Pundit’s homepage is the **Desk**. The navigation is **Desk · Fixtures · Bet slip · FPL · Track record**. A previous chat-only homepage is kept at `/legacy` and is not in the navigation. The old `/model` page has been removed: that address now redirects to the methodology section of the Track record.

### The desk

The desk is a live slate of recognized, priced Premier League and UCL-qualifier fixtures plus an analyst pane on the same `/api/ask` contract as before.

Select a fixture from the rail or chips, or type a question. Follow-ups stay on that fixture until you pick another.

**Match questions** receive win, draw, or loss, over/under 2.5, BTTS, and likely scorelines from Pundit’s model, plus any available Stake, Kalshi, or Polymarket 1X2 prices. Shorthand such as `BTTS?`, `o2.5`, or “possible scorelines” is settled from those same numbers — not by restating the 1X2 favourite.

The featured briefing and the tactical chips (**Tactical matchup**, **Who decides it?**) are football takes on those same fixture facts. They do not open the pricing desk.

**Competition questions** (e.g. “Who leads the Premier League?”) are grounded in the current ESPN standings table.

**Season outlook questions** (e.g. “Who wins the title?” or “Top-four chances”) use a Monte Carlo simulation over remaining Premier League fixtures.

**General football questions** are clearly labelled as not grounded in Pundit’s statistical model.

Match grounding is not always available, and the desk says which case applies rather than failing silently:

* **No fixtures in the window** — between rounds, or before the league season starts.
* **Recognized but outside coverage** — identity is established, but competition or policy is outside the public model (including recognized friendlies). No Pundit probabilities.
* **Temporarily unavailable** — the model is initializing or refreshing.
* **Missing model input** — required ratings, venue state, or other context is unavailable. Fail closed, no probabilities.
* **Identity not established** — user text or search may suggest a matchup, but without an approved structured identity it remains a discovery candidate.

`current table` and `current standings` refer to the most recent competition you named; with none in view, Pundit uses the Premier League as its only league-style table. Other vague pronouns do not silently inherit a competition. **New Chat** in the analyst pane clears conversation. Up to twelve history turns (six exchanges) carry forward.

Every no-search response with complete match, non-priced fixture, competition, or season grounding is answered directly without a MiniMax call. Saying “current” does not by itself trigger external search when the requested fact is already in Pundit’s table, model, or season grounding. Clearly current injury, squad, manager, transfer, odds, and form questions still search first. Questions are capped at 500 characters; the API allows 10 requests per minute. You can paste a found decimal on a 1X2 outcome to get pass/play from `modelP × decimal − 1`. Pundit will not size a stake without a bankroll.

### Projected score

Each priced fixture on the desk shows one **projected score**. It is the likeliest exact score inside the favoured result (home win, draw or away win) and the favoured side of 2.5 goals, taken from the published probabilities, with a one-line reason. It is deterministic: the same probabilities always give the same score, and it always agrees with the favoured result and goals line. It is a forecast, not a guarantee. Live and final scores in the ticker and rail are shown only from the real match.

The wording on how goals are estimated, and the names of the data sources, sit behind a collapsed **Sources** toggle on the desk and on Fixtures.

### Fixtures and the Premier League table

`/fixtures` shows the schedule grouped by day across enabled competitions (Premier League and UCL qualifiers), with live and final scores. Each priced fixture has a **My forecast** row (win/draw/loss). **Goals and scorelines** (over/under 2.5, both teams to score, likeliest scorelines) and **Market comparison** are behind toggles. When nothing is priced, the page says so rather than showing an empty table.

Below the schedule is a formal **Premier League table**: played, won, drawn, lost, goals for and against, goal difference, points and recent form, with zone markers.

### Bet slip

`/board` is a **bet slip**. Select prices the site already shows to build singles or an accumulator, enter a stake, and the combined odds, potential return and potential profit update as you type. There is no wallet, no account and no real wager; it is a calculator. With no priced fixtures it shows “No priced fixtures are live right now.”

### FPL team simulator

`/draft` is a **Fantasy Premier League team simulator**. Pick a 15-player squad within a £100.0m budget and at most three players per club, then choose a starting XI, a captain and a vice-captain. The squad is saved in your browser only.

Player names, clubs, positions and prices come from the public Fantasy Premier League data. A player without a published price is shown as unpriced and never given an estimated price. The page states: “Simulator only. Player data from Fantasy Premier League (public). Not affiliated with the Premier League.” It carries no Premier League or FPL logos.

### Track record

* **`/evaluation/club-season`** (Track record in the nav) — scored pre-kickoff forecasts for club fixtures. Each match counts **once**: when a match has more than one sealed forecast, the one from the scheduled 90-minute pre-kickoff window is preferred, then the newer model version, then the later forecast. It shows current-version stats, a calibration table, earlier versions (collapsed), the list of matches, and a note on anything not counted. The **How the forecasts work** section (`#methodology`) explains the method in plain English; sources and model names are behind a collapsed Sources toggle. Live results are stored on the production API server, not in the empty in-repo seed.
* **`/evaluation/wc-2026`** — frozen World Cup 2026 backtest. Historical only.

See [Evaluation API](../api-reference/evaluation.md) for the JSON endpoints and [Methodology and Data Sources](../methodology.md) for the full method.
