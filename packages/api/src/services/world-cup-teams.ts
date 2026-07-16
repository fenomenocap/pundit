export const WORLD_CUP_GROUPS: Readonly<Record<string, readonly string[]>> = {
  A: ["Mexico", "South Korea", "South Africa", "Czech Republic"],
  B: ["Canada", "Switzerland", "Qatar", "Bosnia"],
  C: ["Scotland", "Morocco", "Brazil", "Haiti"],
  D: ["USA", "Australia", "Turkey", "Paraguay"],
  E: ["Germany", "Ivory Coast", "Ecuador", "Curacao"],
  F: ["Netherlands", "Sweden", "Tunisia", "Japan"],
  G: ["Belgium", "Iran", "New Zealand", "Egypt"],
  H: ["Spain", "Saudi Arabia", "Uruguay", "Cape Verde"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};

export const WORLD_CUP_TEAMS = Object.values(WORLD_CUP_GROUPS).flat();
export const WORLD_CUP_TEAM_SET = new Set(WORLD_CUP_TEAMS);
export const TEAM_TO_GROUP = new Map(
  Object.entries(WORLD_CUP_GROUPS).flatMap(([group, teams]) =>
    teams.map((team) => [team, group] as const)
  )
);
