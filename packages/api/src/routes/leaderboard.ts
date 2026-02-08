import { Router, Request, Response, NextFunction } from "express";
import { PLATFORM_FEE_BPS, BPS_DENOMINATOR } from "@sports-predict/shared";
import { prisma } from "../db";
import { AppError } from "../middleware";

const router: Router = Router();

// ─── GET /api/leaderboard — ranked traders by profit ────────────────────────

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { period = "all", limit = "50" } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));

    // Determine time filter
    let since: Date | null = null;
    const now = new Date();
    switch (period) {
      case "7d":
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "all":
        break;
      default:
        throw new AppError(400, "Invalid period: use 'all', '30d', or '7d'");
    }

    // Get all positions in resolved/cancelled markets (within time filter)
    const marketWhere: Record<string, unknown> = {
      status: { in: ["RESOLVED", "CANCELLED"] },
    };
    if (since) {
      marketWhere.resolvedAt = { gte: since };
    }

    const positions = await prisma.position.findMany({
      where: {
        market: marketWhere,
      },
      include: {
        market: true,
      },
    });

    // Compute P&L per user
    const userPnL = new Map<string, { profit: bigint; totalInvested: bigint; wins: number; losses: number; markets: Set<string> }>();

    for (const pos of positions) {
      const market = pos.market;
      const addr = pos.userAddress;

      if (!userPnL.has(addr)) {
        userPnL.set(addr, { profit: 0n, totalInvested: 0n, wins: 0, losses: 0, markets: new Set() });
      }
      const entry = userPnL.get(addr)!;
      const invested = pos.shares; // 1:1
      entry.totalInvested += invested;
      entry.markets.add(pos.marketId);

      if (market.status === "CANCELLED") {
        // Refund — net zero P&L
        continue;
      }

      if (market.resolvedOutcome !== null && pos.outcome === market.resolvedOutcome) {
        // Winner
        const totalPool = market.poolYes + market.poolNo;
        const fee = (totalPool * PLATFORM_FEE_BPS + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
        const netPool = totalPool - fee;
        const winningPool = pos.outcome === 0 ? market.poolYes : market.poolNo;

        if (winningPool > 0n) {
          const payout = (pos.shares * netPool) / winningPool;
          entry.profit += payout - invested;
        } else {
          // Zero winners — refund, net zero
        }
        entry.wins++;
      } else {
        // Loser
        entry.profit -= invested;
        entry.losses++;
      }
    }

    // Sort by profit descending
    const sorted = Array.from(userPnL.entries())
      .sort(([, a], [, b]) => {
        return b.profit > a.profit ? 1 : b.profit < a.profit ? -1 : 0;
      })
      .slice(0, limitNum);

    const leaderboard = sorted.map(([address, data], index) => ({
      rank: index + 1,
      address,
      profit: data.profit.toString(),
      totalInvested: data.totalInvested.toString(),
      wins: data.wins,
      losses: data.losses,
      marketsTraded: data.markets.size,
    }));

    res.json({
      period,
      leaderboard,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
