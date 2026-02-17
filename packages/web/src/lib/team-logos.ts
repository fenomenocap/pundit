// ─── Club & Country logos (emoji + short code mapping) ─────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  "England": "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F",
  "Brazil": "\uD83C\uDDE7\uD83C\uDDF7",
  "Germany": "\uD83C\uDDE9\uD83C\uDDEA",
  "France": "\uD83C\uDDEB\uD83C\uDDF7",
  "Argentina": "\uD83C\uDDE6\uD83C\uDDF7",
  "Spain": "\uD83C\uDDEA\uD83C\uDDF8",
  "Portugal": "\uD83C\uDDF5\uD83C\uDDF9",
  "Netherlands": "\uD83C\uDDF3\uD83C\uDDF1",
  "Italy": "\uD83C\uDDEE\uD83C\uDDF9",
  "Belgium": "\uD83C\uDDE7\uD83C\uDDEA",
  "Croatia": "\uD83C\uDDED\uD83C\uDDF7",
  "Uruguay": "\uD83C\uDDFA\uD83C\uDDFE",
  "Mexico": "\uD83C\uDDF2\uD83C\uDDFD",
  "USA": "\uD83C\uDDFA\uD83C\uDDF8",
  "Japan": "\uD83C\uDDEF\uD83C\uDDF5",
  "South Korea": "\uD83C\uDDF0\uD83C\uDDF7",
};

// Club crests - using unicode football + color indicator
const CLUB_CRESTS: Record<string, { emoji: string; color: string }> = {
  "Arsenal": { emoji: "\uD83D\uDD34", color: "#EF4444" },
  "Liverpool": { emoji: "\uD83D\uDD34", color: "#DC2626" },
  "Manchester City": { emoji: "\uD83D\uDD35", color: "#38BDF8" },
  "Chelsea": { emoji: "\uD83D\uDD35", color: "#3B82F6" },
  "Manchester United": { emoji: "\uD83D\uDD34", color: "#EF4444" },
  "Tottenham": { emoji: "\u26AA", color: "#E2E8F0" },
  "Newcastle": { emoji: "\u26AB", color: "#64748B" },
  "Aston Villa": { emoji: "\uD83D\uDFE3", color: "#7C3AED" },
  "West Ham": { emoji: "\uD83D\uDFE4", color: "#92400E" },
  "Brighton": { emoji: "\uD83D\uDD35", color: "#06B6D4" },
  "Barcelona": { emoji: "\uD83D\uDD35", color: "#A855F7" },
  "Real Madrid": { emoji: "\u26AA", color: "#E2E8F0" },
  "Atletico Madrid": { emoji: "\uD83D\uDD34", color: "#EF4444" },
  "Sevilla": { emoji: "\u26AA", color: "#E2E8F0" },
  "Real Sociedad": { emoji: "\uD83D\uDD35", color: "#3B82F6" },
  "Bayern Munich": { emoji: "\uD83D\uDD34", color: "#DC2626" },
  "PSG": { emoji: "\uD83D\uDD35", color: "#1D4ED8" },
  "Juventus": { emoji: "\u26AB", color: "#64748B" },
  "Inter Milan": { emoji: "\uD83D\uDD35", color: "#1D4ED8" },
  "AC Milan": { emoji: "\uD83D\uDD34", color: "#DC2626" },
};

export function getTeamLogo(teamName: string | null): string | null {
  if (!teamName) return null;
  // Check country first
  if (COUNTRY_FLAGS[teamName]) return COUNTRY_FLAGS[teamName];
  // Check club
  if (CLUB_CRESTS[teamName]) return CLUB_CRESTS[teamName].emoji;
  return null;
}

export function getTeamColor(teamName: string | null): string {
  if (!teamName) return "#64748B";
  if (CLUB_CRESTS[teamName]) return CLUB_CRESTS[teamName].color;
  return "#64748B";
}

export function getTeamFlag(teamName: string | null): string | null {
  if (!teamName) return null;
  return COUNTRY_FLAGS[teamName] || null;
}
