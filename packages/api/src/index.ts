import "./load-env";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { requestLogger, errorHandler } from "./middleware";
import matchRoutes from "./routes/matches";
import polymarketRoutes from "./routes/polymarkets";
import modelRoutes from "./routes/model";
import askRoutes, { askRateLimitConfig } from "./routes/ask";
import evaluationRoutes from "./routes/evaluation";
import {
  clubRatingsAgeDays,
  getCachedClubRatings,
  startClubRatingsCron,
} from "./services/club-ratings";
import { getCachedModelData, startModelCron } from "./services/model-data";
import { getCachedMatches, startFootballCron } from "./services/football-data";
import { getActiveFixtures, getActiveFixtureStatus } from "./services/active-fixtures";
import {
  getModelMarketOddsStatus,
  startModelMarketOddsCron,
} from "./services/model-market-odds";
import { evaluateReadiness } from "./services/readiness";
import { getWebSearchStatus } from "./services/web-search";

const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || process.env.API_PORT || 3001;

// Comma-separated browser origins allowed to call the API. When unset, CORS
// stays open (current production behaviour). Set this in Railway to the Vercel
// frontend origin(s) so the MiniMax-backed /api/ask route cannot be called
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
  const activeFixtures = getActiveFixtures();
  const active = getActiveFixtureStatus();
  const odds = getModelMarketOddsStatus();
  const ratings = getCachedClubRatings();
  const readiness = evaluateReadiness(model, football, activeFixtures, odds);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? "ready" : "loading",
    model: {
      ready: readiness.modelReady,
      fixtureCount: model.fixtures.length,
      expectedActiveFixtureCount: activeFixtures.length,
      lastUpdated: model.lastUpdated?.toISOString() ?? null,
      error: model.error,
      // Clubs priced off a lapsed ClubElo window rather than today's snapshot.
      // Readiness does not fail on these — the rating is real, just dated — but
      // the model should not present them as current either.
      staleRatings: ratings.staleRatings,
      // Whole-rating-set staleness, for backend monitoring rather than the UI: a
      // snapshot a few days old still prices a match honestly, so readiness stays
      // green and readers are not alarmed, but an outage must not be invisible to
      // us. Alert on ratingsServedFromCache — it means ClubElo is unreachable.
      ratingsAsOf: ratings.fetchedAt?.toISOString() ?? null,
      ratingsAgeDays: clubRatingsAgeDays(ratings.fetchedAt),
      ratingsServedFromCache: ratings.servingPersisted,
    },
    football: {
      ready: readiness.footballReady,
      lastUpdated: football.lastUpdated?.toISOString() ?? null,
      error: football.error,
      competitionErrors: football.competitionErrors,
    },
    activeFixtures: {
      count: active.count,
      byCompetition: active.byCompetition,
      lastUpdated: active.lastUpdated?.toISOString() ?? null,
    },
    // Deliberately outside the ready/not-ready decision: chat answers still
    // carry model grounding without search, so a search outage degrades an
    // answer rather than taking the service down. It must not be invisible
    // either -- the primary provider is an undocumented endpoint, and a silent
    // format change there would otherwise look like the model simply choosing
    // not to search. Alert on consecutiveFailures climbing, or on
    // lastGoodProvider moving off "minimax".
    webSearch: getWebSearchStatus(),
    // Surfaced because the effective limit is a function of replica count, and
    // a mismatch between API_REPLICAS and Railway's actual setting is
    // otherwise invisible until someone bursts the endpoint.
    askRateLimit: askRateLimitConfig,
    marketOdds: {
      ready: readiness.marketOddsReady,
      lastUpdated: odds.lastUpdated?.toISOString() ?? null,
      error: odds.error,
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

function logFatalProcessError(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(JSON.stringify({
    level: "fatal",
    source: label,
    message,
    ...(stack ? { stack } : {}),
  }));
}

process.on("unhandledRejection", (reason) => {
  logFatalProcessError("unhandledRejection", reason);
});

process.on("uncaughtException", (error) => {
  logFatalProcessError("uncaughtException", error);
  process.exit(1);
});

app.listen(port, () => {
  console.log(`API server running on port ${port}`);

  void (async () => {
    await startFootballCron();
    await startClubRatingsCron();
    await startModelCron();
    await startModelMarketOddsCron();
  })().catch((error) => {
    logFatalProcessError("Bootstrap", error);
  });
});
