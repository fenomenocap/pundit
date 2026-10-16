"""CLI: download-data, run phases, CI smoke."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from backtest.data import download_all
from backtest.harness import package_root, run_baseline_harness


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pundit-backtest")
    sub = parser.add_subparsers(dest="cmd", required=True)

    dl = sub.add_parser("download-data", help="Fetch football-data.co.uk CSVs")
    dl.add_argument("--season", action="append", dest="seasons")

    run = sub.add_parser("run", help="Run walk-forward backtest")
    run.add_argument(
        "--phase",
        choices=["baseline", "1", "2", "3", "ensemble", "all"],
        default="baseline",
    )
    run.add_argument("--fast", action="store_true", help="Last 3 seasons only (CI)")

    args = parser.parse_args(argv)
    root = package_root()

    if args.cmd == "download-data":
        rep = download_all(root, seasons=args.seasons)
        print(json.dumps(rep, indent=2))
        return 0 if rep["ok"] else 1

    if args.cmd == "run":
        seasons = None
        if getattr(args, "fast", False):
            seasons = ["2223", "2324", "2425"]
        if args.phase == "baseline":
            summary = run_baseline_harness(root, seasons=seasons)
            print(json.dumps(summary, indent=2))
            return 0
        if args.phase == "all":
            from backtest.run_all import run_all_phases

            summary = run_all_phases(root, seasons=seasons)
            print(json.dumps(summary, indent=2))
            return 0
        from backtest.run_all import run_single_phase

        summary = run_single_phase(root, args.phase, seasons=seasons)
        print(json.dumps(summary, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
