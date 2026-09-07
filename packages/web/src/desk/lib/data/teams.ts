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
  AVL: { id: "AVL", name: "Aston Villa", short: "Villa", city: "Birmingham" },
  BOU: { id: "BOU", name: "Bournemouth", short: "Cherries", city: "Bournemouth" },
  BRE: { id: "BRE", name: "Brentford", short: "Bees", city: "London" },
  BHA: { id: "BHA", name: "Brighton", short: "Albion", city: "Brighton" },
  CHE: { id: "CHE", name: "Chelsea", short: "Chelsea", city: "London" },
  COV: { id: "COV", name: "Coventry City", short: "Coventry", city: "Coventry" },
  CRY: { id: "CRY", name: "Crystal Palace", short: "Palace", city: "London" },
  EVE: { id: "EVE", name: "Everton", short: "Everton", city: "Liverpool" },
  FUL: { id: "FUL", name: "Fulham", short: "Fulham", city: "London" },
  HUL: { id: "HUL", name: "Hull City", short: "Hull", city: "Hull" },
  IPS: { id: "IPS", name: "Ipswich Town", short: "Ipswich", city: "Ipswich" },
  LEE: { id: "LEE", name: "Leeds United", short: "Leeds", city: "Leeds" },
  LIV: { id: "LIV", name: "Liverpool", short: "Liverpool", city: "Liverpool" },
  MCI: { id: "MCI", name: "Manchester City", short: "Man City", city: "Manchester" },
  MUN: { id: "MUN", name: "Manchester United", short: "Man Utd", city: "Manchester" },
  NEW: { id: "NEW", name: "Newcastle", short: "Newcastle", city: "Newcastle" },
  NFO: { id: "NFO", name: "Nott'm Forest", short: "Forest", city: "Nottingham" },
  SUN: { id: "SUN", name: "Sunderland", short: "Sunderland", city: "Sunderland" },
  TOT: { id: "TOT", name: "Tottenham", short: "Spurs", city: "London" },
};

export const TEAM_LIST = Object.values(TEAMS);
