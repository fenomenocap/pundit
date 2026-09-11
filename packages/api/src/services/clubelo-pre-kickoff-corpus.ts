import { getCompetitionById, RatingProfile } from "../config/competitions";
import { canonicalClubName } from "../lib/team-names";
import {
  CLUB_STRENGTH_MAX_PLAUSIBLE_RATING,
  CLUB_STRENGTH_MIN_PLAUSIBLE_RATING,
} from "./club-strength-artifact";
import {
  ClubEloValidityRow,
  eloOnUtcDateFromValidityRows,
  indexClubEloValidityRows,
} from "./clubelo-club-history";

/**
 * Offline chronological ClubElo contract: (fixture, kickoff) → (homeElo, awayElo)
 * as they stood strictly before kickoff.
 *
 * Runtime model/chat code must not import the capture script and must not
 * contact ClubElo. This module is pure validation and join logic.
 */
export const CLUBELO_PRE_KICKOFF_SCHEMA_VERSION = 1;
export const CLUBELO_PRE_KICKOFF_LOOKUP_POLICY =
  "latest-ranking-strictly-before-kickoff-utc-date" as const;
export const CLUBELO_FROM_TO_LOOKUP_POLICY =
  "clubelo-from-to-window-covering-utc-day-before-kickoff" as const;
export const CLUBELO_PRE_KICKOFF_MAX_STALE_DAYS = 14;

export type ClubEloPreKickoffLookupPolicy =
  | typeof CLUBELO_PRE_KICKOFF_LOOKUP_POLICY
  | typeof CLUBELO_FROM_TO_LOOKUP_POLICY;

export interface ClubEloCsvRow {
  club: string;
  country: string;
  elo: number;
}

export interface ClubEloDailyRanking {
  rankingDate: string;
  retrievedAt: string;
  sourceUrl: string;
  sourceSha256: string;
  byProfile: Pick<Record<RatingProfile, Record<string, number>>, "eng-clubs" | "uefa-clubs">;
}

export interface PreKickoffEloFixtureInput {
  sourceEventId: string;
  competitionId: string;
  seasonId: string;
  kickoff: string;
  homeCanonicalName: string;
  awayCanonicalName: string;
  trainingEligible?: boolean;
}

export interface PreKickoffEloRow {
  sourceEventId: string;
  competitionId: string;
  seasonId: string;
  kickoff: string;
  homeCanonicalName: string;
  awayCanonicalName: string;
  ratingProfile: RatingProfile;
  rankingDate: string;
  homeElo: number;
  awayElo: number;
}

export interface PreKickoffEloMissing {
  sourceEventId: string;
  competitionId: string;
  kickoff: string;
  rankingDate: string | null;
  reason: "no-eligible-ranking" | "missing-home-elo" | "missing-away-elo" | "invalid-kickoff";
  club?: string;
}

export interface PreKickoffEloCorpus {
  schemaVersion: 1;
  source: "clubelo";
  lookupPolicy: ClubEloPreKickoffLookupPolicy;
  fixtures: PreKickoffEloRow[];
}

export interface PreKickoffEloValidation {
  status: "pass" | "inconclusive" | "fail";
  fixtureCount: number;
  coveredCount: number;
  requiredCoveredCount: number;
  requiredMissingCount: number;
  lookAheadViolations: string[];
  inventedRatingCount: number;
  staleRankingWarnings: string[];
  missing: PreKickoffEloMissing[];
  duplicateEventIds: string[];
  invalidEloEventIds: string[];
  errors: string[];
  warnings: string[];
}

export function formatClubEloDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function utcCalendarDate(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return formatClubEloDate(new Date(parsed));
}

/**
 * Conservative look-ahead-free ranking date: the UTC calendar day before kickoff.
 * Same-day ClubElo files may already include earlier matches on that date.
 */
export function rankingDateForKickoff(kickoffIso: string): string | null {
  const parsed = Date.parse(kickoffIso);
  if (!Number.isFinite(parsed)) return null;
  const kickoff = new Date(parsed);
  const ranking = new Date(Date.UTC(
    kickoff.getUTCFullYear(),
    kickoff.getUTCMonth(),
    kickoff.getUTCDate()
  ));
  ranking.setUTCDate(ranking.getUTCDate() - 1);
  return formatClubEloDate(ranking);
}

export function selectRankingDate(
  kickoffIso: string,
  availableDates: readonly string[]
): string | null {
  const deadline = rankingDateForKickoff(kickoffIso);
  if (!deadline) return null;
  const eligible = availableDates.filter((date) => date <= deadline).sort();
  return eligible.at(-1) ?? null;
}

export function parseClubEloCsv(text: string): ClubEloCsvRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length <= 1) return [];
  const rows: ClubEloCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const club = parts[1]?.trim();
    const country = parts[2]?.trim();
    const elo = Number.parseFloat(parts[4]);
    if (!club || !country || !Number.isFinite(elo)) continue;
    rows.push({ club, country, elo });
  }
  return rows;
}

export function buildClubEloProfileMaps(
  rows: readonly ClubEloCsvRow[]
): ClubEloDailyRanking["byProfile"] {
  const engClubs: Record<string, number> = {};
  const uefaClubs: Record<string, number> = {};
  for (const row of rows) {
    const name = canonicalClubName(row.club);
    uefaClubs[name] = row.elo;
    if (row.country === "ENG") engClubs[name] = row.elo;
  }
  return { "eng-clubs": engClubs, "uefa-clubs": uefaClubs };
}

export function ratingProfileForCompetition(competitionId: string): RatingProfile | null {
  return getCompetitionById(competitionId)?.ratingProfile ?? null;
}

export function lookupClubElo(
  ranking: ClubEloDailyRanking,
  clubName: string,
  profile: RatingProfile
): number | null {
  if (profile === "world") return null;
  const elo = ranking.byProfile[profile][canonicalClubName(clubName)];
  return Number.isFinite(elo) ? elo : null;
}

export function joinFixturesWithPreKickoffElo(
  fixtures: readonly PreKickoffEloFixtureInput[],
  rankingsByDate: ReadonlyMap<string, ClubEloDailyRanking>
): { rows: PreKickoffEloRow[]; missing: PreKickoffEloMissing[] } {
  const availableDates = [...rankingsByDate.keys()];
  const rows: PreKickoffEloRow[] = [];
  const missing: PreKickoffEloMissing[] = [];

  for (const fixture of fixtures) {
    const rankingDate = selectRankingDate(fixture.kickoff, availableDates);
    if (!rankingDate) {
      missing.push({
        sourceEventId: fixture.sourceEventId,
        competitionId: fixture.competitionId,
        kickoff: fixture.kickoff,
        rankingDate: rankingDateForKickoff(fixture.kickoff),
        reason: Date.parse(fixture.kickoff) ? "no-eligible-ranking" : "invalid-kickoff",
      });
      continue;
    }
    const ranking = rankingsByDate.get(rankingDate);
    const profile = ratingProfileForCompetition(fixture.competitionId);
    if (!ranking || !profile || profile === "world") {
      missing.push({
        sourceEventId: fixture.sourceEventId,
        competitionId: fixture.competitionId,
        kickoff: fixture.kickoff,
        rankingDate,
        reason: "no-eligible-ranking",
      });
      continue;
    }
    const homeElo = lookupClubElo(ranking, fixture.homeCanonicalName, profile);
    const awayElo = lookupClubElo(ranking, fixture.awayCanonicalName, profile);
    if (homeElo === null || awayElo === null) {
      missing.push({
        sourceEventId: fixture.sourceEventId,
        competitionId: fixture.competitionId,
        kickoff: fixture.kickoff,
        rankingDate,
        reason: homeElo === null ? "missing-home-elo" : "missing-away-elo",
        club: canonicalClubName(
          homeElo === null ? fixture.homeCanonicalName : fixture.awayCanonicalName
        ),
      });
      continue;
    }
    rows.push({
      sourceEventId: fixture.sourceEventId,
      competitionId: fixture.competitionId,
      seasonId: fixture.seasonId,
      kickoff: fixture.kickoff,
      homeCanonicalName: canonicalClubName(fixture.homeCanonicalName),
      awayCanonicalName: canonicalClubName(fixture.awayCanonicalName),
      ratingProfile: profile,
      rankingDate,
      homeElo,
      awayElo,
    });
  }

  rows.sort((a, b) => a.kickoff.localeCompare(b.kickoff)
    || a.sourceEventId.localeCompare(b.sourceEventId));
  return { rows, missing };
}

/**
 * Join fixtures to ClubElo From/To validity windows. Policy date is the UTC
 * calendar day before kickoff. A row is used only when From <= policyDate <= To.
 * Later snapshots that overlap with a different Elo are ignored. Ratings are
 * not invented, interpolated, or carried past To.
 */
export function joinFixturesWithFromToElo(
  fixtures: readonly PreKickoffEloFixtureInput[],
  validityRows: readonly ClubEloValidityRow[]
): { rows: PreKickoffEloRow[]; missing: PreKickoffEloMissing[] } {
  const byClub = indexClubEloValidityRows(validityRows);
  const rows: PreKickoffEloRow[] = [];
  const missing: PreKickoffEloMissing[] = [];

  for (const fixture of fixtures) {
    const policyDate = rankingDateForKickoff(fixture.kickoff);
    if (!policyDate) {
      missing.push({
        sourceEventId: fixture.sourceEventId,
        competitionId: fixture.competitionId,
        kickoff: fixture.kickoff,
        rankingDate: null,
        reason: "invalid-kickoff",
      });
      continue;
    }
    const profile = ratingProfileForCompetition(fixture.competitionId);
    if (!profile || profile === "world") {
      missing.push({
        sourceEventId: fixture.sourceEventId,
        competitionId: fixture.competitionId,
        kickoff: fixture.kickoff,
        rankingDate: policyDate,
        reason: "no-eligible-ranking",
      });
      continue;
    }
    const homeName = canonicalClubName(fixture.homeCanonicalName);
    const awayName = canonicalClubName(fixture.awayCanonicalName);
    const home = eloOnUtcDateFromValidityRows(byClub.get(homeName) ?? [], policyDate);
    const away = eloOnUtcDateFromValidityRows(byClub.get(awayName) ?? [], policyDate);
    if (home === null || away === null) {
      missing.push({
        sourceEventId: fixture.sourceEventId,
        competitionId: fixture.competitionId,
        kickoff: fixture.kickoff,
        rankingDate: policyDate,
        reason: home === null ? "missing-home-elo" : "missing-away-elo",
        club: home === null ? homeName : awayName,
      });
      continue;
    }
    rows.push({
      sourceEventId: fixture.sourceEventId,
      competitionId: fixture.competitionId,
      seasonId: fixture.seasonId,
      kickoff: fixture.kickoff,
      homeCanonicalName: homeName,
      awayCanonicalName: awayName,
      ratingProfile: profile,
      rankingDate: policyDate,
      homeElo: home.elo,
      awayElo: away.elo,
    });
  }

  rows.sort((a, b) => a.kickoff.localeCompare(b.kickoff)
    || a.sourceEventId.localeCompare(b.sourceEventId));
  return { rows, missing };
}

export function preKickoffCoverageBySeason(
  fixtures: readonly PreKickoffEloFixtureInput[],
  rows: readonly PreKickoffEloRow[]
): Record<string, { n: number; covered: number }> {
  const coveredIds = new Set(rows.map((row) => row.sourceEventId));
  const bySeason: Record<string, { n: number; covered: number }> = {};
  for (const fixture of fixtures) {
    const bucket = bySeason[fixture.seasonId] ?? { n: 0, covered: 0 };
    bucket.n += 1;
    if (coveredIds.has(fixture.sourceEventId)) bucket.covered += 1;
    bySeason[fixture.seasonId] = bucket;
  }
  return bySeason;
}

function utcDayDiff(laterDate: string, earlierDate: string): number {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return Number.NaN;
  return Math.round((later - earlier) / 86_400_000);
}

function isPlausibleElo(value: number): boolean {
  return Number.isFinite(value)
    && value >= CLUB_STRENGTH_MIN_PLAUSIBLE_RATING
    && value <= CLUB_STRENGTH_MAX_PLAUSIBLE_RATING;
}

export function validatePreKickoffCorpus(
  rows: readonly PreKickoffEloRow[],
  fixtures: readonly PreKickoffEloFixtureInput[],
  missing: readonly PreKickoffEloMissing[] = [],
  requiredCompetitionIds: readonly string[] = ["eng.1"]
): PreKickoffEloValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lookAheadViolations: string[] = [];
  const staleRankingWarnings: string[] = [];
  const invalidEloEventIds: string[] = [];
  const seen = new Set<string>();
  const duplicateEventIds = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.sourceEventId)) duplicateEventIds.add(row.sourceEventId);
    seen.add(row.sourceEventId);
    const deadline = rankingDateForKickoff(row.kickoff);
    if (!deadline || row.rankingDate > deadline) {
      lookAheadViolations.push(row.sourceEventId);
    }
    if (!isPlausibleElo(row.homeElo) || !isPlausibleElo(row.awayElo)) {
      invalidEloEventIds.push(row.sourceEventId);
    }
    if (deadline) {
      const staleDays = utcDayDiff(deadline, row.rankingDate);
      if (staleDays > 0) {
        staleRankingWarnings.push(
          `${row.sourceEventId} uses ${row.rankingDate} (${staleDays}d before policy date ${deadline})`
        );
      }
      if (staleDays > CLUBELO_PRE_KICKOFF_MAX_STALE_DAYS) {
        errors.push(
          `${row.sourceEventId} ranking ${row.rankingDate} is more than `
          + `${CLUBELO_PRE_KICKOFF_MAX_STALE_DAYS} days before kickoff.`
        );
      }
    }
  }

  const requiredFixtures = fixtures.filter((fixture) => (
    requiredCompetitionIds.includes(fixture.competitionId)
    && fixture.trainingEligible !== false
  ));
  const coveredIds = new Set(rows.map((row) => row.sourceEventId));
  const requiredMissing = requiredFixtures.filter((fixture) => !coveredIds.has(fixture.sourceEventId));
  const optionalMissing = missing.filter((entry) => !requiredCompetitionIds.includes(entry.competitionId));

  if (duplicateEventIds.size > 0) errors.push("Duplicate fixture identifiers found.");
  if (lookAheadViolations.length > 0) {
    errors.push("Rankings dated on or after kickoff UTC date are look-ahead and are rejected.");
  }
  if (invalidEloEventIds.length > 0) errors.push("Implausible Elo values found.");
  if (requiredMissing.length > 0) {
    errors.push(
      `${requiredMissing.length} required fixtures have no pre-kickoff ClubElo row. Ratings are not invented.`
    );
  }
  if (staleRankingWarnings.length > 0) warnings.push(...staleRankingWarnings);
  if (optionalMissing.length > 0) {
    warnings.push(
      `${optionalMissing.length} non-required fixtures are uncovered; they stay out of promotion.`
    );
  }

  const requiredCoveredCount = requiredFixtures.length - requiredMissing.length;
  const status = errors.length > 0
    ? "fail"
    : optionalMissing.length > 0 || staleRankingWarnings.length > 0
      ? "inconclusive"
      : "pass";

  return {
    status,
    fixtureCount: fixtures.length,
    coveredCount: rows.length,
    requiredCoveredCount,
    requiredMissingCount: requiredMissing.length,
    lookAheadViolations,
    inventedRatingCount: 0,
    staleRankingWarnings,
    missing: [...missing],
    duplicateEventIds: [...duplicateEventIds].sort(),
    invalidEloEventIds,
    errors,
    warnings,
  };
}

export function uniqueRankingDatesForFixtures(
  fixtures: readonly PreKickoffEloFixtureInput[]
): string[] {
  const dates = new Set<string>();
  for (const fixture of fixtures) {
    const rankingDate = rankingDateForKickoff(fixture.kickoff);
    if (rankingDate) dates.add(rankingDate);
  }
  return [...dates].sort();
}

export function iterateUtcDates(fromDate: string, toDate: string): string[] {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`Invalid ClubElo capture range ${fromDate}..${toDate}`);
  }
  const dates: string[] = [];
  for (let time = start; time <= end; time += 86_400_000) {
    dates.push(formatClubEloDate(new Date(time)));
  }
  return dates;
}
