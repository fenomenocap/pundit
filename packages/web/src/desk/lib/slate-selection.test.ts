import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capturedRecord, reconcileHydratedPaperState, resolveHydratedSelection } from "./slate-selection.ts";

describe("resolveHydratedSelection", () => {
  it("keeps a persisted fixture only while it belongs to the hydrated slate", () => {
    const open = [{ id: "espn:eng.1:1", home: "ARS", away: "CHE" }];
    assert.equal(resolveHydratedSelection("espn:eng.1:1", open, []), "espn:eng.1:1");
  });

  it("clears a stale fixture when the live slate has no matching or banker fixture", () => {
    const open = [{ id: "espn:eng.1:2", home: "ARS", away: "CHE" }];
    assert.equal(resolveHydratedSelection("gw4-mun-mci", open, []), "");
  });

  it("does not auto-pin a banker for a general first question", () => {
    const open = [{ id: "espn:eng.1:3", home: "LIV", away: "FUL" }];
    assert.equal(resolveHydratedSelection("gw4-mun-mci", open, []), "");
  });
});

describe("hydrated slate truth", () => {
  it("removes invisible slip legs, tickets and scores", () => {
    const open = [{ id: "live", home: "ARS", away: "CHE" }];
    const state = reconcileHydratedPaperState(
      [{ fixtureId: "live", market: "home" }, { fixtureId: "stale", market: "away" }],
      [
        { id: "kept", legs: [{ fixtureId: "live" }] },
        { id: "removed", legs: [{ fixtureId: "stale" }] },
      ],
      { live: [1, 0], stale: [3, 3] },
      open,
      [],
    );
    assert.deepEqual(state.slip.map((leg) => leg.fixtureId), ["live"]);
    assert.deepEqual(state.tickets.map((ticket) => ticket.id), ["kept"]);
    assert.deepEqual(state.removedTickets.map((ticket) => ticket.id), ["removed"]);
    assert.deepEqual(state.scores, { live: [1, 0] });
  });

  it("excludes results without captured outcomes from the record denominator", () => {
    assert.deepEqual(capturedRecord([{ modelHit: true }, { modelHit: false }, {}]), {
      hits: 1,
      n: 2,
      pct: 0.5,
    });
    assert.deepEqual(capturedRecord([{}]), { hits: 0, n: 0, pct: null });
  });
});
