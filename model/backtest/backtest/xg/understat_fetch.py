"""Offline Understat EPL match xG (AJAX; run outside CI)."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import requests

LEAGUE = "EPL"
# Understat season year = start year of campaign (2024 => 2024/25).
SEASONS_DEFAULT = list(range(2014, 2027))


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0 (compatible; PunditBacktest/1.0)"})
    return s


def fetch_league_season(session: requests.Session, season_year: int) -> dict[str, Any]:
    session.get(f"https://understat.com/league/{LEAGUE}/{season_year}", timeout=60)
    r = session.get(
        f"https://understat.com/getLeagueData/{LEAGUE}/{season_year}",
        headers={"X-Requested-With": "XMLHttpRequest"},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def normalize_dates(dates: list[dict]) -> list[dict]:
    rows = []
    for m in dates:
        rows.append(
            {
                "match_id": str(m.get("id")),
                "datetime": m.get("datetime"),
                "home": m["h"]["title"],
                "away": m["a"]["title"],
                "home_goals": int(m.get("goals", {}).get("h") or 0),
                "away_goals": int(m.get("goals", {}).get("a") or 0),
                "home_xg": float(m["xG"]["h"]),
                "away_xg": float(m["xG"]["a"]),
            }
        )
    return rows


def xg_dir(root: Path) -> Path:
    d = root / "data" / "xg" / "understat" / "v1"
    d.mkdir(parents=True, exist_ok=True)
    return d


def download_understat(
    root: Path,
    seasons: list[int] | None = None,
    delay_s: float = 0.8,
) -> dict:
    seasons = seasons or SEASONS_DEFAULT
    out_dir = xg_dir(root)
    session = _session()
    manifest: dict = {"schemaVersion": 1, "source": "understat.com", "files": {}}
    ok, missing = [], []
    for yr in seasons:
        path = out_dir / f"EPL_{yr}.json"
        try:
            payload = fetch_league_season(session, yr)
            rows = normalize_dates(payload.get("dates") or [])
            if not rows:
                missing.append(yr)
                continue
            body = {"seasonYear": yr, "league": LEAGUE, "matches": rows}
            text = json.dumps(body, indent=2, sort_keys=True)
            path.write_text(text)
            sha = hashlib.sha256(text.encode()).hexdigest()
            manifest["files"][str(yr)] = {"path": str(path.relative_to(root)), "sha256": sha, "n": len(rows)}
            ok.append(yr)
        except (requests.RequestException, KeyError, TypeError, ValueError):
            missing.append(yr)
        time.sleep(delay_s)
    manifest_path = root / "data" / "xg" / "understat_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return {"ok": ok, "missing": missing, "manifest": str(manifest_path)}


def load_understat_matches(root: Path) -> list[dict]:
    out_dir = xg_dir(root)
    rows: list[dict] = []
    for path in sorted(out_dir.glob("EPL_*.json")):
        body = json.loads(path.read_text())
        rows.extend(body.get("matches") or [])
    return rows
