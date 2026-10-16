"""Map football-data.co.uk names to Understat titles."""

from __future__ import annotations

UNDERSTAT_ALIASES = {
    "Man United": "Manchester United",
    "Man City": "Manchester City",
    "Nott'm Forest": "Nottingham Forest",
    "Tottenham": "Tottenham",
    "Brighton": "Brighton",
    "Wolves": "Wolverhampton Wanderers",
    "West Ham": "West Ham",
    "Leicester": "Leicester",
    "Newcastle": "Newcastle United",
    "West Brom": "West Bromwich Albion",
    "Sheffield Utd": "Sheffield United",
    "Sheffield United": "Sheffield United",
    "Luton": "Luton",
    "Ipswich": "Ipswich",
}


def to_understat(team: str) -> str:
    return UNDERSTAT_ALIASES.get(team, team)


def to_statsbomb(team: str) -> str:
    return UNDERSTAT_ALIASES.get(team, team)
