import { normalizeTeamName, normalizeTeamText } from "../lib/team-names";

/**
 * Sealed 2026/27 Premier League dugout, read off premierleague.com/managers
 * on 8 Sep 2026. Desk voice has no live manager feed; MiniMax will otherwise
 * recite last year's coaches (Amorim, Guardiola, Slot).
 */
export const PL_MANAGERS_AS_OF = "2026-09-08";

export type ClubManager = {
  club: string;
  manager: string;
  since: string;
};

export const PL_MANAGERS: readonly ClubManager[] = [
  { club: "Arsenal", manager: "Mikel Arteta", since: "2019-12-22" },
  { club: "Aston Villa", manager: "Unai Emery", since: "2022-11-01" },
  { club: "Bournemouth", manager: "Marco Rose", since: "2026-06-01" },
  { club: "Brentford", manager: "Keith Andrews", since: "2025-06-27" },
  { club: "Brighton", manager: "Fabian Hurzeler", since: "2024-06-15" },
  { club: "Chelsea", manager: "Xabi Alonso", since: "2026-07-01" },
  { club: "Coventry", manager: "Frank Lampard", since: "2024-11-28" },
  { club: "Crystal Palace", manager: "Pierre Sage", since: "2026-06-15" },
  { club: "Everton", manager: "David Moyes", since: "2025-01-11" },
  { club: "Fulham", manager: "Alvaro Arbeloa", since: "2026-07-07" },
  { club: "Hull", manager: "Sergej Jakirovic", since: "2025-06-11" },
  { club: "Ipswich", manager: "Gary O'Neil", since: "2026-06-23" },
  { club: "Leeds", manager: "Daniel Farke", since: "2023-07-04" },
  { club: "Liverpool", manager: "Andoni Iraola", since: "2026-06-04" },
  { club: "Man City", manager: "Enzo Maresca", since: "2026-06-29" },
  { club: "Man United", manager: "Michael Carrick", since: "2026-01-13" },
  { club: "Newcastle", manager: "Matthias Jaissle", since: "2026-08-05" },
  { club: "Forest", manager: "Oliver Glasner", since: "2026-07-06" },
  { club: "Sunderland", manager: "Regis Le Bris", since: "2024-07-01" },
  { club: "Tottenham", manager: "Roberto De Zerbi", since: "2026-03-31" },
];

const EXTRA_KEYS: Record<string, string> = {
  "man utd": "Man United",
  "manchester united": "Man United",
  "manchester city": "Man City",
  "spurs": "Tottenham",
  "tottenham hotspur": "Tottenham",
  "nottingham forest": "Forest",
  "nottm forest": "Forest",
  "brighton and hove albion": "Brighton",
  "brighton & hove albion": "Brighton",
  "afc bournemouth": "Bournemouth",
  "west ham united": "West Ham",
  "newcastle united": "Newcastle",
  "leeds united": "Leeds",
  "hull city": "Hull",
  "coventry city": "Coventry",
  "ipswich town": "Ipswich",
};

const INDEX = new Map<string, ClubManager>();
for (const row of PL_MANAGERS) {
  INDEX.set(normalizeTeamName(row.club), row);
  INDEX.set(normalizeTeamText(row.club), row);
}
for (const [alias, club] of Object.entries(EXTRA_KEYS)) {
  const row = INDEX.get(normalizeTeamName(club));
  if (row) INDEX.set(alias, row);
}

export function managerForClub(club: string): ClubManager | null {
  const hit =
    INDEX.get(normalizeTeamName(club)) ??
    INDEX.get(normalizeTeamText(club));
  return hit ?? null;
}

/** Recent Premier League coaches MiniMax still treats as current. */
export const STALE_MANAGER_NAMES = [
  "Amorim",
  "Guardiola",
  "Slot",
  "ten Hag",
  "Ten Hag",
  "Postecoglou",
  "Klopp",
  "Pochettino",
  "Conte",
  "Tuchel",
  "Potter",
  "Ten Hag",
  "Erik ten Hag",
  "Arne Slot",
  "Ruben Amorim",
  "Rúben Amorim",
  "Pep Guardiola",
] as const;

function surnames(name: string): string[] {
  return name
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .map((p) => p.replace(/[^\p{L}’-]/gu, ""));
}

export function stripUnlistedManagers(text: string, allowed: readonly string[]): string {
  const allow = new Set(allowed.flatMap(surnames).map((s) => s.toLocaleLowerCase()));
  const stale = STALE_MANAGER_NAMES.filter((n) => !allow.has(n.split(/\s+/).at(-1)!.toLocaleLowerCase()));
  if (stale.length === 0) return text;
  const re = new RegExp(`\\b(?:${stale.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !re.test(sentence));
  return kept.join(" ").replace(/\n{3,}/g, "\n\n").trim();
}
