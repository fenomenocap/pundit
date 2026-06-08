import { Router, Request, Response, NextFunction } from "express";
import { getCachedPolymarketMarkets } from "../services/polymarket-data";

const router: Router = Router();

function serializeMarket(m: ReturnType<typeof getCachedPolymarketMarkets>["wcMarkets"][number]) {
  return {
    id: m.id,
    question: m.question,
    outcomes: m.outcomes,
    outcomePrices: m.outcomePrices,
    liquidity: m.liquidity,
    volume: m.volume,
    endDate: m.endDate,
    resolved: m.resolved,
    active: m.active,
    type: m.type,
    group: m.group ?? null,
  };
}

// ─── GET /api/polymarkets/wc — outright winner markets ──────────────────────

router.get("/wc", (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedPolymarketMarkets();
    res.json({
      markets: cached.wcMarkets.map(serializeMarket),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/polymarkets/groups — group winner markets (A–L) ───────────────

router.get("/groups", (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedPolymarketMarkets();
    res.json({
      markets: cached.groupMarkets.map(serializeMarket),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
