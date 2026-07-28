import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { requestLogger, errorHandler } from "./middleware";
import matchRoutes from "./routes/matches";
import polymarketRoutes from "./routes/polymarkets";
import modelRoutes from "./routes/model";
import askRoutes from "./routes/ask";
import evaluationRoutes from "./routes/evaluation";
import { startClubRatingsCron } from "./services/club-ratings";
import { getCachedModelData, startModelCron } from "./services/model-data";
import { getCachedMatches, startFootballCron } from "./services/football-data";
import { getActiveFixtureStatus } from "./services/active-fixtures";
import {
  getModelMarketOddsStatus,
  startModelMarketOddsCron,
} from "./services/model-market-odds";

const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || process.env.API_PORT || 3001;

// Comma-separated browser origins allowed to call the API. When unset, CORS
// stays open (current production behaviour). Set this in Railway to the Vercel
// frontend origin(s) so the Anthropic-backed /api/ask route cannot be called
// from arbitrary third-party sites.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (allowedOrigins.length === 0 || !origin) {
      callback(null, true);
      return;
    }
    const normalized = origin.replace(/\/$/, "");
    callback(null, allowedOrigins.includes(normalized));
  },
}));
app.use(express.json({ limit: "32kb" }));
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/ready", (_req, res) => {
  const model = getCachedModelData();
  const football = getCachedMatches();
  const active = getActiveFixtureStatus();
  const odds = getModelMarketOddsStatus();
  const ready = model.lastUpdated !== null && football.lastUpdated !== null && odds.ready;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "loading",
    model: { ready: model.lastUpdated !== null, lastUpdated: model.lastUpdated?.toISOString() ?? null },
    football: { ready: football.lastUpdated !== null, lastUpdated: football.lastUpdated?.toISOString() ?? null },
    activeFixtures: {
      count: active.count,
      byCompetition: active.byCompetition,
      lastUpdated: active.lastUpdated?.toISOString() ?? null,
    },
    marketOdds: {
      ready: odds.ready,
      lastUpdated: odds.lastUpdated?.toISOString() ?? null,
      sourceWarnings: odds.sourceWarnings,
      coverage: odds.coverage,
    },
  });
});

app.use("/api/matches", matchRoutes);
app.use("/api/polymarkets", polymarketRoutes);
app.use("/api/model", modelRoutes);
app.use("/api/ask", askRoutes);
app.use("/api/evaluation", evaluationRoutes);

// ─── Error Handling ─────────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`API server running on port ${port}`);

  void (async () => {
    await startFootballCron();
    await startClubRatingsCron();
    await startModelCron();
    await startModelMarketOddsCron();
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Bootstrap] ${message}`);
  });
});
