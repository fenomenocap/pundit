"""Build the committed EPL calibration inputs for the 2026-10-22 re-fit.

Offline and deterministic once the raw files are present. Inputs:
  raw/E0-2425.csv, raw/E0-2526.csv, raw/E0-2627.csv
      football-data.co.uk Premier League results
      (https://www.football-data.co.uk/mmz4281/<season>/E0.csv)
  ClubElo ratings published before kickoff:
      - tonyelhabr/club-rankings daily ClubElo mirror (ENG rows extracted to
        raw/clubelo-eng-mirror.csv), and
      - the committed ClubElo pins under packages/api/data/model-artifacts/clubelo.
Output: inputs/matches.json (one row per match, ratings only when a ClubElo
publication dated strictly before the kickoff UTC date and at most 14 days old
exists for both clubs).
"""
import csv, glob, hashlib, json, os, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
FD_TO_CANON = {"Nott'm Forest": "Forest", "Luton": "Luton Town"}
FD_TO_ELO = {"Nott'm Forest": "Forest"}
LONDON = ZoneInfo("Europe/London")

def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()

ratings = {}  # date -> {club: elo}
def add(date, club, elo):
    ratings.setdefault(date, {})[club] = float(elo)

mirror = os.path.join(HERE, "raw", "clubelo-eng-mirror.csv")
for r in csv.DictReader(open(mirror)):
    add(r["date"], r["Club"], r["Elo"])
for path in sorted(glob.glob(os.path.join(REPO, "packages/api/data/model-artifacts/clubelo/*.json"))):
    d = json.load(open(path))
    p = (d.get("payload") or {}) if isinstance(d, dict) else {}
    if not p.get("snapshotAt"):
        continue
    date = p["snapshotAt"][:10]
    for club, elo in p["byProfile"]["eng-clubs"].items():
        add(date, club, elo)
dates = sorted(ratings)

def rating_before(kickoff_utc, home, away):
    day = kickoff_utc.date().isoformat()
    for d in reversed(dates):
        if d >= day:
            continue
        if (kickoff_utc.date() - datetime.fromisoformat(d).date()).days > 14:
            return None
        table = ratings[d]
        if home in table and away in table:
            return d, table[home], table[away]
        return None
    return None

rows, seasons = [], {}
for season in ["2425", "2526", "2627"]:
    path = os.path.join(HERE, "raw", f"E0-{season}.csv")
    seasons[season] = {"path": os.path.relpath(path, REPO), "sha256": sha(path)}
    for r in csv.DictReader(open(path, encoding="utf-8-sig")):
        if not r.get("FTHG") or not r.get("Date"):
            continue
        local = datetime.strptime(f"{r['Date']} {r.get('Time') or '15:00'}", "%d/%m/%Y %H:%M").replace(tzinfo=LONDON)
        kickoff = local.astimezone(timezone.utc)
        h, a = r["HomeTeam"], r["AwayTeam"]
        row = {
            "sourceEventId": f"fdco:E0:{season}:{kickoff.date().isoformat()}:{h}:{a}",
            "seasonId": f"20{season[:2]}-{season[2:]}",
            "kickoff": kickoff.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "homeCanonicalName": FD_TO_CANON.get(h, h),
            "awayCanonicalName": FD_TO_CANON.get(a, a),
            "homeGoals": int(r["FTHG"]), "awayGoals": int(r["FTAG"]),
        }
        got = rating_before(kickoff, FD_TO_ELO.get(h, h), FD_TO_ELO.get(a, a))
        if got:
            row.update({"homeElo": got[1], "awayElo": got[2], "ratingDate": got[0]})
        rows.append(row)
rows.sort(key=lambda r: (r["kickoff"], r["sourceEventId"]))
os.makedirs(os.path.join(HERE, "inputs"), exist_ok=True)
out = os.path.join(HERE, "inputs", "matches.json")
json.dump(rows, open(out, "w"), indent=1)
manifest = {
    "builtBy": "model/calibration-2026-10-22/prepare_inputs.py",
    "results": seasons,
    "clubeloMirror": {"path": os.path.relpath(mirror, REPO), "sha256": sha(mirror),
                      "upstream": "https://github.com/tonyelhabr/club-rankings/releases/download/club-rankings/clubelo-club-rankings.csv"},
    "clubeloPins": sorted(os.path.relpath(p, REPO) for p in glob.glob(os.path.join(REPO, "packages/api/data/model-artifacts/clubelo/*.json")) if "production" not in p and "golden" not in p),
    "ratingPolicy": "latest ClubElo publication dated strictly before the kickoff UTC date, at most 14 days old, both clubs present",
    "matches": len(rows), "matchesWithRatings": sum(1 for r in rows if "homeElo" in r),
    "matchesSha256": sha(out),
}
json.dump(manifest, open(os.path.join(HERE, "inputs", "manifest.json"), "w"), indent=1)
print(json.dumps({k: v for k, v in manifest.items() if k != "clubeloPins"}, indent=1))
