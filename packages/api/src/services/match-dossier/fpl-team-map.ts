import type { FplBootstrapSnapshot, FplBootstrapTeam } from "./fpl-bootstrap-injuries";

/**
 * Pundit ESPN model fixture side label → FPL bootstrap `short_name` (team code).
 * Resolved against bootstrap `teams[]` by id/short_name, not display name strings.
 */
export const PUNDIT_FIXTURE_SIDE_TO_FPL_SHORT_NAME: Record<string, string> = {
  Arsenal: "ARS",
  "Aston Villa": "AVL",
  Bournemouth: "BOU",
  Brentford: "BRE",
  Brighton: "BHA",
  Chelsea: "CHE",
  Coventry: "COV",
  "Crystal Palace": "CRY",
  Everton: "EVE",
  Fulham: "FUL",
  Hull: "HUL",
  Ipswich: "IPS",
  Leeds: "LEE",
  Liverpool: "LIV",
  "Man City": "MCI",
  "Man United": "MUN",
  Newcastle: "NEW",
  Forest: "NFO",
  Sunderland: "SUN",
  Tottenham: "TOT",
  "West Ham": "WHU",
  Wolves: "WOL",
};

/** Current Premier League sides used in model fixtures (20). */
export const PUNDIT_PREMIER_LEAGUE_FIXTURE_SIDES = [
  "Arsenal",
  "Aston Villa",
  "Bournemouth",
  "Brentford",
  "Brighton",
  "Chelsea",
  "Crystal Palace",
  "Everton",
  "Fulham",
  "Ipswich",
  "Leeds",
  "Liverpool",
  "Man City",
  "Man United",
  "Newcastle",
  "Forest",
  "Sunderland",
  "Tottenham",
  "West Ham",
  "Wolves",
] as const;

const FPL_SHORT_TO_PUNDIT_SIDE: Record<string, string> = Object.fromEntries(
  Object.entries(PUNDIT_FIXTURE_SIDE_TO_FPL_SHORT_NAME).map(([side, code]) => [code, side]),
);

export function findFplTeamByFixtureSide(
  side: string,
  snapshot: FplBootstrapSnapshot,
): FplBootstrapTeam | null {
  const shortName = PUNDIT_FIXTURE_SIDE_TO_FPL_SHORT_NAME[side];
  if (!shortName) return null;
  return snapshot.teams.find((team) => team.short_name === shortName) ?? null;
}

export function resolveFplTeamIdForFixtureSide(
  side: string,
  snapshot: FplBootstrapSnapshot,
): number | null {
  return findFplTeamByFixtureSide(side, snapshot)?.id ?? null;
}

export function fixtureSideLabelForFplTeam(
  fixtureHome: string,
  fixtureAway: string,
  fplTeam: FplBootstrapTeam,
): string {
  const punditSide = FPL_SHORT_TO_PUNDIT_SIDE[fplTeam.short_name];
  if (punditSide === fixtureHome) return fixtureHome;
  if (punditSide === fixtureAway) return fixtureAway;
  return punditSide ?? fplTeam.name;
}

export function fixtureFplTeamIdsFromMap(
  snapshot: FplBootstrapSnapshot,
  home: string,
  away: string,
): Set<number> {
  const ids = new Set<number>();
  for (const side of [home, away]) {
    const id = resolveFplTeamIdForFixtureSide(side, snapshot);
    if (id != null) ids.add(id);
  }
  return ids;
}
