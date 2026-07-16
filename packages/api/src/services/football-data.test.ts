import { describe, expect, it } from "vitest";
import { parseEvent } from "./football-data";

describe("ESPN model inputs", () => {
  it("carries ESPN's authoritative penalty winner and canonical team names", () => {
    const match = parseEvent({
      id: "1",
      date: "2026-07-01T19:00Z",
      season: { slug: "round-of-32" },
      competitions: [{
        status: { type: { state: "post", completed: true } },
        competitors: [
          { homeAway: "home", team: { displayName: "Türkiye" }, score: "1", winner: false },
          { homeAway: "away", team: { displayName: "United States" }, score: "1", winner: true },
        ],
      }],
    });
    expect(match).toMatchObject({
      homeTeam: "Turkey",
      awayTeam: "USA",
      stage: "round-of-32",
      score: { home: 1, away: 1 },
      winner: "USA",
    });
  });
});
