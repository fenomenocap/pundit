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

const MANAGER_HOLDER_FROM_CLAIM = /^(.+?)\s+(?:is|remains|continue\s+as|continues\s+as)\s+(?:the\s+)?(?:\w+\s+){0,3}(?:manager|head coach|coach)\b/i;

function surnames(name: string): string[] {
  return name
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .map((p) => p.replace(/[^\p{L}’-]/gu, ""));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function managerPersonNameFromClaim(claim: string): string | null {
  const match = MANAGER_HOLDER_FROM_CLAIM.exec(claim.trim());
  return match?.[1]?.trim() ?? null;
}

function eligibleStructuredManagerName(
  dossier: MatchDossier,
  side: "home" | "away",
): string | null {
  const raw = side === "home"
    ? dossier.manager?.value?.home?.name
    : dossier.manager?.value?.away?.name;
  if (!raw?.trim()) return null;
  const name = managerPersonNameFromClaim(raw) ?? raw.trim();
  const clubLabel = side === "home" ? dossier.fixture.home : dossier.fixture.away;
  const hasEligible = (dossier.evidence ?? []).some((item) =>
    item.category === "manager"
    && takeEligibleDossierEvidence(item)
    && (!clubLabel || item.club === clubLabel || item.claim.includes(name)));
  return hasEligible ? name : null;
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

/** Manager person names established by fresh, fixture-matched dossier evidence. */
export function managerNamesFromVerifiedDossier(dossier: MatchDossier | null): string[] {
  if (!dossier) return [];
  const names: string[] = [];
  for (const item of dossier.evidence ?? []) {
    if (item.category !== "manager" || !takeEligibleDossierEvidence(item)) continue;
    const person = managerPersonNameFromClaim(item.claim);
    if (person) names.push(person);
  }
  const home = eligibleStructuredManagerName(dossier, "home");
  const away = eligibleStructuredManagerName(dossier, "away");
  if (home) names.push(home);
  if (away) names.push(away);
  return [...new Set(names.filter(Boolean))];
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
