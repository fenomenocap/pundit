import fs from "node:fs";
import path from "node:path";
import { computeMatchModel } from "./dixon-coles";

export type EvaluationMethod = "reconstructed" | "snapshot";

export interface EvaluationFixture {
  id: number;
  utcDate: string;
  stage: string | null;
  group: string | null;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  result: {
    homeScore: number;
    awayScore: number;
    winner: "home" | "away" | "draw";
  };
  predictedOutcome: "home" | "away" | "draw";
  method: EvaluationMethod;
}

export interface CalibrationBucket {
  label: string;
  /** Forecasts falling in this bucket — three per fixture, one per outcome. */
  count: number;
  avgPredicted: number;
  /** Share of those forecasts whose outcome occurred. */
  actualRate: number;
}

export interface EvaluationMetrics {
  fixtureCount: number;
  /** Number of binary outcome forecasts used by the reliability curve. */
  calibrationForecastCount: number;
  forecastsPerFixture: 3;
  calibrationMethod: "one-vs-rest-1x2";
  brierScore: number | null;
  logLoss: number | null;
  winnerAccuracy: number | null;
  drawCount: number;
  calibration: CalibrationBucket[];
}

export interface Wc2026EvaluationArtifact {
  competition: "fifa.world";
  method: EvaluationMethod;
  builtAt: string;
  disclaimer: string;
  fixtures: EvaluationFixture[];
  metrics: EvaluationMetrics;
}

function calibrationMetadata(fixtureCount: number) {
  return {
    calibrationForecastCount: fixtureCount * 3,
    forecastsPerFixture: 3 as const,
    calibrationMethod: "one-vs-rest-1x2" as const,
  };
}

const ARTIFACT_PATH = path.join(__dirname, "../../data/evaluation/wc-2026.json");

let cachedArtifact: Wc2026EvaluationArtifact | null = null;

export function getWc2026EvaluationArtifactPath(): string {
  return ARTIFACT_PATH;
}

export function loadWc2026EvaluationArtifact(): Wc2026EvaluationArtifact {
  if (cachedArtifact) return cachedArtifact;
  const raw = fs.readFileSync(ARTIFACT_PATH, "utf8");
  const parsed = JSON.parse(raw) as Wc2026EvaluationArtifact;
  const builtAt = Date.parse(parsed.builtAt);
  if (!Number.isFinite(builtAt)) throw new Error("WC evaluation builtAt must be an ISO timestamp");
  if (parsed.fixtures.some((fixture) => !Number.isFinite(Date.parse(fixture.utcDate)))) {
    throw new Error("WC evaluation fixture utcDate must be an ISO timestamp");
  }
  if (parsed.fixtures.some((fixture) => Date.parse(fixture.utcDate) > builtAt)) {
    throw new Error("WC evaluation cannot be built before a fixture it contains");
  }
  const expectedForecastCount = parsed.fixtures.length * 3;
  const observedForecastCount = parsed.metrics.calibration.reduce(
    (sum, bucket) => sum + bucket.count,
    0
  );
  if (parsed.metrics.fixtureCount !== parsed.fixtures.length
    || parsed.metrics.calibrationForecastCount !== expectedForecastCount
    || observedForecastCount !== expectedForecastCount
    || parsed.metrics.forecastsPerFixture !== 3
    || parsed.metrics.calibrationMethod !== "one-vs-rest-1x2") {
    throw new Error("WC evaluation calibration metadata does not match its fixtures");
  }
  const recomputedMetrics = computeEvaluationMetrics(parsed.fixtures);
  if (JSON.stringify(parsed.metrics) !== JSON.stringify(recomputedMetrics)) {
    throw new Error("WC evaluation stored metrics do not match deterministic fixture recomputation");
  }
  // The frozen source includes valid short-form UTC strings. Expose one
  // canonical wire format without changing any instant or match meaning.
  parsed.builtAt = new Date(builtAt).toISOString();
  parsed.fixtures = parsed.fixtures.map((fixture) => ({
    ...fixture,
    utcDate: new Date(fixture.utcDate).toISOString(),
  }));
  cachedArtifact = parsed;
  return cachedArtifact;
}

export function clearWc2026EvaluationCache(): void {
  cachedArtifact = null;
}

type Outcome = "home" | "draw" | "away";

function actualOutcome(homeScore: number, awayScore: number): Outcome {
  if (homeScore > awayScore) return "home";
  if (homeScore < awayScore) return "away";
  return "draw";
}

function predictedOutcome(pHome: number, pDraw: number, pAway: number): Outcome {
  if (pHome >= pDraw && pHome >= pAway) return "home";
  if (pDraw >= pHome && pDraw >= pAway) return "draw";
  return "away";
}

function outcomeProbabilities(
  outcome: Outcome,
  pHome: number,
  pDraw: number,
  pAway: number
): number {
  if (outcome === "home") return pHome;
  if (outcome === "draw") return pDraw;
  return pAway;
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function computeEvaluationMetrics(fixtures: EvaluationFixture[]): EvaluationMetrics {
  if (fixtures.length === 0) {
    return {
      fixtureCount: 0,
      ...calibrationMetadata(0),
      brierScore: null,
      logLoss: null,
      winnerAccuracy: null,
      drawCount: 0,
      calibration: [],
    };
  }

  let brierTotal = 0;
  let logLossTotal = 0;
  let winnerHits = 0;
  let drawCount = 0;

  const bucketDefs = [
    { label: "0–20%", min: 0, max: 0.2 },
    { label: "20–40%", min: 0.2, max: 0.4 },
    { label: "40–60%", min: 0.4, max: 0.6 },
    { label: "60–80%", min: 0.6, max: 0.8 },
    { label: "80–100%", min: 0.8, max: 1.01 },
  ];
  const bucketStats = bucketDefs.map((bucket) => ({
    ...bucket,
    count: 0,
    predictedSum: 0,
    actualSum: 0,
  }));

  for (const fixture of fixtures) {
    const actual = fixture.result.winner;
    const oneHot = {
      home: actual === "home" ? 1 : 0,
      draw: actual === "draw" ? 1 : 0,
      away: actual === "away" ? 1 : 0,
    };
    brierTotal += (fixture.pHome - oneHot.home) ** 2
      + (fixture.pDraw - oneHot.draw) ** 2
      + (fixture.pAway - oneHot.away) ** 2;

    const actualProb = Math.max(
      outcomeProbabilities(actual, fixture.pHome, fixture.pDraw, fixture.pAway),
      1e-15
    );
    logLossTotal += -Math.log(actualProb);

    if (actual === "draw") drawCount += 1;
    if (fixture.predictedOutcome === actual) winnerHits += 1;

    // A reliability curve asks: of everything forecast at ~p, how much of it
    // happened? So every forecast is binned by its own probability and scored
    // against whether that outcome occurred -- all three per fixture, not only
    // the one that came true.
    //
    // Binning solely the realised outcome, and then counting it as having
    // happened, made actualRate exactly 1 in every bucket by construction: the
    // curve reported that things which happened, happened. It looked like a
    // perfectly calibrated model and carried no information at all.
    const forecasts: ReadonlyArray<readonly [number, number]> = [
      [fixture.pHome, oneHot.home],
      [fixture.pDraw, oneHot.draw],
      [fixture.pAway, oneHot.away],
    ];
    for (const [predicted, occurred] of forecasts) {
      const bucket = bucketStats.find(
        (entry) => predicted >= entry.min && predicted < entry.max
      );
      if (!bucket) continue;
      bucket.count += 1;
      bucket.predictedSum += predicted;
      bucket.actualSum += occurred;
    }
  }

  const calibration: CalibrationBucket[] = bucketStats
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      avgPredicted: rounded(bucket.predictedSum / bucket.count),
      actualRate: rounded(bucket.actualSum / bucket.count),
    }));

  return {
    fixtureCount: fixtures.length,
    ...calibrationMetadata(fixtures.length),
    brierScore: rounded(brierTotal / fixtures.length),
    logLoss: rounded(logLossTotal / fixtures.length),
    winnerAccuracy: rounded(winnerHits / fixtures.length),
    drawCount,
    calibration,
  };
}

export function buildEvaluationFixture(input: {
  id: number;
  utcDate: string;
  stage: string | null;
  group: string | null;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  homeScore: number;
  awayScore: number;
  method?: EvaluationMethod;
}): EvaluationFixture {
  const model = computeMatchModel(input.homeElo, input.awayElo);
  const winner = actualOutcome(input.homeScore, input.awayScore);
  const pHome = rounded(model.pHome);
  const pDraw = rounded(model.pDraw);
  const pAway = rounded(model.pAway);
  return {
    id: input.id,
    utcDate: input.utcDate,
    stage: input.stage,
    group: input.group,
    home: input.home,
    away: input.away,
    homeElo: rounded(input.homeElo, 1),
    awayElo: rounded(input.awayElo, 1),
    pHome,
    pDraw,
    pAway,
    pOver2_5: rounded(model.pOver2_5),
    pUnder2_5: rounded(model.pUnder2_5),
    pBttsYes: rounded(model.pBttsYes),
    pBttsNo: rounded(model.pBttsNo),
    result: {
      homeScore: input.homeScore,
      awayScore: input.awayScore,
      winner,
    },
    predictedOutcome: predictedOutcome(pHome, pDraw, pAway),
    method: input.method ?? "reconstructed",
  };
}
