/** Resolved cross-provider fixture keys (fixture_identity group). */
export interface FixtureIdentityValue {
  plMatchId: string | null;
  espnEventId: number;
  fotmobMatchId: string | null;
  goalMatchUuid: string | null;
  bbcTipoId: string | null;
  homeFplTeamId: number | null;
  awayFplTeamId: number | null;
  resolvedVia: "pl-api" | "espn";
}

export interface FixtureFirstFetchLog {
  groupKey: string;
  fieldKey: string;
  sourceKey: string;
  fetchedAt: string;
  sourceTimestamp: string | null;
  query: string;
  url: string;
}

export interface FixtureFirstTeamNewsBuild {
  identity: FixtureIdentityValue;
  fetchLogs: FixtureFirstFetchLog[];
  items: import("../types").DossierEvidenceItem[];
}
