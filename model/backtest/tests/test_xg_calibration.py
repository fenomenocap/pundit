from pathlib import Path

from backtest.xg.calibration import apply_calibration, load_calibration


def test_calibration_fixture_roundtrip():
    root = Path(__file__).resolve().parents[1]
    cal = load_calibration(root)
    assert cal.get("status") in ("fitted", "missing")
    h, a = apply_calibration(1.5, 0.8, cal)
    assert h > 0 and a > 0
