import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { requestLogger, errorHandler } from "./middleware";
import marketRoutes from "./routes/markets";
import userRoutes from "./routes/users";
import leaderboardRoutes from "./routes/leaderboard";
import matchRoutes from "./routes/matches";
import polymarketRoutes from "./routes/polymarkets";
import { startPolymarketCron } from "./services/polymarket-data";
import { prisma } from "./db";

const app = express();
const port = process.env.API_PORT || 3001;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  })
);

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", db: "disconnected" });
  }
});

app.use("/api/markets", marketRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/polymarkets", polymarketRoutes);

// ─── Error Handling ─────────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`API server running on port ${port}`);

  // Start Polymarket cron — fetches WC 2026 markets and reference odds every 6 hours
  startPolymarketCron();
});
