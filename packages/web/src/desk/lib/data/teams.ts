export type TeamId =
  | "ARS"
  | "AVL"
  | "BOU"
  | "BRE"
  | "BHA"
  | "CHE"
  | "COV"
  | "CRY"
  | "EVE"
  | "FUL"
  | "HUL"
  | "IPS"
  | "LEE"
  | "LIV"
  | "MCI"
  | "MUN"
  | "NEW"
  | "NFO"
  | "SUN"
  | "TOT";

export type Team = {
  id: TeamId;
  name: string;
  short: string;
  city: string;
};

export const TEAMS: Record<TeamId, Team> = {
  ARS: { id: "ARS", name: "Arsenal", short: "Arsenal", city: "London" },
  AVL: { id: "AVL", name: "Aston Villa", short: "Aston Villa", city: "Birmingham" },
  BOU: { id: "BOU", name: "Bournemouth", short: "Bournemouth", city: "Bournemouth" },
  BRE: { id: "BRE", name: "Brentford", short: "Brentford", city: "London" },
  BHA: { id: "BHA", name: "Brighton", short: "Brighton", city: "Brighton" },
  CHE: { id: "CHE", name: "Chelsea", short: "Chelsea", city: "London" },
  COV: { id: "COV", name: "Coventry City", short: "Coventry", city: "Coventry" },
  CRY: { id: "CRY", name: "Crystal Palace", short: "Crystal Palace", city: "London" },
  EVE: { id: "EVE", name: "Everton", short: "Everton", city: "Liverpool" },
  FUL: { id: "FUL", name: "Fulham", short: "Fulham", city: "London" },
  HUL: { id: "HUL", name: "Hull City", short: "Hull", city: "Hull" },
  IPS: { id: "IPS", name: "Ipswich Town", short: "Ipswich", city: "Ipswich" },
  LEE: { id: "LEE", name: "Leeds United", short: "Leeds", city: "Leeds" },
  LIV: { id: "LIV", name: "Liverpool", short: "Liverpool", city: "Liverpool" },
  MCI: { id: "MCI", name: "Manchester City", short: "Man City", city: "Manchester" },
  MUN: { id: "MUN", name: "Manchester United", short: "Man Utd", city: "Manchester" },
  NEW: { id: "NEW", name: "Newcastle", short: "Newcastle", city: "Newcastle" },
  NFO: { id: "NFO", name: "Nott'm Forest", short: "Nott'm Forest", city: "Nottingham" },
  SUN: { id: "SUN", name: "Sunderland", short: "Sunderland", city: "Sunderland" },
  TOT: { id: "TOT", name: "Tottenham", short: "Tottenham", city: "London" },
};

export const TEAM_LIST = Object.values(TEAMS);

/** Formal names and common aliases (ESPN, FPL, football-data) to a club id. */
const NAME_TO_ID: Record<string, TeamId> = {
  Arsenal: "ARS",
  "Aston Villa": "AVL",
  Villa: "AVL",
  Bournemouth: "BOU",
  "AFC Bournemouth": "BOU",
  Brentford: "BRE",
  Brighton: "BHA",
  "Brighton & Hove Albion": "BHA",
  "Brighton and Hove Albion": "BHA",
  Chelsea: "CHE",
  Coventry: "COV",
  "Coventry City": "COV",
  "Crystal Palace": "CRY",
  Everton: "EVE",
  Fulham: "FUL",
  Hull: "HUL",
  "Hull City": "HUL",
  Ipswich: "IPS",
  "Ipswich Town": "IPS",
  Leeds: "LEE",
  "Leeds United": "LEE",
  Liverpool: "LIV",
  "Man City": "MCI",
  "Manchester City": "MCI",
  "Man United": "MUN",
  "Man Utd": "MUN",
  "Manchester United": "MUN",
  Newcastle: "NEW",
  "Newcastle United": "NEW",
  Forest: "NFO",
  "Nott'm Forest": "NFO",
  "Nottingham Forest": "NFO",
  Sunderland: "SUN",
  Tottenham: "TOT",
  "Tottenham Hotspur": "TOT",
  Spurs: "TOT",
};

export function teamIdFromName(name: string | null | undefined): TeamId | null {
  if (!name) return null;
  if (NAME_TO_ID[name]) return NAME_TO_ID[name];
  const lower = name.trim().toLowerCase();
  for (const team of TEAM_LIST) {
    if (team.id.toLowerCase() === lower || team.name.toLowerCase() === lower || team.short.toLowerCase() === lower) return team.id;
  }
  for (const [alias, id] of Object.entries(NAME_TO_ID)) if (alias.toLowerCase() === lower) return id;
  return null;
}

/** Formal club name for a club as any source names it; unknown clubs keep the source name. */
export function formalTeamName(name: string): string {
  const id = teamIdFromName(name);
  return id ? TEAMS[id].name : name;
}
