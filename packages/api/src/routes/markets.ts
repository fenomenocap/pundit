import { Router, Request, Response, NextFunction } from "express";
import { MarketStatus, MarketCategory } from "@sports-predict/shared";
import { prisma } from "../db";
import { requireAdmin, AppError } from "../middleware";
import { getCachedPolymarketMarkets } from "../services/polymarket-data";

const router: Router = Router();

// ─── GET /api/markets — list with filters, sorting, pagination ──────────────

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      status,
      category,
      sort = "newest",
      page = "1",
      limit = "20",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {};

    if (status) {
      const upper = (status as string).toUpperCase();
      if (Object.values(MarketStatus).includes(upper as MarketStatus)) {
        where.status = upper;
      } else {
        throw new AppError(400, `Invalid status: ${status}`);
      }
    }

    if (category) {
      const upper = (category as string).toUpperCase();
      if (Object.values(MarketCategory).includes(upper as MarketCategory)) {
        where.category = upper;
      } else {
        throw new AppError(400, `Invalid category: ${category}`);
      }
    }

    let orderBy: Record<string, string>;
    switch (sort) {
      case "volume":
        // totalVolume is tracked directly in the DB now
        orderBy = { totalVolume: "desc" };
        break;
      case "closing_soon":
        orderBy = { resolutionTimestamp: "asc" };
        break;
      case "newest":
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    const [markets, total] = await Promise.all([
      prisma.market.findMany({ where, orderBy, skip, take: limitNum }),
      prisma.market.count({ where }),
    ]);

    // Enrich with Polymarket reference odds from in-memory cache
    const { wcMarkets } = getCachedPolymarketMarkets();
    const polyById = new Map(wcMarkets.map((m) => [m.id, m]));

    res.json({
      markets: markets.map((m) => {
        const serialized = serializeMarket(m);
        const polyRef = m.polymarketId ? polyById.get(m.polymarketId) : undefined;
        return {
          ...serialized,
          polymarketOdds: polyRef
            ? { outcomes: polyRef.outcomes, prices: polyRef.outcomePrices }
            : null,
        };
      }),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/markets/:id — full detail ─────────────────────────────────────

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const market = await prisma.market.findUnique({
      where: { id: req.params.id },
      include: {
        trades: {
          orderBy: { timestamp: "desc" },
          take: 20,
        },
        positions: true,
      },
    });

    if (!market) throw new AppError(404, "Market not found");

    const participantCount = await prisma.position.groupBy({
      by: ["userAddress"],
      where: { marketId: market.id },
    });

    // Attach Polymarket reference odds if the market is linked to one
    let polymarketOdds: { outcomes: string[]; prices: number[] } | null = null;
    if (market.polymarketId) {
      const { wcMarkets } = getCachedPolymarketMarkets();
      const ref = wcMarkets.find((m) => m.id === market.polymarketId);
      if (ref) {
        polymarketOdds = { outcomes: ref.outcomes, prices: ref.outcomePrices };
      }
    }

    res.json({
      ...serializeMarket(market),
      recentTrades: market.trades.map(serializeTrade),
      participantCount: participantCount.length,
      polymarketOdds,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/markets — admin-only market creation ─────────────────────────

router.post(
  "/",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        onchainId,
        question,
        outcomeA,
        outcomeB,
        outcomeC,
        category,
        teamA,
        teamB,
        resolutionTimestamp,
        polymarketId,
      } = req.body;

      if (onchainId == null || !question || !outcomeA || !outcomeB || !category || !resolutionTimestamp) {
        throw new AppError(
          400,
          "Missing required fields: onchainId, question, outcomeA, outcomeB, category, resolutionTimestamp"
        );
      }

      const upperCategory = (category as string).toUpperCase();
      if (!Object.values(MarketCategory).includes(upperCategory as MarketCategory)) {
        throw new AppError(400, `Invalid category: ${category}. Valid values: ${Object.values(MarketCategory).join(", ")}`);
      }

      const existing = await prisma.market.findUnique({ where: { onchainId: Number(onchainId) } });
      if (existing) {
        throw new AppError(409, `Market with onchainId ${onchainId} already exists`);
      }

      const market = await prisma.market.create({
        data: {
          onchainId: Number(onchainId),
          question,
          outcomeA,
          outcomeB,
          outcomeC: outcomeC ?? null,
          category: upperCategory as MarketCategory,
          teamA: teamA ?? null,
          teamB: teamB ?? null,
          polymarketId: polymarketId ?? null,
          resolutionTimestamp: new Date(resolutionTimestamp),
        },
      });

      res.status(201).json(serializeMarket(market));
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/markets/:id/resolve — admin-only resolution ──────────────────

router.post(
  "/:id/resolve",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { outcome } = req.body;

      if (outcome == null || ![0, 1, 2].includes(Number(outcome))) {
        throw new AppError(400, "outcome must be 0 (Yes/Home), 1 (No/Away), or 2 (Draw)");
      }

      const market = await prisma.market.findUnique({ where: { id: req.params.id } });
      if (!market) throw new AppError(404, "Market not found");

      if (market.status !== "OPEN" && market.status !== "LOCKED") {
        throw new AppError(400, `Cannot resolve market with status ${market.status}`);
      }

      const updated = await prisma.market.update({
        where: { id: req.params.id },
        data: {
          status: "RESOLVED",
          resolvedOutcome: Number(outcome),
          resolvedAt: new Date(),
        },
      });

      res.json(serializeMarket(updated));
    } catch (err) {
      next(err);
    }
  }
);

// ─── Serializers ────────────────────────────────────────────────────────────

interface MarketRow {
  id: string;
  onchainId: number;
  question: string;
  outcomeA: string;
  outcomeB: string;
  outcomeC: string | null;
  category: string;
  teamA: string | null;
  teamB: string | null;
  polymarketId: string | null;
  poolYes: bigint;
  poolNo: bigint;
  poolDraw: bigint;
  totalVolume: bigint;
  status: string;
  resolvedOutcome: number | null;
  resolvedAt: Date | null;
  resolutionTimestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

function serializeMarket(m: MarketRow) {
  return {
    id: m.id,
    onchainId: m.onchainId,
    question: m.question,
    outcomeA: m.outcomeA,
    outcomeB: m.outcomeB,
    outcomeC: m.outcomeC ?? null,
    category: m.category,
    teamA: m.teamA,
    teamB: m.teamB,
    polymarketId: m.polymarketId ?? null,
    poolYes: m.poolYes.toString(),
    poolNo: m.poolNo.toString(),
    poolDraw: m.poolDraw.toString(),
    totalVolume: m.totalVolume.toString(),
    status: m.status,
    resolvedOutcome: m.resolvedOutcome,
    resolvedAt: m.resolvedAt?.toISOString() ?? null,
    resolutionTimestamp: m.resolutionTimestamp.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

interface TradeRow {
  id: string;
  marketId: string;
  userAddress: string;
  outcome: number;
  grossAmount: bigint;
  netShares: bigint;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}

function serializeTrade(t: TradeRow) {
  return {
    id: t.id,
    marketId: t.marketId,
    userAddress: t.userAddress,
    outcome: t.outcome,
    grossAmount: t.grossAmount.toString(),
    netShares: t.netShares.toString(),
    txHash: t.txHash,
    blockNumber: t.blockNumber,
    timestamp: t.timestamp.toISOString(),
  };
}

export default router;
