import { Router, Request, Response, NextFunction } from "express";
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
        // pos.shares = net shares (gross minus 2% fee). Used as both "invested"
        // proxy and payout numerator — consistent with on-chain accounting.
        const invested = pos.shares;
        totalInvested += invested;

        let claimable = 0n;
        let status: "active" | "won" | "lost" | "claimable" | "claimed" | "refundable";

        if (market.status === "CANCELLED") {
          // On-chain refund = net deposit (fee is non-refundable).
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
            // Winner — DB pools are already NET (fee excluded at deposit).
            // Formula mirrors the contract: payout = shares * totalPool / winningPool
            const totalPool = market.poolYes + market.poolNo + market.poolDraw;
            const winningPool =
              pos.outcome === 0 ? market.poolYes :
              pos.outcome === 1 ? market.poolNo  :
              market.poolDraw;

            if (winningPool > 0n) {
              claimable = (pos.shares * totalPool) / winningPool;
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
          onchainId: market.onchainId,
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
                outcomeC: true,
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
          outcomeName:
            t.outcome === 0 ? t.market.outcomeA :
            t.outcome === 1 ? t.market.outcomeB :
            (t.market.outcomeC ?? "Draw"),
          outcome: t.outcome,
          grossAmount: t.grossAmount.toString(),
          netShares: t.netShares.toString(),
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
