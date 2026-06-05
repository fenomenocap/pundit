import { Router, Request, Response, NextFunction } from "express";
import { getCachedPolymarketMarkets } from "../services/polymarket-data";

const router: Router = Router();

// ─── GET /api/polymarkets/wc — cached FIFA WC 2026 markets from Polymarket ──

router.get("/wc", (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedPolymarketMarkets();

    res.json({
      markets: cached.wcMarkets.map((m) => ({
        id: m.id,
        question: m.question,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        liquidity: m.liquidity,
        volume: m.volume,
        endDate: m.endDate,
        resolved: m.resolved,
        active: m.active,
      })),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
