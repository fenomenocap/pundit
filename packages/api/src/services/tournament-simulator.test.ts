import { describe, expect, it } from "vitest";
import {
  MONTE_CARLO_RUNS,
  realKnockoutState,
  runMonteCarlo,
  seedBracket,
  simulateKnockout,
} from "./tournament-simulator";
import { WORLD_CUP_GROUPS, WORLD_CUP_TEAMS } from "./world-cup-teams";

describe("local tournament simulation", () => {
  it("retains the 100,000-run production contract and high-low seeding", () => {
    expect(MONTE_CARLO_RUNS).toBe(100_000);
    const teams = Array.from({ length: 32 }, (_, index) => `Team ${index}`);
    const elo = new Map(teams.map((team, index) => [team, 2000 - index]));
    expect(seedBracket(teams, elo).slice(0, 4)).toEqual([
      "Team 0", "Team 31", "Team 1", "Team 30",
    ]);
  });

  it("uses authoritative winners, including tied-score penalty results", () => {
    const state = realKnockoutState([{
      home: "A",
      away: "B",
      stage: "round_of_32",
      result: { winner: "B" },
    }]);
    expect(state.decided.get("A::B")).toBe("B");
  });

  it("advances resolved semifinal winners into a locally generated final", () => {
    const teams = Array.from({ length: 32 }, (_, index) => `Team ${index}`);
    const elo = new Map(teams.map((team) => [team, 1500]));
    const stages = ["round_of_32", "round_of_16", "quarterfinals", "semifinals"];
    const pairings = new Map<string, Array<[string, string]>>();
    const decided = new Map<string, string>();
    let current = teams;
    for (const stage of stages) {
      const pairs = Array.from({ length: current.length / 2 }, (_, index) =>
        [current[index * 2], current[index * 2 + 1]] as [string, string]
      );
      pairings.set(stage, pairs);
      current = pairs.map(([home, away]) => {
        decided.set([home, away].sort().join("::"), home);
        return home;
      });
    }
    const result = simulateKnockout(teams, elo, pairings, decided, () => 0.25);
    expect(current).toHaveLength(2);
    expect(current).toContain(result.champion);
  });

  it("returns a complete probability table in a small real-group run", () => {
    const elo = new Map(WORLD_CUP_TEAMS.map((team) => [team, 1500]));
    const standings = Object.fromEntries(Object.entries(WORLD_CUP_GROUPS).map(([group, teams]) => [
      group,
      Object.fromEntries(teams.map((team, index) => [team, {
        pts: 9 - index,
        gd: 3 - index,
        gf: 4 - index,
        played: 3,
      }])),
    ]));
    const result = runMonteCarlo(elo, standings, [], 20);
    expect(result.size).toBe(48);
    expect([...result.values()].reduce((sum, value) => sum + value.winProb, 0))
      .toBeCloseTo(1, 12);
  });
});
