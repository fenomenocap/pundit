/**
 * Track record maths for /evaluation/club-season.
 *
 * One forecast per fixture. The ledger is append-only and can hold more than
 * one sealed row for the same match (a later contributor, or a cached
 * fallback). The page counts each match once, using the same definition as
 * the calibration fit: rows sealed by the scheduled pre-kickoff window only.
 * It never uses the API's pooled `metrics` headline.
 */

export type Outcome = "home" | "draw" | "away";

export type TrackRecordRow = {
  competitionId: string;
  fixtureId: number;
  utcDate: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  result: { homeScore: number; awayScore: number; winner: Outcome } | null;
  forecastAt?: string;
  checkpointPolicyId?: string;
  checkpointReason?: string;
  modelVersion?: string;
  provenanceCompleteness?: string;
};

export type Scores = {
  n: number;
  brier: number | null;
  logLoss: number | null;
  hitRate: number | null;
  from: string | null;
  to: string | null;
};

export type CalibrationBucket = { label: string; count: number; avgPredicted: number; actualRate: number };

/** A coin-flip-for-all-three guess (1/3 each). */
export const UNIFORM_BASELINE = { brier: 2 / 3, logLoss: Math.log(3) } as const;
export const SMALL_SAMPLE = 50;

export function fixtureKey(row: Pick<TrackRecordRow, "competitionId" | "fixtureId">): string {
  return `${row.competitionId}:${row.fixtureId}`;
}

/** Counted rows: finished, scheduled pre-kickoff window, sealed before kickoff. */
export function isCountedRow(row: TrackRecordRow): boolean {
  if (!row.result) return false;
  if (row.checkpointReason !== undefined) {
    if (row.checkpointReason !== "scheduled_window") return false;
  } else if (row.checkpointPolicyId?.startsWith("legacy")) {
    return false;
  }
  if (row.forecastAt) {
    const sealed = Date.parse(row.forecastAt);
    const kickoff = Date.parse(row.utcDate.endsWith("Z") ? row.utcDate : `${row.utcDate}Z`);
    if (Number.isFinite(sealed) && Number.isFinite(kickoff) && sealed >= kickoff) return false;
  }
  return true;
}

/** Exactly one counted row per match: the latest one sealed before kickoff. */
export function onePerFixture<T extends TrackRecordRow>(rows: readonly T[]): T[] {
  const byFixture = new Map<string, T>();
  for (const row of rows) {
    if (!isCountedRow(row)) continue;
    const key = fixtureKey(row);
    const current = byFixture.get(key);
    if (!current || (row.forecastAt ?? "") > (current.forecastAt ?? "")) byFixture.set(key, row);
  }
  return [...byFixture.values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.fixtureId - b.fixtureId);
}

function versionNumber(version: string | undefined): number {
  const parsed = Number(version);
  return Number.isFinite(parsed) ? parsed : -1;
}

/** Highest numbered model version present among counted rows. */
export function currentVersion(rows: readonly TrackRecordRow[]): string | null {
  let best: string | null = null;
  for (const row of rows) {
    if (row.modelVersion === undefined || versionNumber(row.modelVersion) < 0) continue;
    if (best === null || versionNumber(row.modelVersion) > versionNumber(best)) best = row.modelVersion;
  }
  return best;
}

export function probabilityFor(row: Pick<TrackRecordRow, "pHome" | "pDraw" | "pAway">, outcome: Outcome): number {
  return outcome === "home" ? row.pHome : outcome === "draw" ? row.pDraw : row.pAway;
}

export function favouredOutcome(row: Pick<TrackRecordRow, "pHome" | "pDraw" | "pAway">): Outcome {
  const outcomes: Outcome[] = ["home", "draw", "away"];
  return outcomes.reduce((best, outcome) => (probabilityFor(row, outcome) > probabilityFor(row, best) ? outcome : best));
}

export function score(rows: readonly TrackRecordRow[]): Scores {
  const finished = rows.filter((row) => row.result);
  const n = finished.length;
  if (n === 0) return { n: 0, brier: null, logLoss: null, hitRate: null, from: null, to: null };
  let brier = 0, logLoss = 0, hits = 0;
  for (const row of finished) {
    const winner = row.result!.winner;
    for (const outcome of ["home", "draw", "away"] as const) {
      brier += (probabilityFor(row, outcome) - (outcome === winner ? 1 : 0)) ** 2;
    }
    logLoss += -Math.log(Math.max(probabilityFor(row, winner), 1e-12));
    if (favouredOutcome(row) === winner) hits += 1;
  }
  const dates = finished.map((row) => row.utcDate).sort();
  return {
    n,
    brier: brier / n,
    logLoss: logLoss / n,
    hitRate: hits / n,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

/** One-vs-rest calibration: each match contributes three scored outcomes. */
export function calibration(rows: readonly TrackRecordRow[]): CalibrationBucket[] {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0000001];
  const buckets = edges.slice(0, -1).map((low, index) => ({
    label: `${Math.round(low * 100)}–${Math.min(100, Math.round(edges[index + 1] * 100))}%`,
    sum: 0, hits: 0, count: 0,
  }));
  for (const row of rows) {
    if (!row.result) continue;
    for (const outcome of ["home", "draw", "away"] as const) {
      const p = probabilityFor(row, outcome);
      const index = buckets.findIndex((_, i) => p >= edges[i] && p < edges[i + 1]);
      if (index < 0) continue;
      buckets[index].count += 1;
      buckets[index].sum += p;
      if (row.result.winner === outcome) buckets[index].hits += 1;
    }
  }
  return buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      avgPredicted: bucket.sum / bucket.count,
      actualRate: bucket.hits / bucket.count,
    }));
}

export type VersionSegment = { modelVersion: string; competitionId: string; scores: Scores };

/** Earlier versions, one row per version and competition. Never summed. */
export function segments(rows: readonly TrackRecordRow[]): VersionSegment[] {
  const groups = new Map<string, TrackRecordRow[]>();
  for (const row of rows) {
    const key = `${row.modelVersion ?? "unknown"}|${row.competitionId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [modelVersion, competitionId] = key.split("|");
      return { modelVersion, competitionId, scores: score(group) };
    })
    .sort((a, b) => versionNumber(b.modelVersion) - versionNumber(a.modelVersion)
      || a.competitionId.localeCompare(b.competitionId));
}

export type TrackRecord = {
  counted: TrackRecordRow[];
  current: { version: string | null; competitionId: string; rows: TrackRecordRow[]; scores: Scores; calibration: CalibrationBucket[] };
  segments: VersionSegment[];
  ledgerRows: number;
  notCounted: number;
  duplicatesRemoved: number;
};

export function buildTrackRecord(rows: readonly TrackRecordRow[], competitionId = "eng.1"): TrackRecord {
  const counted = onePerFixture(rows);
  const league = counted.filter((row) => row.competitionId === competitionId);
  const version = currentVersion(league);
  const currentRows = league.filter((row) => row.modelVersion === version);
  const eligible = rows.filter(isCountedRow);
  return {
    counted,
    current: {
      version,
      competitionId,
      rows: currentRows,
      scores: score(currentRows),
      calibration: calibration(currentRows),
    },
    segments: segments(counted),
    ledgerRows: rows.length,
    notCounted: rows.length - eligible.length,
    duplicatesRemoved: eligible.length - counted.length,
  };
}
