import { describe, expect, it } from "vitest";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { buildPunditTakePlan } from "./take-plan";
import { applyV2TakeProseGuards, sentenceMakesUnsupportedStyleClaim } from "./take-number-check";
import { postCheckTakeProse } from "./take-validate";
import type { PunditTakePlan } from "./types";

const NOW = new Date("2026-10-18T10:00:00.000Z");

function arsenalEvertonTotalsPlan(): PunditTakePlan {
  const grounding = {
    ...chelseaTottenhamGrounding(),
    home: "Arsenal",
    away: "Everton",
    pOver2_5: 0.5042,
    pUnder2_5: 0.4958,
  };
  return buildPunditTakePlan(grounding, null, { marketKind: "totals", now: NOW });
}

/** Exact sentence from the 1c4a554 prod re-ask (triage/totals-value-fix/reask-1c4a554-ou25.json). */
const PROD_STYLE_SENTENCE =
  "The risk is that Everton’s low block can frustrate Arsenal for long stretches, and if the first hour stays goalless, the over could slip away.";

const PROD_PROSE = [
  "Arsenal v Everton — Over 2.5 at 50%.",
  // Prod form sentence minus its counts (the test fixture's form numbers differ, and the numeric guard would drop them).
  "I expect close to three goals in this one, and the recent form backs that up.",
  PROD_STYLE_SENTENCE,
  "I'd shift if the first hour stays goalless.",
].join(" ");

describe("unsupported tactical / team-style claims are dropped", () => {
  it("drops the exact prod low-block sentence and keeps the rest of the answer", () => {
    const plan = arsenalEvertonTotalsPlan();
    expect(sentenceMakesUnsupportedStyleClaim(PROD_STYLE_SENTENCE, plan)).toBe(true);
    const out = applyV2TakeProseGuards(PROD_PROSE, plan);
    expect(out).not.toMatch(/low block/i);
    expect(out).toMatch(/^Arsenal v Everton — Over 2\.5 at 50%\./);
    expect(out).toMatch(/I expect close to three goals in this one, and the recent form backs that up\./);
    expect(out).toMatch(/I'd shift if the first hour stays goalless\.$/);
  });

  it("full post-check also drops it", () => {
    const out = postCheckTakeProse(PROD_PROSE, arsenalEvertonTotalsPlan());
    expect(out).not.toMatch(/low block/i);
    expect(out).toMatch(/^Arsenal v Everton — Over 2\.5 at 50%\./);
  });

  it.each([
    "Spurs press high and will push Chelsea back with a high press.",
    "Chelsea are dangerous on the counter.",
    "Expect Spurs to park the bus once they score.",
    "Chelsea's possession-heavy approach should wear Spurs down.",
    "Spurs carry a real set-piece threat.",
    "Everton sit deep and invite pressure.",
  ])("lexicon hit with no supporting fact is dropped: %s", (sentence) => {
    expect(sentenceMakesUnsupportedStyleClaim(sentence, arsenalEvertonTotalsPlan())).toBe(true);
  });

  it("a style sentence survives when a plan seed states the same fact", () => {
    const base = arsenalEvertonTotalsPlan();
    const plan: PunditTakePlan = {
      ...base,
      supporting: [
        ...base.supporting,
        { id: "test-style", role: "support", text: "Everton have defended in a low block in recent away games." },
      ],
    };
    expect(sentenceMakesUnsupportedStyleClaim(PROD_STYLE_SENTENCE, plan)).toBe(false);
  });

  it.each([
    "I'd shift if the first hour stays goalless.",
    "The risk is that an early goal changes the game.",
    "If Everton score first, the over could slip away.",
    "Arsenal to edge it.",
    "Both sides have conceded freely on the road.",
    "A red card or a quiet first half would change the read.",
  ])("generic risk line with no team-style assertion survives: %s", (sentence) => {
    expect(sentenceMakesUnsupportedStyleClaim(sentence, arsenalEvertonTotalsPlan())).toBe(false);
  });
});
