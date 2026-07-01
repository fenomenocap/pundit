import { Router, Request, Response, NextFunction } from "express";
import { getCachedModelData } from "../services/model-data";

const router: Router = Router();

// ─── GET /api/model/wc — team win/SF/QF probabilities + market edge ─────────

router.get("/wc", (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedModelData();
    res.json({
      teams: cached.teams,
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/model/fixtures — fixture-level model odds ─────────────────────

router.get("/fixtures", (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedModelData();
    res.json({
      fixtures: cached.fixtures,
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
