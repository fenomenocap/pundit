import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareTakeV2DeskMarkdown } from "./prepare-take-v2-desk-markdown.ts";

const FIXTURE = `Spurs v Coventry — Spurs at 59.9%.

| Outcome | Ours |
| --- | --- |
| Home | 60% |

Model unknown (priced 18 Oct 17:30 SGT).
Kalshi as of 18 Oct 12:00 SGT.`;

describe("prepareTakeV2DeskMarkdown", () => {
  it("splits footer source lines into separate markdown paragraphs", () => {
    const out = prepareTakeV2DeskMarkdown(FIXTURE);
    assert.match(out, /Model unknown \(priced 18 Oct 17:30 SGT\)\.\n\nKalshi as of/);
  });
});
