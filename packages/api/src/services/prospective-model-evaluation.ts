import { canonicalClubName } from "../lib/team-names";
import { forecastFittedDixonColes } from "./dixon-coles-mle";
import { scoreMatrix } from "./dixon-coles";
import { pairedBootstrap, utcWeekStart, MIN_BOOTSTRAP_BLOCKS } from "./paired-bootstrap";
import { MIN_CALIBRATION_HOLDOUT_N } from "./champion-calibration";
import { validateProspectiveSeal, buildProspectiveResult, candidateDigest,
  validateFrozenCandidate, type FrozenProspectiveCandidate, type ProspectiveSeal } from "./prospective-model-seals";

/** Candidate probabilities must belong to the exact frozen parameters, not merely a valid grid. */
export function validateFrozenCandidateSeal(candidate: FrozenProspectiveCandidate, seal: ProspectiveSeal): void {
  validateProspectiveSeal(seal);
  if (seal.candidateFrozenAt !== candidate.frozenAt || seal.trainingThrough !== candidate.trainingThrough
    || seal.trainingResultAvailableAt !== candidate.trainingResultAvailableAt) throw new Error("Seal differs from frozen candidate dates");
  if (!seal.candidate) return;
  const expected = forecastFittedDixonColes(candidate.params, canonicalClubName(seal.home), canonicalClubName(seal.away),
    { meanElo: candidate.meanElo, homeElo: seal.inputs.recoveredHomeElo!, awayElo: seal.inputs.recoveredAwayElo! });
  const close = (actual: unknown, target: unknown): boolean => {
    if (typeof target === "number") return typeof actual === "number" && Math.abs(actual - target) <= 1e-12;
    if (Array.isArray(target)) return Array.isArray(actual) && actual.length === target.length
      && target.every((value, index) => close(actual[index], value));
    if (target && typeof target === "object") return !!actual && typeof actual === "object"
      && Object.entries(target).every(([field, value]) => close((actual as Record<string, unknown>)[field], value));
    return actual === target;
  };
  if (!expected || !close(seal.candidate, expected)
    || !close(seal.candidateGrid, scoreMatrix(expected.lambdaHome, expected.lambdaAway, candidate.params.rho)))
    throw new Error("Seal forecast differs from frozen candidate parameters");
}

const FIELDS = ["brier", "logLoss", "over25Brier", "over25LogLoss", "bttsBrier", "bttsLogLoss", "scoreLogLoss"] as const;
type Losses = Record<typeof FIELDS[number], number>;
const log = (probability: number) => -Math.log(Math.max(1e-15, probability));
/** Read-only lineage check used by the report CLI; an interrupted publication must recover before scoring. */
export function validateProspectiveResultTransitions(claims: Array<{ file: string; body: string }>, results: Array<{ file: string; body: string }>): void {
  const parsed = claims.map(({ file, body }) => {
    const claim = JSON.parse(body), resultBody = `${JSON.stringify(claim.result, null, 2)}\n`;
    if (!(claim.predecessorSha256 === null || /^[a-f0-9]{64}$/.test(claim.predecessorSha256))
      || !/^[a-f0-9]{64}$/.test(claim.result?.sealSha256)
      || file !== `${claim.result.sealSha256}-${claim.predecessorSha256 ?? "root"}.json`
      || !results.some((row) => row.body === resultBody)) throw new Error("Invalid or incomplete prospective transition publication");
    return { ...claim, digest: candidateDigest(resultBody) };
  });
  if (results.some((row) => row.file !== `${candidateDigest(row.body)}.json`
    || !parsed.some((claim) => claim.digest === candidateDigest(row.body)))) throw new Error("Unclaimed prospective result");
  for (const sealDigest of new Set(parsed.map((claim) => claim.result.sealSha256))) {
    const chain = parsed.filter((claim) => claim.result.sealSha256 === sealDigest);
    const roots = chain.filter((claim) => claim.predecessorSha256 === null);
    if (roots.length !== 1) throw new Error("Prospective transition chain has no unique root");
    let current: typeof roots[number] | undefined = roots[0], previousAt = -Infinity;
    const visited = new Set<string>();
    while (current) {
      const observedAt = Date.parse(current.result.observedAt);
      if (!Number.isFinite(observedAt) || observedAt <= previousAt || visited.has(current.digest))
        throw new Error("Cyclic or retrodated prospective transition chain");
      visited.add(current.digest); previousAt = observedAt;
      const next = chain.filter((claim) => claim.predecessorSha256 === current!.digest);
      if (next.length > 1) throw new Error("Competing prospective transition successors");
      current = next[0];
    }
    if (visited.size !== chain.length) throw new Error("Orphan prospective transition");
  }
}

function loss(seal: ProspectiveSeal, side: "champion" | "candidate", home: number, away: number): Losses {
  const f = seal[side]!, grid = side === "champion" ? seal.championGrid! : seal.candidateGrid!;
  const h = Number(home > away), d = Number(home === away), a = Number(home < away);
  const over = home + away > 2, btts = home > 0 && away > 0;
  return { brier: (f.pHome - h) ** 2 + (f.pDraw - d) ** 2 + (f.pAway - a) ** 2,
    logLoss: log(h ? f.pHome : d ? f.pDraw : f.pAway),
    over25Brier: (f.pOver2_5 - Number(over)) ** 2, over25LogLoss: log(over ? f.pOver2_5 : f.pUnder2_5),
    bttsBrier: (f.pBttsYes - Number(btts)) ** 2, bttsLogLoss: log(btts ? f.pBttsYes : f.pBttsNo),
    scoreLogLoss: log(grid[home]?.[away] ?? 0) };
}

/** Read-only scoring. Latest observed correction at or before the cutoff wins; no forecast can be refitted. */
export function evaluateProspectiveEvidence(input: {
  candidate: FrozenProspectiveCandidate; candidateSha256: string;
  cohort: { candidateSha256: string; activatedAt: string; endsAt: string };
  seals: string[]; results: string[]; observedFixtures: number; missedCheckpoints: number; asOf?: Date;
}) {
  validateFrozenCandidate(input.candidate);
  const asOf = input.asOf ?? new Date(), activation = Date.parse(input.cohort.activatedAt), end = Date.parse(input.cohort.endsAt);
  if (!/^[a-f0-9]{64}$/.test(input.candidateSha256) || !Number.isFinite(asOf.getTime())
    || !Number.isFinite(activation) || !Number.isFinite(end) || end <= activation
    || activation < Date.parse(input.candidate.frozenAt) || activation > asOf.getTime()
    || input.cohort.candidateSha256 !== input.candidateSha256
    || !Number.isInteger(input.observedFixtures) || !Number.isInteger(input.missedCheckpoints)
    || input.observedFixtures < 0 || input.missedCheckpoints < 0) throw new Error("Invalid prospective evaluation cohort");
  const allSeals = input.seals.map((body) => {
    const seal = JSON.parse(body) as ProspectiveSeal; validateFrozenCandidateSeal(input.candidate, seal);
    if (seal.candidateSha256 !== input.candidateSha256 || Date.parse(seal.observedAt) < activation
      || Date.parse(seal.kickoff) >= end)
      throw new Error("Seal lies outside independent prospective cohort");
    return { body, seal, digest: candidateDigest(body) };
  });
  if (new Set(allSeals.map(({ seal }) => seal.fixtureId)).size !== allSeals.length) throw new Error("Duplicate prospective fixture");
  const seals = allSeals.filter(({ seal }) => Date.parse(seal.observedAt) <= asOf.getTime());
  const observations = input.results.map((body) => {
    const result = JSON.parse(body), stored = allSeals.find((row) => row.digest === result.sealSha256);
    const rebuilt = stored && buildProspectiveResult(stored.body, { id: result.fixtureId, competitionId: "eng.1",
      utcDate: stored.seal.kickoff, homeTeam: stored.seal.home, awayTeam: stored.seal.away, status: "FINISHED",
      score: { home: result.homeScore, away: result.awayScore } }, new Date(result.observedAt));
    if (!rebuilt || result.candidateSha256 !== input.candidateSha256
      || JSON.stringify(result) !== JSON.stringify(rebuilt)) throw new Error("Invalid bound prospective result");
    return rebuilt;
  }).filter((row) => Date.parse(row.observedAt) <= asOf.getTime());
  const scored: Array<{ seal: ProspectiveSeal; home: number; away: number; champion: Losses; candidate: Losses }> = [];
  let completedSeals = 0, correctedFixtures = 0;
  for (const { seal, digest } of seals) {
    const results = observations.filter((row) => row.sealSha256 === digest).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    if (!results.length) continue;
    completedSeals += 1;
    if (new Set(results.map((row) => `${row.homeScore}:${row.awayScore}`)).size > 1) correctedFixtures += 1;
    const latest = results.at(-1)!;
    if (results.some((row) => row.observedAt === latest.observedAt
      && (row.homeScore !== latest.homeScore || row.awayScore !== latest.awayScore)))
      throw new Error("Conflicting result corrections share an observation time");
    if (seal.failure || !seal.champion || !seal.candidate) continue;
    scored.push({ seal, home: latest.homeScore, away: latest.awayScore,
      champion: loss(seal, "champion", latest.homeScore, latest.awayScore),
      candidate: loss(seal, "candidate", latest.homeScore, latest.awayScore) });
  }
  const summary = (side: "champion" | "candidate"): { n: number } & Record<typeof FIELDS[number], number | null> => ({ n: scored.length,
    ...Object.fromEntries(FIELDS.map((field) => [field, scored.length
      ? scored.reduce((sum, row) => sum + row[side][field], 0) / scored.length : null])) as Record<typeof FIELDS[number], number | null> });
  const uncertainty = Object.fromEntries(FIELDS.map((field) => [field, pairedBootstrap(scored.map((row) => ({
    block: utcWeekStart(row.seal.kickoff), champion: row.champion[field], challenger: row.candidate[field] }))) ]));
  const bins = (side: "champion" | "candidate", market: "1x2" | "over25" | "btts") => {
    const entries = scored.flatMap((row) => {
      const f = row.seal[side]!;
      if (market === "1x2") return [[f.pHome, Number(row.home > row.away)], [f.pDraw, Number(row.home === row.away)],
        [f.pAway, Number(row.home < row.away)]];
      return market === "over25" ? [[f.pOver2_5, Number(row.home + row.away > 2)]]
        : [[f.pBttsYes, Number(row.home > 0 && row.away > 0)]];
    });
    const buckets = Array.from({ length: 5 }, (_, index) => {
      const rows = entries.filter(([p]) => Math.min(4, Math.floor(p * 5)) === index);
      return { low: index / 5, high: (index + 1) / 5, n: rows.length,
        predicted: rows.length ? rows.reduce((sum, [p]) => sum + p, 0) / rows.length : null,
        actualRate: rows.length ? rows.reduce((sum, [, outcome]) => sum + outcome, 0) / rows.length : null };
    });
    const ece = entries.length ? buckets.reduce((sum, row) => sum + row.n * Math.abs((row.predicted ?? 0) - (row.actualRate ?? 0)), 0) / entries.length : null;
    return { buckets, ece };
  };
  const weeks = new Set(scored.map((row) => utcWeekStart(row.seal.kickoff))).size;
  const sufficient = scored.length >= MIN_CALIBRATION_HOLDOUT_N && weeks >= MIN_BOOTSTRAP_BLOCKS;
  const reasons = ["Existing two-origin, calibration and reviewed-release gates remain required; this report cannot approve promotion."];
  if (!sufficient) reasons.unshift(`Need at least ${MIN_CALIBRATION_HOLDOUT_N} paired completed fixtures and ${MIN_BOOTSTRAP_BLOCKS} UTC weeks; observed ${scored.length} and ${weeks}.`);
  if (input.missedCheckpoints || completedSeals !== scored.length) reasons.push("Missing or withheld forecasts remain in coverage denominators and need review.");
  const totals = uncertainty.over25Brier, totalsLog = uncertainty.over25LogLoss;
  const totalsNoInferiority = sufficient && totals !== null && totalsLog !== null && totals.meanDelta <= 0 && totals.p90 <= 0
    && totalsLog.meanDelta <= 0 && totalsLog.p90 <= 0;
  if (!totalsNoInferiority) reasons.push("Prospective totals no-inferiority is unestablished; a worse or uncertain total cannot be promoted.");
  return { schemaVersion: 1, candidateSha256: input.candidateSha256, asOf: asOf.toISOString(),
    independentProspective: true, status: sufficient ? "REVIEW_REQUIRED" : "INSUFFICIENT_EVIDENCE",
    correctionPolicy: "latest-verified-observation-at-or-before-cutoff", probabilityFloor: 1e-15,
    uncertaintyInterpretation: "Paired UTC-week2000draws/seed20260915 p10–p90 is80% empirical interval, not95%.",
    coverage: { observedFixtures: input.observedFixtures, sealedFixtures: seals.length,
      failedSeals: seals.filter(({ seal }) => seal.failure).length, missedCheckpoints: input.missedCheckpoints,
      completedSeals, pairedCompletedFixtures: scored.length, pendingSeals: seals.length - completedSeals,
      correctedFixtures, utcWeeks: weeks, exactScoresOutsideGrid: scored.filter((row) => row.home > 10 || row.away > 10).length },
    champion: summary("champion"), candidate: summary("candidate"), uncertainty,
    reliability: Object.fromEntries(["champion", "candidate"].map((side) => [side,
      Object.fromEntries(["1x2", "over25", "btts"].map((market) => [market, bins(side as "champion" | "candidate", market as "1x2" | "over25" | "btts")]))])),
    decision: { minimumIndependentEvidence: sufficient, totalsNoInferiority,
      recommendPromotion: false, activateProduction: false, changeShippedConstants: false, reasons } };
}
