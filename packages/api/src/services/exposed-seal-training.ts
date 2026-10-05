import { validateClubStrengthArtifact } from "./club-strength-artifact";
import type { FittedDixonColesTrainingRow } from "./dixon-coles-mle";

interface ExposedCompletedSeal {
  schemaVersion?: number;
  provenanceCompleteness?: string;
  competitionId: string;
  fixtureId: number;
  utcDate: string;
  forecastAt: string;
  home: string;
  away: string;
  checkpointPolicyId?: string;
  checkpointReason?: string;
  inputs: { ratingProfile: string | null; homeRating: number; awayRating: number;
    ratingSnapshotAt?: string | null; ratingArtifactId?: string; ratingArtifactSha256?: string };
  result?: { homeScore: number; awayScore: number; winner?: string };
}

/** Existing inspected seals may refresh training; they are never blind outcomes. */
export function exposedSealsForTraining(
  seals: readonly ExposedCompletedSeal[],
  ratingArtifacts: ReadonlyMap<string, unknown>,
  observedAt: string
) {
  const now = Date.parse(observedAt);
  if (!Number.isFinite(now)) throw new Error("Invalid exposed-ledger observation timestamp.");
  const rows: FittedDixonColesTrainingRow[] = [];
  const excluded: Array<{ fixtureId: number; reason: string }> = [];
  const seen = new Set<number>();
  for (const seal of seals) {
    if (seal.competitionId !== "eng.1") continue;
    let reason: string | null = null;
    let homeElo: number | undefined, awayElo: number | undefined;
    const kickoff = Date.parse(seal.utcDate), forecastAt = Date.parse(seal.forecastAt);
    const kickoffDay = Number.isFinite(kickoff) ? Date.parse(new Date(kickoff).toISOString().slice(0, 10)) : NaN;
    const sha = seal.inputs?.ratingArtifactSha256;
    const snapshotAt = Date.parse(seal.inputs?.ratingSnapshotAt ?? "");
    if (seen.has(seal.fixtureId)) reason = "duplicate-fixture";
    else if (seal.schemaVersion !== 2 || seal.provenanceCompleteness !== "complete"
      || seal.checkpointPolicyId !== "pre-kickoff-90m-v1" || seal.checkpointReason !== "scheduled_window") reason = "not-official-complete-seal";
    else if (!Number.isFinite(kickoff) || !Number.isFinite(forecastAt) || forecastAt >= kickoff
      || kickoff + 86_400_000 > now) reason = "result-not-yet-available";
    else if (!seal.result || !Number.isInteger(seal.result.homeScore) || seal.result.homeScore < 0
      || !Number.isInteger(seal.result.awayScore) || seal.result.awayScore < 0) reason = "invalid-result";
    else if (!Number.isFinite(snapshotAt) || snapshotAt > kickoffDay - 86_400_000) reason = "rating-not-before-kickoff-day";
    else if (!sha || !/^[a-f0-9]{64}$/.test(sha) || !ratingArtifacts.has(sha)) reason = "missing-rating-artifact";
    else {
      try {
        const validated = validateClubStrengthArtifact(ratingArtifacts.get(sha), new Date(forecastAt));
        homeElo = validated.byProfile["eng-clubs"].get(seal.home);
        awayElo = validated.byProfile["eng-clubs"].get(seal.away);
        if (validated.artifact.payloadSha256 !== sha || validated.artifact.artifactId !== seal.inputs.ratingArtifactId
          || validated.artifact.payload.snapshotAt !== seal.inputs.ratingSnapshotAt
          || seal.inputs.ratingProfile !== "eng-clubs"
          // Public model rows seal one decimal. Verify that exact serialization,
          // then recover the original hash-bound precision for offline training.
          || !Number.isFinite(homeElo) || !Number.isFinite(awayElo)
          || Math.round(homeElo! * 10) / 10 !== seal.inputs.homeRating
          || Math.round(awayElo! * 10) / 10 !== seal.inputs.awayRating) reason = "rating-provenance-mismatch";
      } catch { reason = "invalid-rating-artifact"; }
    }
    seen.add(seal.fixtureId);
    if (reason) { excluded.push({ fixtureId: seal.fixtureId, reason }); continue; }
    rows.push({ sourceEventId: String(seal.fixtureId), competitionId: "eng.1", kickoff: new Date(kickoff).toISOString(),
      homeCanonicalName: seal.home, awayCanonicalName: seal.away,
      homeGoals: seal.result!.homeScore, awayGoals: seal.result!.awayScore,
      homeElo: homeElo!, awayElo: awayElo!,
      rankingDate: seal.inputs.ratingSnapshotAt!.slice(0, 10) });
  }
  return { rows, excluded, attemptedPlSeals: rows.length + excluded.length, observedAt,
    ratingPrecisionPolicy: "verify-sealed-one-decimal-recover-hash-bound-full-precision" as const,
    exposedDevelopment: true as const, independentBlindTest: false as const, completeSeasonCoverage: false as const };
}
