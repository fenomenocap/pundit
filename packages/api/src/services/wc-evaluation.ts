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
  count: number;
  avgPredicted: number;
  actualRate: number;
}

export interface EvaluationMetrics {
  fixtureCount: number;
  brierScore: number;
  logLoss: number;
  winnerAccuracy: number;
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

const ARTIFACT_PATH = path.join(__dirname, "../../data/evaluation/wc-2026.json");

let cachedArtifact: Wc2026EvaluationArtifact | null = null;

export function getWc2026EvaluationArtifactPath(): string {
  return ARTIFACT_PATH;
}

export function loadWc2026EvaluationArtifact(): Wc2026EvaluationArtifact {
  if (cachedArtifact) return cachedArtifact;
  const raw = fs.readFileSync(ARTIFACT_PATH, "utf8");
  cachedArtifact = JSON.parse(raw) as Wc2026EvaluationArtifact;
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
      brierScore: 0,
      logLoss: 0,
      winnerAccuracy: 0,
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

    const predictedForActual = outcomeProbabilities(
      actual,
      fixture.pHome,
      fixture.pDraw,
      fixture.pAway
    );
    const bucket = bucketStats.find(
      (entry) => predictedForActual >= entry.min && predictedForActual < entry.max
    );
    if (bucket) {
      bucket.count += 1;
      bucket.predictedSum += predictedForActual;
      bucket.actualSum += 1;
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
