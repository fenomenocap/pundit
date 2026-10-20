import { describe, expect, it } from "vitest";
import { loadFplBootstrapFromRecordedFixture } from "./fpl-bootstrap-injuries";
import {
  PUNDIT_PREMIER_LEAGUE_FIXTURE_SIDES,
  findFplTeamByFixtureSide,
  resolveFplTeamIdForFixtureSide,
} from "./fpl-team-map";

describe("FPL team id/code map", () => {
  const snapshot = loadFplBootstrapFromRecordedFixture();

  it("maps all 20 Premier League fixture sides via bootstrap short_name", () => {
    for (const side of PUNDIT_PREMIER_LEAGUE_FIXTURE_SIDES) {
      const team = findFplTeamByFixtureSide(side, snapshot);
      expect(team, side).toBeTruthy();
      expect(team!.short_name).toMatch(/^[A-Z0-9]{2,4}$/);
      expect(typeof team!.id).toBe("number");
    }
  });

  it("maps Coventry City, Hull City and Ipswich Town by FPL code (not display name)", () => {
    expect(resolveFplTeamIdForFixtureSide("Coventry", snapshot)).toBe(7);
    expect(findFplTeamByFixtureSide("Coventry", snapshot)?.short_name).toBe("COV");
    expect(resolveFplTeamIdForFixtureSide("Hull", snapshot)).toBe(11);
    expect(findFplTeamByFixtureSide("Hull", snapshot)?.short_name).toBe("HUL");
    expect(resolveFplTeamIdForFixtureSide("Ipswich", snapshot)).toBe(12);
    expect(findFplTeamByFixtureSide("Ipswich", snapshot)?.short_name).toBe("IPS");
  });
});
