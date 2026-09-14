import { describe, expect, it } from "vitest";
import { pairedBootstrap, utcWeekStart } from "./paired-bootstrap";

describe("paired held-out bootstrap", () => {
  it("keeps paired losses together despite large variation between weeks", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ block: String(i), champion: i, challenger: i - 0.1 }));
    const result = pairedBootstrap(rows)!;
    expect(result.p10).toBeCloseTo(-0.1, 12);
    expect(result.p90).toBeCloseTo(-0.1, 12);
    expect(result).toEqual(pairedBootstrap(rows));
    expect(pairedBootstrap(rows.map((row) => ({ ...row, challenger: row.champion })))!.p90).toBe(0);
  });

  it("reports missing uncertainty and rejects invalid draw counts", () => {
    expect(pairedBootstrap([])).toBeNull();
    expect(pairedBootstrap([{ block: "a", champion: 0, challenger: 0 }], 0)).toBeNull();
    for (const draws of [-1, 0.5, NaN, Infinity]) expect(() => pairedBootstrap([], draws)).toThrow();
  });

  it("groups simultaneous games and Sunday into the same UTC week", () => {
    expect(utcWeekStart("2026-09-13T23:59:59Z")).toBe("2026-09-07T00:00:00.000Z");
    expect(utcWeekStart("2026-09-14T00:00:00Z")).toBe("2026-09-14T00:00:00.000Z");
  });
});
