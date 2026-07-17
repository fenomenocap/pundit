// ─── Country flags (SVG assets via flagcdn) ─────────────────────────────────
//
// Emoji flags render as two-letter codes or blanks on Windows, so flags are
// served as SVG images instead. Codes are flagcdn.com identifiers (ISO 3166-1
// alpha-2, plus gb-eng / gb-sct for the home nations).

const COUNTRY_FLAG_CODES: Record<string, string> = {
  // Group A
  "Mexico": "mx",
  "South Korea": "kr",
  "South Africa": "za",
  "Czech Republic": "cz",
  // Group B
  "Canada": "ca",
  "Switzerland": "ch",
  "Qatar": "qa",
  "Bosnia": "ba",
  // Group C
  "Scotland": "gb-sct",
  "Morocco": "ma",
  "Brazil": "br",
  "Haiti": "ht",
  // Group D
  "USA": "us",
  "Australia": "au",
  "Turkey": "tr",
  "Paraguay": "py",
  // Group E
  "Germany": "de",
  "Ivory Coast": "ci",
  "Ecuador": "ec",
  "Curacao": "cw",
  // Group F
  "Netherlands": "nl",
  "Sweden": "se",
  "Tunisia": "tn",
  "Japan": "jp",
  // Group G
  "Belgium": "be",
  "Iran": "ir",
  "New Zealand": "nz",
  "Egypt": "eg",
  // Group H
  "Spain": "es",
  "Saudi Arabia": "sa",
  "Uruguay": "uy",
  "Cape Verde": "cv",
  // Group I
  "France": "fr",
  "Senegal": "sn",
  "Iraq": "iq",
  "Norway": "no",
  // Group J
  "Argentina": "ar",
  "Algeria": "dz",
  "Austria": "at",
  "Jordan": "jo",
  // Group K
  "Portugal": "pt",
  "DR Congo": "cd",
  "Uzbekistan": "uz",
  "Colombia": "co",
  // Group L
  "England": "gb-eng",
  "Croatia": "hr",
  "Ghana": "gh",
  "Panama": "pa",
};

// Returns an SVG flag URL for a canonical team name, or null for placeholders
// like "TBD" / "Round of 16 Winner".
export function getTeamFlagUrl(teamName: string | null): string | null {
  if (!teamName) return null;
  const code = COUNTRY_FLAG_CODES[teamName];
  return code ? `https://flagcdn.com/${code}.svg` : null;
}

export function getTeamColor(teamName: string | null): string {
  void teamName;
  return "#64748B";
}
