import { createHash } from "node:crypto";
import type { ModelFixture } from "../model-data";

export type ClaimPageVerifyOutcome =
  | { ok: true; matchedSnippet: string; contentSha256: string }
  | { ok: false; reason: string };

function normalizeText(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant tokens: multi-word team fragments, capitalized names, numbers. */
export function extractClaimKeyTokens(claim: string, fixture: ModelFixture): string[] {
  const tokens = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim().toLocaleLowerCase();
    if (t.length >= 3) tokens.add(t);
  };
  for (const team of [fixture.home, fixture.away]) {
    for (const part of team.split(/\s+/)) add(part);
    add(team);
  }
  for (const match of claim.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []) add(match.replace(/%$/, ""));
  for (const match of claim.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? []) add(match);
  for (const match of claim.match(/\b[a-z]{4,}\b/gi) ?? []) {
    if (!/^(with|from|that|this|have|will|been|they|their|after|before|match|news|team|game|week|season)$/.test(match)) {
      add(match);
    }
  }
  return [...tokens];
}

export function verifyClaimAgainstPageText(
  claim: string,
  pageText: string,
  fixture: ModelFixture,
): ClaimPageVerifyOutcome {
  const normalizedPage = normalizeText(pageText);
  if (!normalizedPage) return { ok: false, reason: "empty_page_text" };

  const numbersInClaim = [...new Set(claim.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [])]
    .map((num) => num.replace(/%$/, ""))
    .filter((bare) => bare.length >= 2 && !/^20\d{2}$/.test(bare));
  for (const num of numbersInClaim) {
    if (!normalizedPage.includes(num.toLocaleLowerCase())) {
      return { ok: false, reason: `number_not_on_page:${num}` };
    }
  }

  const keys = extractClaimKeyTokens(claim, fixture);
  if (keys.length === 0) return { ok: false, reason: "no_claim_keys" };

  const matched = keys.filter((key) => normalizedPage.includes(key));
  const required = Math.min(3, Math.max(2, Math.ceil(keys.length * 0.35)));
  if (matched.length < required) {
    return { ok: false, reason: `entities_missing:${matched.length}/${required}` };
  }

  const anchor = matched[0]!;
  const idx = normalizedPage.indexOf(anchor);
  const start = Math.max(0, idx - 120);
  const end = Math.min(normalizedPage.length, idx + anchor.length + 200);
  const matchedSnippet = pageText.slice(
    Math.max(0, pageText.toLocaleLowerCase().indexOf(anchor)),
    Math.min(pageText.length, pageText.toLocaleLowerCase().indexOf(anchor) + 320),
  ).trim() || pageText.slice(start, end);

  const contentSha256 = createHash("sha256").update(normalizedPage.slice(start, end)).digest("hex");
  return { ok: true, matchedSnippet: matchedSnippet.slice(0, 480), contentSha256 };
}
