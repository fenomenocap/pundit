"""Build look-ahead-free EPL rows for the November 2026 re-pin study.

Reads only local files:
  raw/E0-1819.csv .. raw/E0-2627.csv
      football-data.co.uk Premier League results
      https://www.football-data.co.uk/mmz4281/<season>/E0.csv
  raw/clubelo-eng.csv
      English rows of the tonyelhabr ClubElo mirror
      (upstream sha recorded in inputs/manifest.json;
       http://api.clubelo.com was HTTP 502 on 22 Oct 2026)
  packages/api/data/model-artifacts/clubelo/*.json
      committed pins, used only for publication dates the mirror does not have

A rating is attached only when both clubs appear on a ClubElo publication
dated strictly before the kickoff UTC date and at most 14 days old. Older
results stay in the file without ratings so the total-goals fit can use them
and the allocation fit cannot.
"""
import csv, glob, hashlib, json, os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
LONDON = ZoneInfo("Europe/London")
SEASONS = ["1819", "1920", "2021", "2122", "2223", "2324", "2425", "2526", "2627"]
# football-data short names that are not already the canonical ClubElo key.
FD_TO_CANON = {"Nott'm Forest": "Forest", "Nottingham Forest": "Forest"}

def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()

ratings = {}
def add(date, club, elo):
    ratings.setdefault(date, {})[club] = float(elo)

mirror = os.path.join(HERE, "raw", "clubelo-eng.csv")
for row in csv.DictReader(open(mirror, newline="")):
    add(row["date"], row["Club"], row["Elo"])
pin_paths = []
for path in sorted(glob.glob(os.path.join(REPO, "packages/api/data/model-artifacts/clubelo/*.json"))):
    if path.endswith("production.json") or "golden" in os.path.basename(path):
        continue
    pin_paths.append(os.path.relpath(path, REPO))
    document = json.load(open(path))
    payload = document.get("payload") or {}
    if not payload.get("snapshotAt"):
        continue
    date = payload["snapshotAt"][:10]
    # The mirror is the historical publication. A pin may only fill a date it does not already cover.
    if date in ratings:
        continue
    for club, elo in payload["byProfile"]["eng-clubs"].items():
        add(date, club, elo)
dates = sorted(ratings)

def rating_before(kickoff, home, away):
    day = kickoff.date()
    day_text = day.isoformat()
    for date in reversed(dates):
        if date >= day_text:
            continue
        age = (day - datetime.fromisoformat(date).date()).days
        if age > 14:
            return None
        table = ratings[date]
        if home in table and away in table:
            return date, table[home], table[away]
        return None
    return None

rows = []
season_files = {}
for season in SEASONS:
    path = os.path.join(HERE, "raw", f"E0-{season}.csv")
    season_files[season] = {"path": os.path.relpath(path, REPO), "sha256": sha(path)}
    for record in csv.DictReader(open(path, encoding="utf-8-sig", newline="")):
        if not record.get("FTHG") or not record.get("FTAG") or not record.get("Date"):
            continue
        clock = record.get("Time") or "15:00"
        local = datetime.strptime(f"{record['Date']} {clock}", "%d/%m/%Y %H:%M").replace(tzinfo=LONDON)
        kickoff = local.astimezone(timezone.utc)
        home = FD_TO_CANON.get(record["HomeTeam"], record["HomeTeam"])
        away = FD_TO_CANON.get(record["AwayTeam"], record["AwayTeam"])
        def shots(key):
            raw = record.get(key)
            return int(raw) if raw not in (None, "") else None
        row = {
            "sourceEventId": f"fdco:E0:{season}:{kickoff.date().isoformat()}:{record['HomeTeam']}:{record['AwayTeam']}",
            "seasonId": f"20{season[:2]}-{season[2:]}",
            "kickoff": kickoff.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "homeCanonicalName": home,
            "awayCanonicalName": away,
            "homeGoals": int(record["FTHG"]),
            "awayGoals": int(record["FTAG"]),
            "homeShotsOnTarget": shots("HST"),
            "awayShotsOnTarget": shots("AST"),
        }
        got = rating_before(kickoff, home, away)
        if got:
            row["homeElo"] = got[1]
            row["awayElo"] = got[2]
            row["ratingDate"] = got[0]
        rows.append(row)

rows.sort(key=lambda row: (row["kickoff"], row["sourceEventId"]))
ids = [row["sourceEventId"] for row in rows]
if len(ids) != len(set(ids)):
    raise SystemExit("duplicate source event id")
os.makedirs(os.path.join(HERE, "inputs"), exist_ok=True)
out = os.path.join(HERE, "inputs", "matches.json")
with open(out, "w") as handle:
    json.dump(rows, handle, indent=1)
    handle.write("\n")

by_season = {}
for row in rows:
    bucket = by_season.setdefault(row["seasonId"], {"matches": 0, "withRatings": 0})
    bucket["matches"] += 1
    if "homeElo" in row:
        bucket["withRatings"] += 1
manifest = {
    "builtBy": "model/epl-repin-2026-11-06/prepare_inputs.py",
    "results": season_files,
    "clubeloMirror": {
        "path": os.path.relpath(mirror, REPO),
        "sha256": sha(mirror),
        "upstream": "https://github.com/tonyelhabr/club-rankings/releases/download/club-rankings/clubelo-club-rankings.csv",
        "upstreamSha256": "9cd156ce90584517bd12662f63688fe0856b2af0194cb70b1482b38f8cb3b6a3",
        "upstreamBytes": 48935087,
        "extract": "Country == ENG",
        "publicationDates": [dates[0], dates[-1]],
        "note": "api.clubelo.com returned HTTP 502 on 22 Oct 2026. Publications before 2023-03-27 are not in this free mirror, so those matches train totals only.",
    },
    "ratingPolicy": "latest ClubElo publication dated strictly before the kickoff UTC date, at most 14 days old, both clubs present; pins fill dates absent from the mirror",
    "matches": len(rows),
    "matchesWithRatings": sum(1 for row in rows if "homeElo" in row),
    "bySeason": by_season,
    "matchesSha256": sha(out),
}
# Record which publication dates came from pins (absent from the mirror file).
mirror_dates = set()
for row in csv.DictReader(open(mirror, newline="")):
    mirror_dates.add(row["date"])
manifest["pinDates"] = sorted(set(dates) - mirror_dates)
manifest["clubeloPins"] = pin_paths
manifest_path = os.path.join(HERE, "inputs", "manifest.json")
with open(manifest_path, "w") as handle:
    json.dump(manifest, handle, indent=1)
    handle.write("\n")
print(json.dumps({"matches": manifest["matches"], "matchesWithRatings": manifest["matchesWithRatings"],
                  "bySeason": by_season, "pinDates": manifest["pinDates"],
                  "matchesSha256": manifest["matchesSha256"]}, indent=1))
