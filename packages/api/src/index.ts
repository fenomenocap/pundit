import "./load-env";
import express, { type Express } from "express";
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
  clubRatingsAreCurrent,
  getCachedClubRatings,
  startClubRatingsCron,
} from "./services/club-ratings";
import { getCachedModelData, getModelRefreshState, startModelCron } from "./services/model-data";
import {
  getCachedMatches,
  getCachedSeasonSchedule,
  seasonScheduleStatus,
  startFootballCron,
} from "./services/football-data";
import { getActiveFixtures, getActiveFixtureStatus } from "./services/active-fixtures";
import {
  getModelMarketOddsStatus,
  startModelMarketOddsCron,
} from "./services/model-market-odds";
import { evaluateReadiness } from "./services/readiness";
import { getWebSearchStatus } from "./services/web-search";
import { getAnalystResponseStatus, getInferenceStatus } from "./services/ask";
import { getRuntimeVersion } from "./services/runtime-version";
import {
  getFixtureRegistryStatus,
  getRecognizedFixtureSnapshot,
  startFixtureRegistryShadow,
} from "./services/fixture-registry";

export const app: Express = express();
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

app.get("/version", (_req, res) => {
  res.set("Cache-Control", "no-store").json(getRuntimeVersion());
});

// Read-only certification surface. It contains approved structured identities
// and capability decisions only; discovery candidates/search results never
// enter the registry and therefore cannot appear here.
app.get("/api/fixtures/recognized", (_req, res) => {
  const model = getCachedModelData();
  const modelRefresh = getModelRefreshState();
  const ratings = getCachedClubRatings();
  res.set("Cache-Control", "no-store").json(getRecognizedFixtureSnapshot({
    modelFixtures: model.fixtures,
    modelInitialized: model.lastUpdated !== null,
    modelRefreshing: modelRefresh.refreshing,
    ratingsAvailable: clubRatingsAreCurrent(ratings),
    missingRatingTeamIds: modelRefresh.missingRatingTeamIds,
  }));
});

function currentReadiness() {
  const model = getCachedModelData();
  const football = getCachedMatches();
  const activeFixtures = getActiveFixtures();
  const active = getActiveFixtureStatus();
  const odds = getModelMarketOddsStatus();
  const ratings = getCachedClubRatings();
  const readiness = evaluateReadiness(
    model, football, activeFixtures, odds, clubRatingsAreCurrent(ratings)
  );
  return { model, football, activeFixtures, active, odds, ratings, readiness };
}

app.get("/startup", (_req, res) => {
  const { model, football, activeFixtures, readiness } = currentReadiness();
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? "started" : "starting",
    version: getRuntimeVersion(),
    model: {
      ready: readiness.modelReady,
      fixtureCount: model.fixtures.length,
      expectedActiveFixtureCount: activeFixtures.length,
      lastUpdated: model.lastUpdated?.toISOString() ?? null,
      error: model.error,
    },
    football: {
      ready: readiness.footballReady,
      lastUpdated: football.lastUpdated?.toISOString() ?? null,
      error: football.error,
    },
  });
});

app.get("/ready", (_req, res) => {
  const {
    model, football, activeFixtures, active, odds, ratings, readiness,
  } = currentReadiness();
  const seasonSchedule = getCachedSeasonSchedule();
  const seasonStatus = seasonScheduleStatus(seasonSchedule);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? "ready" : "loading",
    version: getRuntimeVersion(),
    model: {
      ready: readiness.modelReady,
      fixtureCount: model.fixtures.length,
      expectedActiveFixtureCount: activeFixtures.length,
      lastUpdated: model.lastUpdated?.toISOString() ?? null,
      error: model.error,
      // Retained for schema compatibility with older readiness consumers. The
      // release artifact has one coherent timestamp and no per-club fallback,
      // so new deployments normally report an empty list.
      staleRatings: ratings.staleRatings,
      // Whole-artifact age and recovery state. The legacy field name remains in
      // the response for compatibility; true now means the bundled selector was
      // invalid and a validated /data current/last-good artifact was recovered.
      ratingsAsOf: ratings.fetchedAt?.toISOString() ?? null,
      ratingsAgeDays: clubRatingsAgeDays(ratings.fetchedAt),
      ratingsServedFromCache: ratings.servingPersisted,
      ratingArtifactId: ratings.artifactId,
      ratingArtifactSha256: ratings.artifactSha256,
    },
    football: {
      ready: readiness.footballReady,
      lastUpdated: football.lastUpdated?.toISOString() ?? null,
      error: football.error,
      competitionErrors: football.competitionErrors,
    },
    // The complete season schedule is degradable: table grounding remains
    // available if it is absent, while a persisted last-good schedule can keep
    // the simulator useful through an ESPN refresh failure.
    seasonSchedule: {
      ready: seasonStatus.ready,
      competitionId: seasonSchedule.competitionId,
      seasonId: seasonSchedule.seasonId,
      fixtureCount: seasonSchedule.fixtures.length,
      lastUpdated: seasonSchedule.lastUpdated?.toISOString() ?? null,
      error: seasonSchedule.error,
      servingLastGood: seasonStatus.servingLastGood,
      ageMinutes: seasonStatus.ageMinutes,
    },
    activeFixtures: {
      count: active.count,
      byCompetition: active.byCompetition,
      lastUpdated: active.lastUpdated?.toISOString() ?? null,
    },
    // Deliberately outside the ready/not-ready decision: chat answers still
    // carry model grounding without search, so a search outage degrades an
    // answer rather than taking the service down. It must not be invisible
    // either -- the default primary is an undocumented endpoint, and a silent
    // format change there would otherwise look like the model simply choosing
    // not to search.
    //
    // Alert on: `circuitOpen` (every provider out), `usingFallback` staying
    // true (the primary is failing and the bill is moving), any provider's
    // `lastThrottledAt` advancing, or `lastDegradedReason` being set. Reported
    // separately from `inference` because the two used to share a key: "which
    // quota ran out" must be answerable from this payload alone.
    webSearch: getWebSearchStatus(),
    // Inference health, independent of search. `dedicatedKey: false` means
    // answers are still being generated on the same credential as search --
    // the shared-quota configuration this endpoint exists to make visible.
    // Contains no key material: only which variable supplied it and the host.
    inference: getInferenceStatus(),
    // V2 is on unless ANALYST_RESPONSE_V2 is exactly "false". The counters
    // make schema acceptance, fail-closed fallback and numeric intervention
    // visible without exposing prompts or user text.
    analystResponse: getAnalystResponseStatus(),
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
    fixtureRegistry: getFixtureRegistryStatus(),
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

let processHandlersInstalled = false;

function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  process.on("unhandledRejection", (reason) => {
    logFatalProcessError("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error) => {
    logFatalProcessError("uncaughtException", error);
    process.exit(1);
  });
}

export function startServer() {
  installProcessErrorHandlers();
  return app.listen(port, () => {
  console.log(`API server running on port ${port}`);

  void (async () => {
    await startFootballCron();
    // The registry observes the same authoritative ESPN cache in shadow mode
    // by default. Enabling expanded routing is a separate release flag.
    startFixtureRegistryShadow();
    await startClubRatingsCron();
    await startModelCron();
    await startModelMarketOddsCron();
  })().catch((error) => {
    logFatalProcessError("Bootstrap", error);
  });
  });
}

if (require.main === module) startServer();
