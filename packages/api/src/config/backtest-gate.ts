/**
 * Production 1X2 has not passed the pinned retrospective backtest promotion gate.
 * Until this flips true, user-facing copy must not claim "edge", "value", or +EV
 * from model-minus-market gaps — only "our model vs market" framing.
 */
export const MODEL_EDGE_CLAIMS_ALLOWED = false;

export const BACKTEST_GATE_NOTE =
  "Model-vs-market gaps are shown for comparison only until the backtest gate passes.";
