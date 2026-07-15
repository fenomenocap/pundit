const RAW_TEAM_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["United States", "USA"],
  ["Korea Republic", "South Korea"],
  ["Republic of Korea", "South Korea"],
  ["Bosnia and Herzegovina", "Bosnia"],
  ["Bosnia-Herzegovina", "Bosnia"],
  ["Bosnia and Herzegov.", "Bosnia"],
  ["Bosnia & Herzegovina", "Bosnia"],
  ["Czechia", "Czech Republic"],
  ["Cote d'Ivoire", "Ivory Coast"],
  ["Côte d'Ivoire", "Ivory Coast"],
  ["Côte D'Ivoire", "Ivory Coast"],
  ["Türkiye", "Turkey"],
  ["Congo DR", "DR Congo"],
  ["Congo, DR", "DR Congo"],
  ["Dem. Rep. Congo", "DR Congo"],
  ["Dem Rep Congo", "DR Congo"],
  ["Democratic Republic of Congo", "DR Congo"],
  ["The Democratic Republic of Congo", "DR Congo"],
  ["Cape Verde Islands", "Cape Verde"],
  ["Cabo Verde", "Cape Verde"],
  ["Curaçao", "Curacao"],
];

export function normalizeTeamText(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const TEAM_ALIASES = new Map(
  RAW_TEAM_ALIASES.map(([alias, canonical]) => [
    normalizeTeamText(alias),
    normalizeTeamText(canonical),
  ])
);

export function normalizeTeamName(name: string): string {
  const normalized = normalizeTeamText(name);
  return TEAM_ALIASES.get(normalized) ?? normalized;
}

export function getTeamNameAliases(): ReadonlyArray<readonly [string, string]> {
  return RAW_TEAM_ALIASES;
}
