"""StatsBomb open data: PL match xG totals for calibration."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import requests

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
PL_CALIBRATION = (2, 27)  # 2015/16 — overlaps Understat 2015


def _match_xg_from_events(events: list[dict]) -> tuple[float, float]:
    hx, ax = 0.0, 0.0
    for ev in events:
        if ev.get("type", {}).get("name") != "Shot":
            continue
        xg = ev.get("shot", {}).get("statsbomb_xg")
        if xg is None:
            continue
        team = ev.get("team", {}).get("name")
        loc = ev.get("location")
        if not team or not loc:
            continue
        # StatsBomb coordinates: x points toward goal; side inferred from period/team — use shot end location
        # Simpler: use shot dict team_id vs match home/away from event team name
        side = ev.get("shot", {}).get("outcome", {}).get("name")
        val = float(xg)
        # Events list includes team on each event
        if ev.get("position", {}).get("name") == "Goalkeeper":
            continue
        # Aggregate by comparing team name to first half possession — use team field only
        # We'll tag home/away when joining; here split by x coordinate heuristic:
        if loc[0] > 60:
            hx += val
        else:
            ax += val
    return hx, ax


def _match_xg_by_team(events: list[dict], home_name: str, away_name: str) -> tuple[float, float]:
    hx, ax = 0.0, 0.0
    for ev in events:
        if ev.get("type", {}).get("name") != "Shot":
            continue
        xg = ev.get("shot", {}).get("statsbomb_xg")
        if xg is None:
            continue
        team = ev.get("team", {}).get("name")
        if team == home_name:
            hx += float(xg)
        elif team == away_name:
            ax += float(xg)
    return hx, ax


def download_statsbomb_calibration(root: Path) -> dict:
    comp_id, season_id = PL_CALIBRATION
    matches_url = f"{BASE}/matches/{comp_id}/{season_id}.json"
    matches = requests.get(matches_url, timeout=120).json()
    out_rows = []
    for m in matches:
        mid = m["match_id"]
        ev_url = f"{BASE}/events/{mid}.json"
        try:
            events = requests.get(ev_url, timeout=60).json()
        except requests.RequestException:
            continue
        home = m["home_team"]["home_team_name"]
        away = m["away_team"]["away_team_name"]
        hx, ax = _match_xg_by_team(events, home, away)
        out_rows.append(
            {
                "match_id": mid,
                "date": m["match_date"],
                "home": home,
                "away": away,
                "home_xg_sb": hx,
                "away_xg_sb": ax,
            }
        )
    body = {
        "competition_id": comp_id,
        "season_id": season_id,
        "season_name": "2015/2016",
        "matches": out_rows,
    }
    out_dir = root / "data" / "xg" / "statsbomb" / "v1"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "pl_1516_match_xg.json"
    text = json.dumps(body, indent=2, sort_keys=True)
    path.write_text(text)
    sha = hashlib.sha256(text.encode()).hexdigest()
    manifest = {
        "schemaVersion": 1,
        "source": "statsbomb/open-data",
        "file": str(path.relative_to(root)),
        "sha256": sha,
        "n": len(out_rows),
    }
    (root / "data" / "xg" / "statsbomb_manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def load_statsbomb_calibration(root: Path) -> list[dict]:
    path = root / "data" / "xg" / "statsbomb" / "v1" / "pl_1516_match_xg.json"
    if not path.exists():
        return []
    return json.loads(path.read_text()).get("matches") or []
