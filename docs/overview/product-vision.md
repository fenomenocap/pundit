# Product Vision

Pundit's premise: the most useful thing you can do with a prediction model isn't stare at a probability table, it's ask it a question and get a straight answer.

Most football analytics tools stop at a dashboard — win probabilities, expected goals, a standings table. Pundit puts a conversational layer on top: name a matchup, ask about the title race, or query the league table, and Pundit tells you what the numbers say, where the model and the market disagree, and what would have to be true for an upset — grounded in a real statistical model and live market pricing rather than an LLM guessing.

**Today**, that's an analysis desk: a live fixture slate, an analyst pane on `POST /api/ask`, and a local paper lab (Paper / Draft / Vaults). The engine is a Dixon-Coles club fixture model (a reviewed, pinned ClubElo strength artifact plus home-field advantage), ESPN standings, a complete-schedule-gated Premier League season simulator, and reference Stake/Kalshi/Polymarket prices — all read-only, informational, nothing to trade. Production does not contact ClubElo at runtime. Credibility is shown openly through rolling club-season calibration and a frozen World Cup 2026 backtest.

**Where this is designed to grow:** the same grounded-analysis approach extends naturally to additional competitions, richer market coverage, and deeper calibration — without reintroducing trading or onchain mechanics. Paper screens are a simulator, not a shipped book. This section describes direction, not a financial commitment.
