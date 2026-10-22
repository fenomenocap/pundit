/**
 * Chat speaks the same club names as the web (packages/web desk TEAMS[id].name).
 * The API keys clubs by short canonical names ("Man City", "Hull", "Forest");
 * this is the display pass applied once to the delivered answer text on both
 * /api/ask paths. Lookarounds keep names that are already full untouched.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bMan City\b/g, "Manchester City"],
  [/\bMan (?:United|Utd)\b/g, "Manchester United"],
  [/\bHull\b(?! City)/g, "Hull City"],
  [/\bCoventry\b(?! City)/g, "Coventry City"],
  [/\bIpswich\b(?! Town)/g, "Ipswich Town"],
  [/\bLeeds\b(?! United)/g, "Leeds United"],
  [/(?<!Nott'm |Nott’m |Nottingham |Notts )\bForest\b(?! Green)/g, "Nott'm Forest"],
];

export function formalClubNamesInText(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [pattern, name] of RULES) out = out.replace(pattern, name);
  return out;
}

/** Only English-league answers; other competitions keep their own naming. */
export function shouldUseFormalClubNames(grounding: unknown): boolean {
  if (!grounding || typeof grounding !== "object") return true;
  const g = grounding as { kind?: string; competitionId?: string };
  if (g.kind !== "match") return true;
  return typeof g.competitionId === "string" && g.competitionId.startsWith("eng.");
}
