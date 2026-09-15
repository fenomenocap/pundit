import { describe, expect, it } from "vitest";
import { evidenceAuthority, evidenceTier } from "./evidence-authority";

describe("evidence authority tiers", () => {
  it("classifies official competition and club domains", () => {
    expect(evidenceTier("https://www.uefa.com/story")).toBe("official");
    expect(evidenceTier("https://www.arsenal.com/news/team-update")).toBe("official");
    expect(evidenceAuthority("https://www.uefa.com/story")).toBe("official");
    expect(evidenceAuthority("https://www.arsenal.com/news/team-update")).toBe("official");
  });

  it("classifies analytics and structured-data domains", () => {
    for (const url of [
      "https://fbref.com/en/squads/abc123/2025-2026/c/all",
      "https://theanalyst.com/articles/preview",
      "https://www.whoscored.com/Teams/123",
      "https://www.fotmob.com/matches/123",
      "https://www.sofascore.com/match/123",
      "https://www.transfermarkt.com/spieler/123",
      "https://footystats.org/england/premier-league",
      "https://www.statbunker.com/competitions",
      "https://www.oddschecker.com/football",
      "https://www.oddsportal.com/match/123",
      "https://www.flashscore.com/match/123",
    ]) {
      expect(evidenceTier(url)).toBe("analytics");
      expect(evidenceAuthority(url)).toBe("reputable");
    }
  });

  it("classifies news publishers separately from analytics", () => {
    expect(evidenceTier("https://www.reuters.com/story")).toBe("news");
    expect(evidenceTier("https://www.skysports.com/football/news")).toBe("news");
    expect(evidenceAuthority("https://www.reuters.com/story")).toBe("reputable");
    expect(evidenceAuthority("https://www.skysports.com/football/news")).toBe("reputable");
  });

  it("does not promote unknown search domains", () => {
    expect(evidenceTier("https://football-rumours.example/story")).toBe("other");
    expect(evidenceAuthority("https://football-rumours.example/story")).toBe("other");
    expect(evidenceTier("not-a-url")).toBe("other");
    expect(evidenceAuthority("not-a-url")).toBe("other");
  });
});
