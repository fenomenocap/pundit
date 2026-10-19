import { getClubFormSnapshot, type ClubFormSnapshot } from "../club-form";
import type { DataLayerResult } from "./types";
import { wrapWithFreshness } from "./shared";

export interface GetFormInput {
  competitionId: string;
  team?: string;
}

export function getForm(input: GetFormInput): DataLayerResult<ClubFormSnapshot> {
  const snapshot = getClubFormSnapshot(input.competitionId);
  const asOf = snapshot.lastUpdated ?? new Date().toISOString();
  const row = input.team
    ? snapshot.teams.find((entry) => entry.team.toLocaleLowerCase() === input.team!.toLocaleLowerCase())
    : undefined;
  const data = row
    ? { ...snapshot, teams: [row] }
    : snapshot;
  return wrapWithFreshness(
    data,
    [{
      id: "espn-public-scoreboard",
      label: "ESPN results (last-five form)",
      trustTier: "fixture-spine",
      observedAt: asOf,
    }],
    asOf,
    false,
  );
}
