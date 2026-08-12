import { createHash } from "node:crypto";
import { canonicalTeamName } from "../lib/team-names";

export type HistoricalCompletenessMode = "league-round-robin" | "structural-only";

export interface HistoricalSeasonSpec {
  competitionId: "eng.1" | "uefa.champions_qual";
  competition: string;
  seasonId: string;
  eventSeasonYear: number;
  dateRange: string;
  completenessMode: HistoricalCompletenessMode;
  expectedFixtureCount: number | null;
  expectedTeamCount: number | null;
  expectedMatchesPerTeam: number | null;
}

export const HISTORICAL_SEASON_SPECS: readonly HistoricalSeasonSpec[] = [
  {
    competitionId: "eng.1",
    competition: "Premier League",
    seasonId: "2024-25",
    eventSeasonYear: 2024,
    dateRange: "20240801-20250630",
    completenessMode: "league-round-robin",
    expectedFixtureCount: 380,
    expectedTeamCount: 20,
    expectedMatchesPerTeam: 38,
  },
  {
    competitionId: "eng.1",
    competition: "Premier League",
    seasonId: "2025-26",
    eventSeasonYear: 2025,
    dateRange: "20250801-20260630",
    completenessMode: "league-round-robin",
    expectedFixtureCount: 380,
    expectedTeamCount: 20,
    expectedMatchesPerTeam: 38,
  },
  {
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifiers",
    seasonId: "2024-25",
    eventSeasonYear: 2024,
    dateRange: "20240701-20240930",
    completenessMode: "structural-only",
    expectedFixtureCount: null,
    expectedTeamCount: null,
    expectedMatchesPerTeam: null,
  },
  {
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifiers",
    seasonId: "2025-26",
    eventSeasonYear: 2025,
    dateRange: "20250701-20250930",
    completenessMode: "structural-only",
    expectedFixtureCount: null,
    expectedTeamCount: null,
    expectedMatchesPerTeam: null,
  },
] as const;

export interface HistoricalFixture {
  source: "espn";
  sourceEventId: string;
  sourceEventUid: string | null;
  competitionId: string;
  seasonId: string;
  eventSeasonYear: number;
  kickoff: string;
  home: {
    sourceTeamId: string;
    sourceName: string;
    canonicalName: string;
  };
  away: {
    sourceTeamId: string;
    sourceName: string;
    canonicalName: string;
  };
  homeGoals: number;
  awayGoals: number;
  finalStatusName: string;
  finalStatusDetail: string;
  regulationTimeScore: boolean;
  trainingEligible: boolean;
  wasSuspended: boolean | null;
  neutralSite: boolean | null;
  venue: { sourceVenueId: string | null; name: string | null };
}

export interface SeasonValidation {
  status: "pass" | "inconclusive" | "fail";
  fixtureCount: number;
  teamCount: number;
  trainingEligibleCount: number;
  nonRegulationFinalCount: number;
  duplicateEventIds: string[];
  invalidFixtureIds: string[];
  warnings: string[];
  errors: string[];
}

interface EspnCompetitor {
  id?: string;
  homeAway?: string;
  score?: string | number;
  team?: { id?: string; displayName?: string };
}

interface EspnEvent {
  id?: string;
  uid?: string;
  date?: string;
  season?: { year?: number };
  competitions?: Array<{
    status?: { type?: { completed?: boolean; name?: string; detail?: string } };
    competitors?: EspnCompetitor[];
    wasSuspended?: boolean;
    neutralSite?: boolean;
    venue?: { id?: string; fullName?: string };
  }>;
}

interface EspnScoreboard {
  leagues?: Array<{ season?: { year?: number; displayName?: string } }>;
  events?: EspnEvent[];
}

function parseGoals(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function dateRangeBounds(dateRange: string): [number, number] | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/.exec(dateRange);
  if (!match) return null;
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const endExclusive = Date.UTC(Number(match[4]), Number(match[5]) - 1, Number(match[6]) + 1);
  return [start, endExclusive];
}

export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function historicalScoreboardUrl(spec: HistoricalSeasonSpec): string {
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${spec.competitionId}`
    + `/scoreboard?dates=${spec.dateRange}&limit=1000`;
}

export function parseHistoricalScoreboard(
  raw: string,
  spec: HistoricalSeasonSpec
): {
  fixtures: HistoricalFixture[];
  sourceWarnings: string[];
  sourceEventCount: number;
  rejectedEventIds: string[];
} {
  const scoreboard = JSON.parse(raw) as EspnScoreboard;
  const sourceWarnings: string[] = [];
  const topLevelSeason = scoreboard.leagues?.[0]?.season;
  if (topLevelSeason?.year !== undefined && topLevelSeason.year !== spec.eventSeasonYear) {
    sourceWarnings.push(
      `ESPN top-level season metadata reports ${topLevelSeason.displayName ?? topLevelSeason.year}; `
      + `event-level season years are used instead.`
    );
  }

  const fixtures: HistoricalFixture[] = [];
  const rejectedEventIds: string[] = [];
  for (const event of scoreboard.events ?? []) {
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find((entry) => entry.homeAway === "home");
    const away = competition?.competitors?.find((entry) => entry.homeAway === "away");
    const homeGoals = parseGoals(home?.score);
    const awayGoals = parseGoals(away?.score);
    const status = competition?.status?.type;
    if (!event.id || !event.date || !home?.team?.id || !home.team.displayName
      || !away?.team?.id || !away.team.displayName || homeGoals === null || awayGoals === null
      || !status?.completed) {
      rejectedEventIds.push(event.id ?? "missing-id");
      continue;
    }
    const finalStatusName = status.name ?? "UNKNOWN";
    const regulationTimeScore = finalStatusName === "STATUS_FULL_TIME";
    fixtures.push({
      source: "espn",
      sourceEventId: event.id,
      sourceEventUid: event.uid ?? null,
      competitionId: spec.competitionId,
      seasonId: spec.seasonId,
      eventSeasonYear: event.season?.year ?? -1,
      kickoff: event.date,
      home: {
        sourceTeamId: home.team.id,
        sourceName: home.team.displayName,
        canonicalName: canonicalTeamName(home.team.displayName),
      },
      away: {
        sourceTeamId: away.team.id,
        sourceName: away.team.displayName,
        canonicalName: canonicalTeamName(away.team.displayName),
      },
      homeGoals,
      awayGoals,
      finalStatusName,
      finalStatusDetail: status.detail ?? "",
      regulationTimeScore,
      trainingEligible: regulationTimeScore,
      wasSuspended: competition?.wasSuspended ?? null,
      neutralSite: competition?.neutralSite ?? null,
      venue: {
        sourceVenueId: competition?.venue?.id ?? null,
        name: competition?.venue?.fullName ?? null,
      },
    });
  }
  fixtures.sort((a, b) => a.kickoff.localeCompare(b.kickoff)
    || a.sourceEventId.localeCompare(b.sourceEventId));
  return {
    fixtures,
    sourceWarnings,
    sourceEventCount: scoreboard.events?.length ?? 0,
    rejectedEventIds,
  };
}

export function validateHistoricalSeason(
  fixtures: HistoricalFixture[],
  spec: HistoricalSeasonSpec,
  sourceWarnings: string[] = [],
  rejectedEventIds: string[] = []
): SeasonValidation {
  const errors: string[] = [];
  const warnings = [...sourceWarnings];
  const seen = new Set<string>();
  const duplicateEventIds = new Set<string>();
  const invalidFixtureIds: string[] = [];
  const teamMatches = new Map<string, number>();
  const sourceTeamNames = new Map<string, string>();
  const canonicalTeamIds = new Map<string, Set<string>>();
  const pairDirections = new Map<string, Set<string>>();
  const bounds = dateRangeBounds(spec.dateRange);

  for (const fixture of fixtures) {
    if (seen.has(fixture.sourceEventId)) duplicateEventIds.add(fixture.sourceEventId);
    seen.add(fixture.sourceEventId);
    const kickoff = Date.parse(fixture.kickoff);
    const valid = fixture.eventSeasonYear === spec.eventSeasonYear
      && Number.isFinite(kickoff)
      && (bounds === null || (kickoff >= bounds[0] && kickoff < bounds[1]))
      && fixture.home.sourceTeamId !== fixture.away.sourceTeamId
      && fixture.home.canonicalName.length > 0
      && fixture.away.canonicalName.length > 0;
    if (!valid) invalidFixtureIds.push(fixture.sourceEventId);
    for (const team of [fixture.home.sourceTeamId, fixture.away.sourceTeamId]) {
      teamMatches.set(team, (teamMatches.get(team) ?? 0) + 1);
    }
    for (const team of [fixture.home, fixture.away]) {
      const priorName = sourceTeamNames.get(team.sourceTeamId);
      if (priorName !== undefined && priorName !== team.canonicalName) {
        errors.push(`ESPN team ${team.sourceTeamId} maps to multiple canonical names.`);
      }
      sourceTeamNames.set(team.sourceTeamId, team.canonicalName);
      const ids = canonicalTeamIds.get(team.canonicalName) ?? new Set<string>();
      ids.add(team.sourceTeamId);
      canonicalTeamIds.set(team.canonicalName, ids);
    }
    const pair = [fixture.home.sourceTeamId, fixture.away.sourceTeamId].sort().join(":");
    const directions = pairDirections.get(pair) ?? new Set<string>();
    directions.add(`${fixture.home.sourceTeamId}>${fixture.away.sourceTeamId}`);
    pairDirections.set(pair, directions);
  }

  if (duplicateEventIds.size > 0) errors.push("Duplicate ESPN event identifiers found.");
  if (rejectedEventIds.length > 0) {
    errors.push(`${rejectedEventIds.length} source events could not be normalized.`);
  }
  if (invalidFixtureIds.length > 0) errors.push("Fixtures with invalid identity, date, or season found.");
  const canonicalCollisions = [...canonicalTeamIds].filter(([, ids]) => ids.size > 1);
  if (canonicalCollisions.length > 0) {
    errors.push(`${canonicalCollisions.length} canonical team names map to multiple ESPN identifiers.`);
  }
  if (spec.expectedFixtureCount !== null && fixtures.length !== spec.expectedFixtureCount) {
    errors.push(`Expected ${spec.expectedFixtureCount} fixtures; found ${fixtures.length}.`);
  }
  if (spec.expectedTeamCount !== null && teamMatches.size !== spec.expectedTeamCount) {
    errors.push(`Expected ${spec.expectedTeamCount} teams; found ${teamMatches.size}.`);
  }
  if (spec.expectedMatchesPerTeam !== null) {
    const badTeams = [...teamMatches].filter(([, count]) => count !== spec.expectedMatchesPerTeam);
    if (badTeams.length > 0) {
      errors.push(`${badTeams.length} teams do not have ${spec.expectedMatchesPerTeam} fixtures.`);
    }
  }
  if (spec.completenessMode === "league-round-robin") {
    const incompletePairs = [...pairDirections.values()].filter((directions) => directions.size !== 2);
    const expectedPairs = spec.expectedTeamCount === null
      ? null
      : spec.expectedTeamCount * (spec.expectedTeamCount - 1) / 2;
    if (expectedPairs !== null && pairDirections.size !== expectedPairs) {
      errors.push(`Expected ${expectedPairs} unique team pairs; found ${pairDirections.size}.`);
    }
    if (incompletePairs.length > 0) errors.push("Home/away round-robin pairing is incomplete.");
  } else {
    warnings.push("No independent expected fixture-count manifest exists for this qualifying season.");
  }

  const nonRegulationFinalCount = fixtures.filter((fixture) => !fixture.regulationTimeScore).length;
  if (nonRegulationFinalCount > 0) {
    warnings.push(
      `${nonRegulationFinalCount} final scores include extra time or penalties and are excluded from training.`
    );
  }
  const status = errors.length > 0
    ? "fail"
    : spec.completenessMode === "structural-only" ? "inconclusive" : "pass";
  return {
    status,
    fixtureCount: fixtures.length,
    teamCount: teamMatches.size,
    trainingEligibleCount: fixtures.length - nonRegulationFinalCount,
    nonRegulationFinalCount,
    duplicateEventIds: [...duplicateEventIds].sort(),
    invalidFixtureIds,
    warnings,
    errors,
  };
}
