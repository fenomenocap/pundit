import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAM_LIST, TEAMS, formalTeamName, teamIdFromName } from "./data/teams.ts";
import { getTeamMonogram } from "../../lib/team-logos.ts";

test("club short names are formal, never nicknames", () => {
  const informal = ["Bees", "Albion", "Cherries", "Spurs", "Villa", "Palace", "Forest", "Toffees", "Gunners"];
  for (const team of TEAM_LIST) assert.ok(!informal.includes(team.short), `${team.id} short name ${team.short}`);
  assert.equal(TEAMS.BRE.short, "Brentford");
  assert.equal(TEAMS.BHA.short, "Brighton");
  assert.equal(TEAMS.BOU.short, "Bournemouth");
});

test("source names from ESPN, FPL and the ledger resolve to one club id", () => {
  for (const [name, id] of [
    ["Brighton", "BHA"], ["Brighton & Hove Albion", "BHA"], ["Brentford", "BRE"], ["Forest", "NFO"],
    ["Nott'm Forest", "NFO"], ["Man Utd", "MUN"], ["Man United", "MUN"], ["Spurs", "TOT"],
    ["Tottenham Hotspur", "TOT"], ["Newcastle United", "NEW"], ["BHA", "BHA"], ["Hull City", "HUL"],
  ] as const) assert.equal(teamIdFromName(name), id, name);
  assert.equal(teamIdFromName("Real Betis"), null);
  assert.equal(formalTeamName("Forest"), "Nott'm Forest");
  assert.equal(formalTeamName("Man United"), "Manchester United");
  assert.equal(formalTeamName("Real Betis"), "Real Betis");
});

test("monograms never collide for Premier League clubs (Brighton BHA, Brentford BRE)", () => {
  assert.equal(getTeamMonogram("Brighton"), "BHA");
  assert.equal(getTeamMonogram("Brentford"), "BRE");
  const marks = TEAM_LIST.map((team) => getTeamMonogram(team.name));
  assert.equal(new Set(marks).size, marks.length);
});
