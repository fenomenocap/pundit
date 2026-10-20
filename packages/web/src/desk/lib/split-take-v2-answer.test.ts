import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitTakeV2AnswerBodyAndFooter } from "./split-take-v2-answer.ts";

describe("splitTakeV2AnswerBodyAndFooter", () => {
  it("separates table body from Model footer lines", () => {
    const answer = "Spurs — Over 2.5 at 55%.\n\n| Outcome | Ours |\n| --- | --- |\n| Over | 55% |\n\nModel unknown (priced 18 Oct 17:30 SGT).\nKalshi as of 18 Oct 12:00 SGT.";
    const { body, footerLines } = splitTakeV2AnswerBodyAndFooter(answer);
    assert.match(body, /\| Outcome \| Ours \|/);
    assert.equal(footerLines.length, 2);
    assert.match(footerLines[0]!, /^Model unknown/);
  });
});
