import type { MatchDossier } from "./match-dossier/types";
import { takeEligibleDossierEvidence } from "./pundit-take/take-dossier-evidence";

/**
 * Memory firewall, not a fact source.
 *
 * MiniMax will recite last year's coaches. These names are stripped from desk
 * prose unless this turn's search evidence established them. They are not a
 * current dugout and must never be treated as one.
 */
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Stale-list names this turn's search titles/snippets actually established. */
export function managersNamedInEvidence(
  results: readonly { title: string; snippet: string }[],
  dossier: MatchDossier | null = null,
): string[] {
  const blob = results.map((row) => `${row.title} ${row.snippet}`).join("\n");
  const fromSearch = STALE_MANAGER_NAMES.filter((name) =>
    new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(blob)
  );
  return [...new Set([...fromSearch, ...managerNamesFromVerifiedDossier(dossier)])];
}

/** Manager names established by page-verified dossier evidence or structured manager slots. */
export function managerNamesFromVerifiedDossier(dossier: MatchDossier | null): string[] {
  if (!dossier) return [];
  const names: string[] = [];
  for (const item of dossier.evidence ?? []) {
    if (item.category !== "manager" || !takeEligibleDossierEvidence(item)) continue;
    names.push(item.claim);
  }
  const home = dossier.manager?.value?.home?.name;
  const away = dossier.manager?.value?.away?.name;
  if (home) names.push(home);
  if (away) names.push(away);
  return names.filter(Boolean);
}

export function stripUnlistedManagers(text: string, allowed: readonly string[]): string {
  const allow = new Set(allowed.flatMap(surnames).map((s) => s.toLocaleLowerCase()));
  const stale = STALE_MANAGER_NAMES.filter((n) => {
    const last = n.split(/\s+/).at(-1)!.toLocaleLowerCase();
    return !allow.has(last);
  });
  if (stale.length === 0) return text;
  const re = new RegExp(`\\b(?:${stale.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !re.test(sentence));
  return kept.join(" ").replace(/\n{3,}/g, "\n\n").trim();
}
