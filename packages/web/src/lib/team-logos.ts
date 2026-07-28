// ─── Team visuals ────────────────────────────────────────────────────────────
//
// Country flags (SVG via flagcdn) for WC-era national teams. Club fixtures use
// neutral monogram initials instead of country flags.

const COUNTRY_FLAG_CODES: Record<string, string> = {
  "Mexico": "mx",
  "South Korea": "kr",
  "South Africa": "za",
  "Czech Republic": "cz",
  "Canada": "ca",
  "Switzerland": "ch",
  "Qatar": "qa",
  "Bosnia": "ba",
  "Scotland": "gb-sct",
  "Morocco": "ma",
  "Brazil": "br",
  "Haiti": "ht",
  "USA": "us",
  "Australia": "au",
  "Turkey": "tr",
  "Paraguay": "py",
  "Germany": "de",
  "Ivory Coast": "ci",
  "Ecuador": "ec",
  "Curacao": "cw",
  "Netherlands": "nl",
  "Sweden": "se",
  "Tunisia": "tn",
  "Japan": "jp",
  "Belgium": "be",
  "Iran": "ir",
  "New Zealand": "nz",
  "Egypt": "eg",
  "Spain": "es",
  "Saudi Arabia": "sa",
  "Uruguay": "uy",
  "Cape Verde": "cv",
  "France": "fr",
  "Senegal": "sn",
  "Iraq": "iq",
  "Norway": "no",
  "Argentina": "ar",
  "Algeria": "dz",
  "Austria": "at",
  "Jordan": "jo",
  "Portugal": "pt",
  "DR Congo": "cd",
  "Uzbekistan": "uz",
  "Colombia": "co",
  "England": "gb-eng",
  "Croatia": "hr",
  "Ghana": "gh",
  "Panama": "pa",
};

const CLUB_COLORS: Record<string, string> = {
  "Arsenal": "#EF0107",
  "Liverpool": "#C8102E",
  "Manchester City": "#6CABDD",
  "Manchester United": "#DA291C",
  "Chelsea": "#034694",
  "Tottenham Hotspur": "#132257",
  "Newcastle United": "#241F20",
  "Aston Villa": "#95BFE5",
  "Brighton & Hove Albion": "#0057B8",
  "West Ham United": "#7A263A",
  "Crystal Palace": "#1B458F",
  "Fulham": "#000000",
  "Brentford": "#E30613",
  "Wolverhampton Wanderers": "#FDB913",
  "Everton": "#003399",
  "Nottingham Forest": "#DD0000",
  "Leicester City": "#003090",
  "Leeds United": "#FFCD00",
  "Coventry City": "#69BE28",
  "Hull City": "#F5A623",
};

function isNationalTeam(name: string): boolean {
  return name in COUNTRY_FLAG_CODES;
}

export function getTeamMonogram(teamName: string | null): string | null {
  if (!teamName || teamName.toLowerCase() === "tbd") return null;
  if (isNationalTeam(teamName)) return null;
  const words = teamName.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

export function getTeamFlagUrl(teamName: string | null): string | null {
  if (!teamName) return null;
  const code = COUNTRY_FLAG_CODES[teamName];
  return code ? `https://flagcdn.com/${code}.svg` : null;
}

export function getTeamColor(teamName: string | null): string {
  if (!teamName) return "#64748B";
  return CLUB_COLORS[teamName] ?? "#64748B";
}
