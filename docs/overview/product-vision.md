# Product Vision

Pundit's premise: the most useful thing you can do with a prediction model isn't stare at a probability table, it's ask it a question and get a straight answer.

Most football analytics tools stop at a dashboard — win probabilities, expected goals, a standings table. Pundit puts a conversational layer on top: name a matchup, ask about the title race, or query the league table, and Pundit tells you what the numbers say, where the model and the market disagree, and what would have to be true for an upset — grounded in a real statistical model and live market pricing rather than an LLM guessing.

**Today**, that's a multi-turn chat backed by a Dixon-Coles club fixture model (a reviewed, pinned ClubElo strength artifact plus home-field advantage), ESPN standings, a complete-schedule-gated Premier League season simulator, and reference Stake/Kalshi/Polymarket prices — all read-only, informational, nothing to trade. Production does not contact ClubElo at runtime. Credibility is shown openly through rolling club-season calibration and a frozen World Cup 2026 backtest.

**Where this is designed to grow:** the same grounded-analysis approach extends naturally to additional competitions, richer market coverage, and deeper calibration — without reintroducing trading or onchain mechanics. Nothing beyond the current chat-first product is live yet; this section describes direction, not a shipped roadmap or a financial commitment.
