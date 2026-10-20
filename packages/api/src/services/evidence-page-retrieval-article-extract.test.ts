import { describe, expect, it, vi } from "vitest";
import {
  retrieveEvidencePages,
  type EvidencePageCandidate,
} from "./evidence-page-retrieval";

/** Recorded HTML fixture (chat team-news / manager verification shape). */
const RECORDED_PUBLISHER_HTML =
  "<nav><div>Football menu</div></nav><article><h1>Arsenal update</h1>"
  + "<p>Mikel Arteta is Arsenal’s manager.</p><p>A false report claimed:</p>"
  + "<blockquote>Arsene Wenger has agreed a new contract as Arsenal manager.</blockquote></article>";

/** Byte-identical to main-branch plainTextFromPage() on this HTML (nav included; no Readability). */
const LEGACY_EXPECTED_TEXT =
  "Football menu\n\nArsenal update\n\nMikel Arteta is Arsenal’s manager.\n\nA false report claimed:\n\n"
  + "“Arsene Wenger has agreed a new contract as Arsenal manager.”";

const NAV_PLUS_ARTICLE_HTML =
  "<html><body>BBC Homepage Skip to content Home News Sport"
  + "<article><h1>Team news</h1><p>Striker Kai Havertz is doubtful for Arsenal with a hamstring issue before the weekend.</p></article></body></html>";

const candidate: EvidencePageCandidate = {
  id: "legacy-golden",
  url: "https://www.premierleague.com/news/legacy-golden",
  title: "Official",
  date: "2026-08-13",
  authority: "official",
};

const publicResolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("evidence page retrieval articleBodyExtract opt-in", () => {
  it("default path returns byte-identical legacy plain text for recorded HTML", async () => {
    const pages = await retrieveEvidencePages([candidate], undefined, {
      fetch: async () => new Response(RECORDED_PUBLISHER_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      resolveHost: publicResolver,
      now: () => new Date("2026-10-06T19:00:00Z"),
    });
    expect(pages[0]?.text).toBe(LEGACY_EXPECTED_TEXT);
    expect(pages[0]?.articleHeadline).toBeUndefined();
  });

  it("articleBodyExtract returns article body without surrounding nav chrome", async () => {
    const pages = await retrieveEvidencePages([{
      ...candidate,
      id: "article-mode",
      url: "https://www.bbc.co.uk/sport/football/article-extract-test",
    }], undefined, {
      articleBodyExtract: true,
      fetch: async () => new Response(NAV_PLUS_ARTICLE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      resolveHost: publicResolver,
      now: () => new Date("2026-10-19T12:00:00Z"),
    });
    expect(pages[0]?.text).toMatch(/Kai Havertz is doubtful/i);
    expect(pages[0]?.text).not.toMatch(/BBC Homepage/i);
    expect(pages[0]?.articleHeadline).toBeTruthy();
  });
});
