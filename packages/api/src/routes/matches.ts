import { Router, Request, Response, NextFunction } from "express";
import { getCachedMatches } from "../services/football-data";

const router: Router = Router();

// ─── GET /api/matches/upcoming — upcoming World Cup matches ─────────────────

router.get("/upcoming", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedMatches();

    res.json({
      matches: cached.upcoming.map((m) => ({
        id: m.id,
        competition: m.competition,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        utcDate: m.utcDate,
        status: m.status,
        stage: m.stage,
        matchday: m.matchday,
        group: m.group,
        score: m.score,
      })),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/matches/recent — recent World Cup results ─────────────────────

router.get("/recent", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedMatches();

    res.json({
      matches: cached.recent.map((m) => ({
        id: m.id,
        competition: m.competition,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        utcDate: m.utcDate,
        status: m.status,
        stage: m.stage,
        matchday: m.matchday,
        group: m.group,
        score: m.score,
      })),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/matches/standings — World Cup group standings ─────────────────

router.get("/standings", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedMatches();

    res.json({
      standings: cached.standings,
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
