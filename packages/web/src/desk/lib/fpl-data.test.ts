import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapBootstrap } from "./fpl-data.ts";

describe("FPL bootstrap mapping", () => {
  it("maps positions, clubs and prices, and keeps missing prices null", () => {
    const out = mapBootstrap({
      events: [{ id: 7, is_current: true }, { id: 8, is_next: true }],
      teams: [{ id: 1, short_name: "ARS", name: "Arsenal" }],
      elements: [
        { id: 10, web_name: "Raya", element_type: 1, team: 1, now_cost: 55, status: "a", form: "4.5" },
        { id: 11, web_name: "NoPrice", element_type: 3, team: 1, status: "d", chance_of_playing_next_round: 50 },
        { id: 12, web_name: "BadTeam", element_type: 4, team: 99, now_cost: 70 },
        { id: 13, web_name: "Manager", element_type: 5, team: 1, now_cost: 10 },
      ],
    }, "2026-10-22T15:00:00.000Z");
    assert.equal(out.gameweek, 8);
    assert.equal(out.players.length, 2);
    assert.deepEqual(out.players[0], {
      id: 10, name: "Raya", club: "ARS", clubName: "Arsenal", pos: "GK", price: 5.5, status: "a",
      chanceNextRound: null, news: null, totalPoints: null, form: 4.5, selectedByPercent: null,
    });
    assert.equal(out.players[1].price, null);
    assert.equal(out.players[1].chanceNextRound, 50);
  });
});
