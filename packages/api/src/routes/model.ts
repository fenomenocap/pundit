import { Router, Request, Response, NextFunction } from "express";
import { parseOptionalCompetition } from "../lib/competition-query";
import { getCachedModelData } from "../services/model-data";
import { clubRatingsAreCurrent } from "../services/club-ratings";
import { publicModelFixtures } from "../services/model-market-odds";

const router: Router = Router();

// ─── GET /api/model/wc — retired (WC live model) ─────────────────────────────

router.get("/wc", (_req: Request, res: Response) => {
  res.status(410).json({
    error: "World Cup live model retired. See GET /api/evaluation/wc-2026 for the frozen backtest.",
  });
});

// ─── GET /api/model/active — active club fixtures with model rows ───────────

router.get("/active", (req: Request, res: Response, next: NextFunction) => {
  try {
    const competition = parseOptionalCompetition(req.query.competition);
    if (!clubRatingsAreCurrent()) {
      return res.status(503).json({
        error: "Pundit's match model is temporarily unavailable.",
        code: "MODEL_UNAVAILABLE",
      });
    }
    const cached = getCachedModelData();
    const fixtures = competition
      ? cached.fixtures.filter((fixture) => fixture.competitionId === competition)
      : cached.fixtures;
    res.json({
      fixtures: publicModelFixtures(fixtures),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/model/fixtures — active fixture model odds ────────────────────

router.get("/fixtures", (req: Request, res: Response, next: NextFunction) => {
  try {
    const competition = parseOptionalCompetition(req.query.competition);
    if (!clubRatingsAreCurrent()) {
      return res.status(503).json({
        error: "Pundit's match model is temporarily unavailable.",
        code: "MODEL_UNAVAILABLE",
      });
    }
    const cached = getCachedModelData();
    const fixtures = competition
      ? cached.fixtures.filter((fixture) => fixture.competitionId === competition)
      : cached.fixtures;
    res.json({
      fixtures: publicModelFixtures(fixtures),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
