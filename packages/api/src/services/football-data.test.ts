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

  it("keeps live scores while a match is in play", () => {
    const match = parseEvent({
      id: "2",
      date: "2026-07-14T19:00Z",
      season: { slug: "semifinals" },
      competitions: [{
        status: { type: { state: "in", completed: false } },
        competitors: [
          { homeAway: "home", team: { displayName: "England" }, score: "2", winner: false },
          { homeAway: "away", team: { displayName: "France" }, score: "1", winner: false },
        ],
      }],
    });
    expect(match).toMatchObject({
      status: "IN_PLAY",
      score: { home: 2, away: 1 },
      winner: null,
    });
  });
});
