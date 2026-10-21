import { describe, expect, it } from "vitest";
import {
  loadFplBootstrap841Recorded,
  loadFplBootstrapFromRecordedFixture,
} from "./fpl-bootstrap-injuries";
import {
  PUNDIT_FIXTURE_SIDE_TO_FPL_SHORT_NAME,
  findFplTeamByFixtureSide,
  resolveFplTeamIdForFixtureSide,
} from "./fpl-team-map";

describe("FPL team id/code map", () => {
  it("maps every team in the 841-recorded bootstrap via short_name", () => {
    const snapshot = loadFplBootstrap841Recorded();
    expect(snapshot.teams).toHaveLength(20);
    for (const team of snapshot.teams) {
      const punditSide = Object.entries(PUNDIT_FIXTURE_SIDE_TO_FPL_SHORT_NAME).find(
        ([, code]) => code === team.short_name,
      )?.[0];
      expect(punditSide, team.short_name).toBeTruthy();
      expect(findFplTeamByFixtureSide(punditSide!, snapshot)?.id).toBe(team.id);
    }
  });

  it("maps Coventry City, Hull City and Ipswich Town by FPL code (not display name)", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    expect(resolveFplTeamIdForFixtureSide("Coventry", snapshot)).toBe(7);
    expect(findFplTeamByFixtureSide("Coventry", snapshot)?.short_name).toBe("COV");
    expect(resolveFplTeamIdForFixtureSide("Hull", snapshot)).toBe(11);
    expect(findFplTeamByFixtureSide("Hull", snapshot)?.short_name).toBe("HUL");
    expect(resolveFplTeamIdForFixtureSide("Ipswich", snapshot)).toBe(12);
    expect(findFplTeamByFixtureSide("Ipswich", snapshot)?.short_name).toBe("IPS");
  });
});
