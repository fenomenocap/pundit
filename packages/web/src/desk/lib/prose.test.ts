import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDeskShortDate, humaniseDeskCitationDates } from "./prose.ts";

describe("humaniseDeskCitationDates", () => {
  it("turns a citation ISO instant into a short date", () => {
    const raw = "Maresca's side still wait on Jackson "
      + "([Chelsea XI vs Leeds: Predicted lineup and confirmed team news]"
      + "(https://www.standard.co.uk/sport/football/chelsea-xi-vs-leeds-b1296122.html), "
      + "2026-09-09T17:47:51.000Z).";
    const out = humaniseDeskCitationDates(raw);
    assert.equal(out.includes("2026-09-09T17:47:51.000Z"), false);
    assert.equal(out.includes("T17:47:51"), false);
    assert.match(out, /9 Sep\)/);
    assert.match(out, /\]\(https:\/\/www\.standard\.co\.uk/);
  });

  it("unsticks a jammed citation and drops an offset timestamp", () => {
    const out = humaniseDeskCitationDates(
      "just 40% BTTS([City vs Coventry](https://www.sportsmole.co.uk/x), 2026-09-04T15:00:00+01:00).",
    );
    assert.equal(out.includes("+01:00"), false);
    assert.match(out, /BTTS \(\[City vs Coventry\]\(https:\/\/www\.sportsmole\.co\.uk\/x\) · 4 Sep\)/);
  });

  it("leaves ordinary fixture dates in prose alone", () => {
    const prose = "The 2026-09-13 kick-off is still Saturday.";
    assert.equal(humaniseDeskCitationDates(prose), prose);
  });
});

describe("formatDeskShortDate", () => {
  it("reads the UTC calendar day from an ISO instant", () => {
    assert.equal(formatDeskShortDate("2026-09-09T17:47:51.000Z"), "9 Sep");
    assert.equal(formatDeskShortDate("2026-09-04T15:00:00+01:00"), "4 Sep");
  });
});
