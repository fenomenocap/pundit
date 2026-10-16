from pathlib import Path

import pandas as pd

from backtest.harness import package_root, run_baseline_harness


def test_baseline_on_fixture():
    root = package_root()
    fix = root / "fixtures" / "sample_e0.csv"
    assert fix.exists()
    dest = root / "data" / "raw"
    dest.mkdir(parents=True, exist_ok=True)
    pd.read_csv(fix).to_csv(dest / "E0_2425.csv", index=False)
    summary = run_baseline_harness(root, seasons=["2425"], eval_from_season="2425")
    assert summary["n"] >= 10
    assert summary["market_logloss"] > 0
