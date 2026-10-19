import { describe, expect, it } from "vitest";
import {
  INTERNAL_PROMPT_LEAK_REPLACEMENT,
  stripInternalPromptVocabulary,
} from "./internal-prompt-vocabulary";

describe("stripInternalPromptVocabulary", () => {
  it("replaces the production Why? leak sentence", () => {
    const leaked = "The SEARCH EVIDENCE contains no news for this fixture, so I cannot explain further.";
    expect(stripInternalPromptVocabulary(leaked)).toBe(INTERNAL_PROMPT_LEAK_REPLACEMENT);
  });

  it("strips Based solely on supplied SEARCH EVIDENCE preambles", () => {
    expect(stripInternalPromptVocabulary(
      "Based solely on supplied SEARCH EVIDENCE: nothing useful.\nArsenal are favoured at 56.3%.",
    )).toBe("Arsenal are favoured at 56.3%.");
  });

});
