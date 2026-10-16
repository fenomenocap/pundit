"""Backtest gate: when may product label 'edge' vs the close?"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from backtest.metrics import bootstrap_log_loss_delta, log_loss


def evaluate_edge_gate(
    model_p: np.ndarray,
    market_p: np.ndarray,
    y: np.ndarray,
    thresholds: list[float],
    criteria: dict,
) -> dict:
    dv = np.abs(model_p - market_p).max(axis=1)
    boot_cfg = criteria["bootstrap"]
    gates = []
    for thr in thresholds:
        k = dv >= thr
        if k.sum() < 50:
            gates.append(
                {
                    "divergenceMin": thr,
                    "n": int(k.sum()),
                    "status": "insufficient_sample",
                    "edgeAllowed": False,
                }
            )
            continue
        boot = bootstrap_log_loss_delta(
            model_p[k],
            market_p[k],
            y[k],
            n=boot_cfg["n"],
            seed=boot_cfg["seed"],
        )
        allowed = boot["beats_close_ci_excludes_zero"]
        gates.append(
            {
                "divergenceMin": thr,
                "n": int(k.sum()),
                "modelLogLoss": round(log_loss(model_p[k], y[k]), 4),
                "marketLogLoss": round(log_loss(market_p[k], y[k]), 4),
                "bootstrapLogLossDelta": boot,
                "status": "pass" if allowed else "fail",
                "edgeAllowed": allowed,
            }
        )
    any_allowed = any(g.get("edgeAllowed") for g in gates)
    return {
        "schemaVersion": 1,
        "edgeValidationActive": any_allowed,
        "gates": gates,
        "disclaimer": "Edge labels require walk-forward backtest CI excluding zero vs close at stated divergence.",
    }


def write_gate_artifact(gate: dict, root: Path) -> Path:
    art = root / "artifacts" / "latest"
    art.mkdir(parents=True, exist_ok=True)
    path = art / "gate.json"
    path.write_text(json.dumps(gate, indent=2))
    repo_gate = root.parent.parent / "packages/api/data/model-artifacts/backtest-gate.json"
    repo_gate.parent.mkdir(parents=True, exist_ok=True)
    repo_gate.write_text(json.dumps(gate, indent=2))
    return path
