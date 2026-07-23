# How to Use Pundit

Pundit has three surfaces, all reachable from the top nav.

### The chat

The homepage suggests active late-stage fixtures (semifinals, 3rd-place match, and final once both teams are known). A featured-match answer is grounded in the model's win/draw/win, over/under 2.5, BTTS, and most likely scorelines. Valid active Stake, Kalshi, and Polymarket 1X2 prices appear beneath the answer when available.

The chat also supports tournament-level questions such as “Who is the favourite?” and general football questions. Every assistant message is labelled as match-grounded, tournament-grounded, or general/not model-grounded. Up to twelve history turns (six exchanges) are carried forward for natural follow-ups; New Chat clears that context.

Answers can take several seconds because Claude may run a live web search for relevant injury, squad, or form news. Requests are capped at 500 characters and 10 requests per minute.

### Fixtures & Standings

The Fixtures page preserves the full tournament schedule and result history, grouped by stage, plus group standings. Live matches show current scores, the page stamps when ESPN data was last refreshed, and each known matchup links into chat via “Ask about this match”. This is ESPN tournament data rather than model output.

### Model

The Model page is a native read-only view of Pundit's local tournament probabilities and fixture-model history. The API additionally retains the complete fixture history with model probabilities, totals, BTTS, scorelines, and completed results for future evaluation.
