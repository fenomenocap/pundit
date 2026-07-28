import { Router, Request, Response, NextFunction } from "express";
import { getCachedModelData } from "../services/model-data";

const router: Router = Router();

function stripScorelines<T extends { scorelines?: unknown }>(fixture: T) {
  const { scorelines: _scorelines, ...rest } = fixture;
  return rest;
}

// ─── GET /api/model/wc — retired (WC live model) ─────────────────────────────

router.get("/wc", (_req: Request, res: Response) => {
  res.status(410).json({
    error: "World Cup live model retired. See GET /api/evaluation/wc-2026 for the frozen backtest.",
  });
});

// ─── GET /api/model/active — active club fixtures with model rows ───────────

router.get("/active", (req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedModelData();
    const competition = typeof req.query.competition === "string"
      ? req.query.competition.trim()
      : undefined;
    const fixtures = competition
      ? cached.fixtures.filter((fixture) => fixture.competitionId === competition)
      : cached.fixtures;
    res.json({
      fixtures: fixtures.map(stripScorelines),
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
    const cached = getCachedModelData();
    const competition = typeof req.query.competition === "string"
      ? req.query.competition.trim()
      : undefined;
    const fixtures = competition
      ? cached.fixtures.filter((fixture) => fixture.competitionId === competition)
      : cached.fixtures;
    res.json({
      fixtures: fixtures.map(stripScorelines),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
