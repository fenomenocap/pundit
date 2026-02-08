import { Router, Request, Response, NextFunction } from "express";
import { MarketStatus, MarketCategory } from "@sports-predict/shared";
import { prisma } from "../db";
import { requireAdmin, AppError } from "../middleware";

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

    // Build where clause
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

    // Build orderBy
    let orderBy: Record<string, string>;
    switch (sort) {
      case "volume":
        // Sort by total pool (poolYes + poolNo). Prisma doesn't support computed
        // columns in orderBy, so we sort by poolYes desc as a proxy, then re-sort
        // in memory below.
        orderBy = { poolYes: "desc" };
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
      prisma.market.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
      }),
      prisma.market.count({ where }),
    ]);

    // If sorting by volume, re-sort by total pool in memory
    if (sort === "volume") {
      markets.sort((a, b) => {
        const volA = a.poolYes + a.poolNo;
        const volB = b.poolYes + b.poolNo;
        return volB > volA ? 1 : volB < volA ? -1 : 0;
      });
    }

    // Serialize BigInts to strings for JSON
    const serialized = markets.map(serializeMarket);

    res.json({
      markets: serialized,
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

    if (!market) {
      throw new AppError(404, "Market not found");
    }

    // Count unique participants
    const participantCount = await prisma.position.groupBy({
      by: ["userAddress"],
      where: { marketId: market.id },
    });

    res.json({
      ...serializeMarket(market),
      recentTrades: market.trades.map(serializeTrade),
      participantCount: participantCount.length,
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
        category,
        teamA,
        teamB,
        resolutionTimestamp,
      } = req.body;

      // Validate required fields
      if (onchainId == null || !question || !outcomeA || !outcomeB || !category || !resolutionTimestamp) {
        throw new AppError(400, "Missing required fields: onchainId, question, outcomeA, outcomeB, category, resolutionTimestamp");
      }

      const upperCategory = (category as string).toUpperCase();
      if (!Object.values(MarketCategory).includes(upperCategory as MarketCategory)) {
        throw new AppError(400, `Invalid category: ${category}`);
      }

      // Check for duplicate onchainId
      const existing = await prisma.market.findUnique({
        where: { onchainId: Number(onchainId) },
      });
      if (existing) {
        throw new AppError(409, `Market with onchainId ${onchainId} already exists`);
      }

      const market = await prisma.market.create({
        data: {
          onchainId: Number(onchainId),
          question,
          outcomeA,
          outcomeB,
          category: upperCategory as "GROUP_STAGE" | "ROUND_OF_16" | "QUARTER_FINAL" | "SEMI_FINAL" | "FINAL" | "TOURNAMENT",
          teamA: teamA || null,
          teamB: teamB || null,
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

      if (outcome == null || (outcome !== 0 && outcome !== 1)) {
        throw new AppError(400, "outcome must be 0 or 1");
      }

      const market = await prisma.market.findUnique({
        where: { id: req.params.id },
      });

      if (!market) {
        throw new AppError(404, "Market not found");
      }

      if (market.status !== "OPEN" && market.status !== "LOCKED") {
        throw new AppError(400, `Cannot resolve market with status ${market.status}`);
      }

      const updated = await prisma.market.update({
        where: { id: req.params.id },
        data: {
          status: "RESOLVED",
          resolvedOutcome: outcome,
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
  category: string;
  teamA: string | null;
  teamB: string | null;
  poolYes: bigint;
  poolNo: bigint;
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
    category: m.category,
    teamA: m.teamA,
    teamB: m.teamB,
    poolYes: m.poolYes.toString(),
    poolNo: m.poolNo.toString(),
    totalVolume: (m.poolYes + m.poolNo).toString(),
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
  amount: bigint;
  shares: bigint;
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
    amount: t.amount.toString(),
    shares: t.shares.toString(),
    txHash: t.txHash,
    blockNumber: t.blockNumber,
    timestamp: t.timestamp.toISOString(),
  };
}

export default router;
