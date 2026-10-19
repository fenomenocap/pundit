/** User-facing answers must never echo desk/agent prompt section labels. */
export const INTERNAL_PROMPT_LEAK_REPLACEMENT =
  "I don't have verified team news for this fixture in this turn, so I'll stick to the priced strength read above.";

const LEAK_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /The SEARCH EVIDENCE contains no news for this fixture[^\n]*/gi,
    replacement: INTERNAL_PROMPT_LEAK_REPLACEMENT,
  },
  {
    pattern: /The SEARCH EVIDENCE contains no news[^\n]*/gi,
    replacement: INTERNAL_PROMPT_LEAK_REPLACEMENT,
  },
  {
    pattern: /\bSEARCH EVIDENCE contains no news[^\n]*/gi,
    replacement: INTERNAL_PROMPT_LEAK_REPLACEMENT,
  },
  {
    pattern: /Based solely on supplied SEARCH EVIDENCE:[^\n]*/gi,
    replacement: "",
  },
  {
    pattern: /^\s*SEARCH EVIDENCE:\s*none this turn[^\n]*\n?/gim,
    replacement: "",
  },
  {
    pattern: /^\s*SEARCH EVIDENCE \(this turn only[^\n]*\n?/gim,
    replacement: "",
  },
  {
    pattern: /The evidence contains no current-world facts about this fixture[^\n]*/gi,
    replacement: INTERNAL_PROMPT_LEAK_REPLACEMENT,
  },
  {
    pattern: /\bevidence contains no current-world facts\b[^\n]*/gi,
    replacement: INTERNAL_PROMPT_LEAK_REPLACEMENT,
  },
];

export function stripInternalPromptVocabulary(text: string): string {
  let out = text;
  for (const { pattern, replacement } of LEAK_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  if (/\bSEARCH EVIDENCE\b/i.test(out)) {
    out = out.replace(/\bSEARCH EVIDENCE\b/gi, "verified sources");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function containsInternalPromptVocabulary(text: string): boolean {
  return /\bSEARCH EVIDENCE\b/i.test(text)
    || /Based solely on supplied SEARCH EVIDENCE/i.test(text);
}
