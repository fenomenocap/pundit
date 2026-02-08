import { Router, Request, Response, NextFunction } from "express";
import { PLATFORM_FEE_BPS, BPS_DENOMINATOR } from "@sports-predict/shared";
import { prisma } from "../db";
import { AppError } from "../middleware";

const router: Router = Router();

// ─── GET /api/users/:address/portfolio — positions, P&L, claimable ──────────

router.get(
  "/:address/portfolio",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = req.params.address.toLowerCase();

      const positions = await prisma.position.findMany({
        where: { userAddress: address },
        include: {
          market: true,
        },
      });

      if (positions.length === 0) {
        res.json({ address, positions: [], summary: { totalInvested: "0", totalClaimable: "0", totalClaimed: "0" } });
        return;
      }

      let totalInvested = 0n;
      let totalClaimable = 0n;
      let totalClaimed = 0n;

      const serialized = positions.map((pos) => {
        const market = pos.market;
        const invested = pos.shares; // 1:1 shares to USDC
        totalInvested += invested;

        let claimable = 0n;
        let status: "active" | "won" | "lost" | "claimable" | "claimed" | "refundable";

        if (market.status === "CANCELLED") {
          // Full refund
          if (pos.claimed) {
            status = "claimed";
            totalClaimed += invested;
          } else {
            status = "refundable";
            claimable = invested;
            totalClaimable += claimable;
          }
        } else if (market.status === "RESOLVED" && market.resolvedOutcome !== null) {
          if (pos.outcome === market.resolvedOutcome) {
            // Winner — calculate payout
            const totalPool = market.poolYes + market.poolNo;
            const fee = (totalPool * PLATFORM_FEE_BPS + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
            const netPool = totalPool - fee;
            const winningPool = pos.outcome === 0 ? market.poolYes : market.poolNo;

            if (winningPool > 0n) {
              claimable = (pos.shares * netPool) / winningPool;
            }

            if (pos.claimed) {
              status = "claimed";
              totalClaimed += claimable;
            } else {
              status = "claimable";
              totalClaimable += claimable;
            }
          } else {
            status = "lost";
          }
        } else {
          status = "active";
        }

        return {
          marketId: pos.marketId,
          marketQuestion: market.question,
          marketStatus: market.status,
          outcome: pos.outcome,
          shares: pos.shares.toString(),
          invested: invested.toString(),
          claimable: claimable.toString(),
          claimed: pos.claimed,
          status,
        };
      });

      res.json({
        address,
        positions: serialized,
        summary: {
          totalInvested: totalInvested.toString(),
          totalClaimable: totalClaimable.toString(),
          totalClaimed: totalClaimed.toString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/users/:address/history — paginated trade history ──────────────

router.get(
  "/:address/history",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = req.params.address.toLowerCase();
      const { page = "1", limit = "20" } = req.query;

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [trades, total] = await Promise.all([
        prisma.trade.findMany({
          where: { userAddress: address },
          orderBy: { timestamp: "desc" },
          skip,
          take: limitNum,
          include: {
            market: {
              select: {
                question: true,
                outcomeA: true,
                outcomeB: true,
                status: true,
              },
            },
          },
        }),
        prisma.trade.count({ where: { userAddress: address } }),
      ]);

      res.json({
        address,
        trades: trades.map((t) => ({
          id: t.id,
          marketId: t.marketId,
          marketQuestion: t.market.question,
          outcomeName: t.outcome === 0 ? t.market.outcomeA : t.market.outcomeB,
          outcome: t.outcome,
          amount: t.amount.toString(),
          shares: t.shares.toString(),
          txHash: t.txHash,
          blockNumber: t.blockNumber,
          timestamp: t.timestamp.toISOString(),
        })),
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
  }
);

export default router;
