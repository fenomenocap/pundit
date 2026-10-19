import fs from "node:fs";
import path from "node:path";

export interface BacktestGateThreshold {
  divergenceMin: number;
  n: number;
  status: string;
  edgeAllowed: boolean;
  modelLogLoss?: number;
  marketLogLoss?: number;
  bootstrapLogLossDelta?: {
    delta_mean: number;
    ci_low: number;
    ci_high: number;
    beats_close_ci_excludes_zero: boolean;
  };
}

export interface BacktestGateArtifact {
  schemaVersion: number;
  edgeValidationActive: boolean;
  promotedModel: string;
  gates: BacktestGateThreshold[];
  disclaimer: string;
  phaseMetrics?: Record<
    string,
    { logloss: number; vs_champion_delta: number; vs_close_delta: number }
  >;
}

const DEFAULT_GATE: BacktestGateArtifact = {
  schemaVersion: 1,
  edgeValidationActive: false,
  promotedModel: "champion_baseline",
  gates: [],
  disclaimer:
    "Edge labels require walk-forward backtest CI excluding zero vs close at stated divergence. Run model/backtest to refresh.",
};

function gatePath(): string {
  return path.join(
    __dirname,
    "../../data/model-artifacts/backtest-gate.json"
  );
}

export function loadBacktestGateArtifact(): BacktestGateArtifact {
  const file = gatePath();
  if (!fs.existsSync(file)) return DEFAULT_GATE;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as BacktestGateArtifact;
    if (typeof parsed.edgeValidationActive !== "boolean") return DEFAULT_GATE;
    return parsed;
  } catch {
    return DEFAULT_GATE;
  }
}

/** Whether chat/board may use backtest-validated edge wording at this divergence. */
export function edgeAllowedAtDivergence(
  divergenceMax: number,
  artifact: BacktestGateArtifact = loadBacktestGateArtifact()
): boolean {
  if (!artifact.edgeValidationActive) return false;
  const gate = artifact.gates.find(
    (g) => divergenceMax >= g.divergenceMin && g.edgeAllowed
  );
  return Boolean(gate);
}

export function backtestPromotedModelEnabled(): boolean {
  return process.env.BACKTEST_PROMOTED_MODEL_ENABLED === "true";
}
