import { describe, expect, it } from "vitest";
import { attackDefenceLambdas, fitAttackDefence, type AttackDefenceRow } from "./recency-attack-defence";

function row(id: string, kickoff: string, home: string, away: string, homeGoals: number, awayGoals: number): AttackDefenceRow {
  return { sourceEventId: id, kickoff, homeCanonicalName: home, awayCanonicalName: away, homeGoals, awayGoals };
}

describe("recency attack/defence fit", () => {
  it("gives the dominant side the higher attack and refuses a future row", () => {
    const rows: AttackDefenceRow[] = [];
    for (let index = 0; index < 40; index += 1) {
      const day = String(index + 1).padStart(2, "0");
      const month = index < 28 ? "01" : "02";
      const date = index < 28 ? day : String(index - 27).padStart(2, "0");
      const kickoff = `2024-${month}-${date}T15:00:00.000Z`;
      rows.push(
        row(`a${index}`, kickoff, "Alpha", "Bravo", 3, 0),
        row(`b${index}`, kickoff, "Bravo", "Charlie", 1, 1),
        row(`c${index}`, kickoff, "Charlie", "Alpha", 0, 2),
      );
    }
    const fit = fitAttackDefence(rows, "2024-03-15T00:00:00.000Z", 365, 1);
    expect(fit.converged).toBe(true);
    expect(fit.attack.Alpha).toBeGreaterThan(fit.attack.Charlie);
    expect(fit.rho).toBeGreaterThanOrEqual(-0.2);
    expect(fit.rho).toBeLessThanOrEqual(0.15);
    const [home, away] = attackDefenceLambdas(fit, "Alpha", "Charlie");
    expect(home).toBeGreaterThan(away);
    expect(() => fitAttackDefence([...rows, row("future", "2024-03-15T12:00:00.000Z", "Alpha", "Bravo", 1, 0)],
      "2024-03-15T00:00:00.000Z")).toThrow(/Future/);
  });
});
