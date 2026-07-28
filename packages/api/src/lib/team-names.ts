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

const RAW_CLUB_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["Manchester United", "Man United"],
  ["Manchester City", "Man City"],
  ["Tottenham Hotspur", "Tottenham"],
  ["Brighton & Hove Albion", "Brighton"],
  ["Brighton and Hove Albion", "Brighton"],
  ["Wolverhampton Wanderers", "Wolves"],
  ["Nottingham Forest", "Forest"],
  ["West Ham United", "West Ham"],
  ["Newcastle United", "Newcastle"],
  ["Leeds United", "Leeds"],
  ["Leicester City", "Leicester"],
  ["AFC Bournemouth", "Bournemouth"],
  ["Paris Saint-Germain", "Paris SG"],
  ["PSG", "Paris SG"],
  ["Inter Milan", "Inter"],
  ["Internazionale", "Inter"],
  ["Bayern Munich", "Bayern"],
  ["Borussia Dortmund", "Dortmund"],
  ["Borussia Mönchengladbach", "Gladbach"],
  ["Borussia Monchengladbach", "Gladbach"],
  ["Atletico Madrid", "Ath Madrid"],
  ["Atlético Madrid", "Ath Madrid"],
  ["Athletic Club", "Ath Bilbao"],
  ["Real Betis", "Betis"],
  ["Sporting CP", "Sporting"],
  ["Sporting Lisbon", "Sporting"],
  ["Coventry City", "Coventry"],
  ["Hull City", "Hull"],
  ["Ipswich Town", "Ipswich"],
  ["Sunderland", "Sunderland"],
  ["KuPS Kuopio", "Kuopio"],
  ["Sabah FK", "Sabah"],
  ["Lincoln Red Imps", "Lincoln"],
  ["Mjällby AIF", "Mjaellby"],
  ["FC Thun", "Thun"],
  ["NK Celje", "Celje"],
  ["Heart of Midlothian", "Hearts"],
  ["SK Sturm Graz", "Sturm Graz"],
  ["Shamrock Rovers", "Shamrock"],
  ["Kairat Almaty", "Kairat"],
  ["Omonia Nicosia", "Omonia"],
  ["KI Klaksvik", "Klaksvik"],
  ["Lech Poznan", "Lech"],
  ["AGF", "Aarhus"],
  ["CSU Craiova", "Craiova"],
  ["Levski Sofia", "Levski"],
  ["Hapoel Be'er", "Beer-Sheva"],
  ["Vikingur Reykjavik", "Vikingur"],
  ["Gornik Zabrze", "Gornik"],
  ["Red Star Belgrade", "Crvena Zvezda"],
  ["Iberia 1999", "Saburtalo"],
  ["Riga FC", "Riga"],
  ["Ararat-Armenia", "Ararat"],
];

export function normalizeTeamText(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const TEAM_ALIASES = new Map(
  [...RAW_TEAM_ALIASES, ...RAW_CLUB_ALIASES].map(([alias, canonical]) => [
    normalizeTeamText(alias),
    normalizeTeamText(canonical),
  ])
);

const CANONICAL_TEAM_NAMES = new Map(
  [...RAW_TEAM_ALIASES, ...RAW_CLUB_ALIASES].map(([, canonical]) => [
    normalizeTeamText(canonical),
    canonical,
  ])
);

const CANONICAL_CLUB_NAMES = new Map(
  RAW_CLUB_ALIASES.map(([, canonical]) => [normalizeTeamText(canonical), canonical])
);

export function normalizeTeamName(name: string): string {
  const normalized = normalizeTeamText(name);
  return TEAM_ALIASES.get(normalized) ?? normalized;
}

export function canonicalTeamName(name: string): string {
  const normalized = normalizeTeamName(name);
  return CANONICAL_TEAM_NAMES.get(normalized) ?? name.trim();
}

export function canonicalClubName(name: string): string {
  const normalized = normalizeTeamName(name);
  return CANONICAL_CLUB_NAMES.get(normalized)
    ?? CANONICAL_TEAM_NAMES.get(normalized)
    ?? name.trim();
}

export function getTeamNameAliases(): ReadonlyArray<readonly [string, string]> {
  return [...RAW_TEAM_ALIASES, ...RAW_CLUB_ALIASES];
}

export function normalizedTeamPairKey(teamA: string, teamB: string): string {
  return [normalizeTeamName(teamA), normalizeTeamName(teamB)].sort().join("::");
}

export function modelFixtureKey(competitionId: string, date: string, home: string, away: string): string {
  return `${competitionId}::${date}::${normalizedTeamPairKey(home, away)}`;
}
