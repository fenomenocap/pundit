import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyScores, type PaperTicket } from "./paper-settlement.ts";

function ticket(id: string, fixtureId: string, market: "home" | "away", price = 2): PaperTicket {
  return { id, legs: [{ fixtureId, market }], stake: 100, price, status: "open", pnl: 0 };
}

describe("applyScores", () => {
  it("settles a retained winning ticket and credits its full return once", () => {
    const original = ticket("win", "settled", "home", 2.5);
    const result = applyScores([original], { settled: [2, 1] }, 900);
    assert.equal(result.tickets[0].status, "won");
    assert.equal(result.tickets[0].pnl, 150);
    assert.equal(result.cash, 1150);

    const repeated = applyScores(result.tickets, { settled: [2, 1] }, result.cash);
    assert.equal(repeated.cash, 1150);
  });

  it("settles a retained losing ticket without crediting cash", () => {
    const result = applyScores([ticket("loss", "settled", "away")], { settled: [2, 1] }, 900);
    assert.equal(result.tickets[0].status, "lost");
    assert.equal(result.tickets[0].pnl, -100);
    assert.equal(result.cash, 900);
  });
});
