import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { requestLogger, errorHandler } from "./middleware";
import matchRoutes from "./routes/matches";
import polymarketRoutes from "./routes/polymarkets";
import modelRoutes from "./routes/model";
import askRoutes from "./routes/ask";
import { startPolymarketCron } from "./services/polymarket-data";
import { startModelCron } from "./services/model-data";
import { startFootballCron } from "./services/football-data";

const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || process.env.API_PORT || 3001;

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/matches", matchRoutes);
app.use("/api/polymarkets", polymarketRoutes);
app.use("/api/model", modelRoutes);
app.use("/api/ask", askRoutes);

// ─── Error Handling ─────────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`API server running on port ${port}`);

  // Start Polymarket cron — fetches WC 2026 markets and reference odds every 6 hours
  startPolymarketCron();

  // Start worldcup-model cron — fetches Elo/Poisson win probabilities every 6 hours
  startModelCron();

  // Start football-data.org cron — fetches live WC fixtures/results/standings every 6 hours
  startFootballCron();
});
