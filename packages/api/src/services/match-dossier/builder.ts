import { buildGrounding } from "../ask";
import { buildMatchContext } from "../match-context";
import {
  getCachedPriorSeasonResults,
  getCachedSeasonSchedule,
  type FootballMatch,
} from "../football-data";
import { getCachedModelData, type ModelFixture } from "../model-data";
import { getCachedFixtureMarketOdds } from "../model-market-odds";
import { espnFixtureIdentity } from "../fixture-registry";
import type {
  BuildDossierOptions,
  DossierBuildWindow,
  DossierEvidenceItem,
  DossierProvenance,
  MatchDossier,
  ProvenanceField,
} from "./types";
import { MATCH_DOSSIER_SCHEMA_VERSION } from "./types";
import {
  collectDossierEvidence,
  rejectSyntheticEvidenceForRealFixture,
  type DossierEvidenceCollectResult,
} from "./dossier-evidence";
import { isSyntheticDossierEvidenceHost } from "./dossier-synthetic-fixture";
import { collectVerifiedDossierEvidence } from "./dossier-evidence-capture";
import {
  DOSSIER_EVIDENCE_REPLAY_ID,
  matchDossierEvidenceEnabled,
  matchDossierEvidenceVerifyEnabled,
} from "./flags";
import { buildModelFactorBreakdown } from "./model-factor-breakdown";
import {
  buildRestCongestion,
  formWindowFromMatches,
  headToHeadMeetings,
  homeAwaySplit,
} from "./form-stats";
import {
  MATCH_DOSSIER_BUILDER_VERSION,
  matchDossierFixtureFirstEnabled,
  matchDossierFplEnabled,
  matchDossierFplPrefetchEnabled,
} from "./flags";
import { fplInjuryEvidenceForFixtureIfCached, getCachedFplBootstrapSnapshot } from "./fpl-bootstrap-injuries";
import { buildFixtureFirstTeamNews } from "./fixture-first/build-team-news";
import { getPlFixturesCache } from "./fixture-first/pl-fixtures-client";
import { writeMatchDossier } from "./storage";

function espnProvenance(asOf: string): DossierProvenance {
  return {
    sourceId: "espn-public-scoreboard",
    label: "ESPN (interim — Disney ToU restrict automated extraction; see DESIGN.md)",
    trustTier: "interim-spine",
    sourceRole: "interim",
    asOf,
    url: "https://site.api.espn.com/apis/site/v2/sports/soccer",
  };
}

function federatedEvidenceProvenance(asOf: string): DossierProvenance {
  return {
    sourceId: "federated-web-search",
    label: "Federated retrieval (#188 grounding)",
    trustTier: "news",
    sourceRole: "reference-only",
    asOf,
  };
}

/** Injuries / lineups / manager slots accept page-verified evidence, synthetic CI, or internal FPL injuries. */
function evidenceEligibleForSlots(items: DossierEvidenceItem[]): DossierEvidenceItem[] {
  return items.filter(
    (item) => item.verification === "page-verified"
      || (item.verification === "cited" && isSyntheticDossierEvidenceHost(item.sourceUrl))
      || (item.internalOnly === true && item.source === "fpl-bootstrap-static" && item.category === "injuries"),
  );
}

function partitionEvidence(items: DossierEvidenceItem[]): {
  injuries: DossierEvidenceItem[];
  rotation: DossierEvidenceItem[];
  manager: DossierEvidenceItem[];
} {
  const slotted = evidenceEligibleForSlots(items);
  return {
    injuries: slotted.filter((item) => item.category === "injuries"),
    rotation: slotted.filter((item) => item.category === "rotation"),
    manager: slotted.filter((item) => item.category === "manager"),
  };
}

function clubEloProvenance(asOf: string, artifactId?: string | null): DossierProvenance {
  return {
    sourceId: "clubelo-artifact",
    label: "Pinned ClubElo artifact",
    trustTier: "model-pin",
    asOf,
    url: artifactId ?? undefined,
  };
}

function marketProvenance(asOf: string): DossierProvenance {
  return {
    sourceId: "fixture-market-sources",
    label: "Stake / Kalshi / Polymarket (no-vig)",
    trustTier: "market-fetch",
    asOf,
  };
}

function field<T>(value: T, provenance: DossierProvenance): ProvenanceField<T> {
  return { value, provenance };
}

function allFormFixtures(competitionId: string): FootballMatch[] {
  const season = competitionId === "eng.1" ? getCachedSeasonSchedule() : null;
  const prior = competitionId === "eng.1" ? getCachedPriorSeasonResults() : { fixtures: [] };
  const seasonFixtures = season?.fixtures ?? [];
  if (seasonFixtures.length > 0) {
    return [...(prior.fixtures ?? []), ...seasonFixtures];
  }
  return [];
}

export function publicFixtureId(fixture: ModelFixture): string {
  return `espn:${fixture.competitionId}:${fixture.fixtureId}`;
}

export function buildMatchDossierForFixture(
  fixture: ModelFixture,
  options: BuildDossierOptions = {},
): MatchDossier {
  const now = options.now ?? new Date();
  const builtAt = now.toISOString();
  const scheduleReason = options.scheduleReason ?? "on-demand";
  const formFixtures = allFormFixtures(fixture.competitionId);
  const espnAsOf = getCachedSeasonSchedule().lastUpdated?.toISOString()
    ?? getCachedModelData().lastUpdated?.toISOString()
    ?? builtAt;

  const context = buildMatchContext(fixture);
  const factorBreakdown = buildModelFactorBreakdown(
    fixture,
    context.lambdaHome,
    context.lambdaAway,
  );

  const grounding = buildGrounding(fixture);
  const markets = getCachedFixtureMarketOdds(fixture);
  const marketRows = grounding.pricing.markets.map((row) => ({
    source: row.source,
    observedAt: row.observedAt,
    pHome: row.legs.home.impliedP ?? row.legs.home.modelP,
    pDraw: row.legs.draw.impliedP ?? row.legs.draw.modelP,
    pAway: row.legs.away.impliedP ?? row.legs.away.modelP,
  }));

  const modelProv = clubEloProvenance(
    fixture.forecastProvenance?.forecastAt ?? builtAt,
    fixture.forecastProvenance?.ratingArtifactId,
  );

  const evidenceMeta = options.evidence;
  const federatedItems = rejectSyntheticEvidenceForRealFixture(
    fixture,
    (evidenceMeta?.items ?? []).filter(
      (item) => item.verification === "page-verified"
        || (item.verification === "cited" && isSyntheticDossierEvidenceHost(item.sourceUrl)),
    ),
  );
  let fixtureIdentityField: MatchDossier["fixtureIdentity"];
  let teamNewsField: MatchDossier["teamNews"];
  let fplItems: DossierEvidenceItem[] = [];
  if (matchDossierFixtureFirstEnabled()) {
    const fplSnapshot = getCachedFplBootstrapSnapshot();
    if (fplSnapshot) {
      const bundle = buildFixtureFirstTeamNews({
        fixture,
        fplSnapshot,
        plPayload: getPlFixturesCache(),
        schedule: formFixtures,
        fetchedAt: builtAt,
      });
      const fixtureFirstProv: DossierProvenance = {
        sourceId: "fixture-first-source-groups",
        label: "Fixture-first source groups (owner 2026-10-20)",
        trustTier: "interim-spine",
        sourceRole: "interim",
        asOf: builtAt,
      };
      fixtureIdentityField = field(bundle.identity, fixtureFirstProv);
      teamNewsField = field(
        { items: bundle.items, fetchLogs: bundle.fetchLogs },
        fixtureFirstProv,
      );
      fplItems = bundle.items;
    }
  } else if (matchDossierFplEnabled()) {
    fplItems = fplInjuryEvidenceForFixtureIfCached(fixture, builtAt);
  }
  const evidenceItems = [...federatedItems, ...fplItems];
  const evidenceProv = federatedEvidenceProvenance(builtAt);
  const partitioned = partitionEvidence(evidenceItems);

  const featureCandidates: MatchDossier["featureCandidates"] = [
    {
      fieldPath: "form.homeLast5",
      factorId: "form",
      note: "Result sequence + GF/GA; candidate for calibration track only.",
    },
    {
      fieldPath: "rest",
      factorId: "rest-congestion",
      note: "Rest days and 14-day match count from ESPN schedule.",
    },
    {
      fieldPath: "rollingXg",
      factorId: "rolling-xg",
      note: "Requires licensed or search-ingested xG; not a Phase 1 model input.",
    },
  ];

  return {
    schemaVersion: MATCH_DOSSIER_SCHEMA_VERSION,
    fixture: {
      fixtureId: publicFixtureId(fixture),
      espnEventId: fixture.fixtureId,
      competitionId: fixture.competitionId,
      competition: fixture.competition,
      kickoffUtc: fixture.utcDate,
      home: fixture.home,
      away: fixture.away,
    },
    builtAt,
    builderVersion: MATCH_DOSSIER_BUILDER_VERSION,
    scheduleReason,
    table: {
      home: field(
        {
          position: context.homeTable.position,
          points: context.homeTable.points,
          goalDifference: context.homeTable.goalDifference,
        },
        espnProvenance(espnAsOf),
      ),
      away: field(
        {
          position: context.awayTable.position,
          points: context.awayTable.points,
          goalDifference: context.awayTable.goalDifference,
        },
        espnProvenance(espnAsOf),
      ),
    },
    form: {
      homeLast5: field(formWindowFromMatches(fixture.home, formFixtures, 5), espnProvenance(espnAsOf)),
      awayLast5: field(formWindowFromMatches(fixture.away, formFixtures, 5), espnProvenance(espnAsOf)),
      homeLast10: field(formWindowFromMatches(fixture.home, formFixtures, 10), espnProvenance(espnAsOf)),
      awayLast10: field(formWindowFromMatches(fixture.away, formFixtures, 10), espnProvenance(espnAsOf)),
    },
    splits: {
      home: field(homeAwaySplit(fixture.home, formFixtures), espnProvenance(espnAsOf)),
      away: field(homeAwaySplit(fixture.away, formFixtures), espnProvenance(espnAsOf)),
    },
    rest: field(
      buildRestCongestion(fixture.home, fixture.away, formFixtures, fixture.utcDate, now),
      espnProvenance(espnAsOf),
    ),
    headToHead: field(
      headToHeadMeetings(fixture.home, fixture.away, formFixtures),
      espnProvenance(espnAsOf),
    ),
    rollingXg: field(null, {
      sourceId: "rolling-xg-unavailable",
      label: "Not ingested in Phase 1",
      trustTier: "fixture-spine",
      asOf: builtAt,
    }),
    injuries: field({ items: partitioned.injuries }, evidenceProv),
    ...(fixtureIdentityField ? { fixtureIdentity: fixtureIdentityField } : {}),
    ...(teamNewsField ? { teamNews: teamNewsField } : {}),
    lineups: field({ items: partitioned.rotation }, evidenceProv),
    manager: field(
      {
        home: {
          name: partitioned.manager.find((item) => item.claim.toLocaleLowerCase().includes(fixture.home.toLocaleLowerCase()))?.claim ?? null,
          tenureNote: partitioned.manager[0]?.claim ?? null,
        },
        away: {
          name: partitioned.manager.find((item) => item.claim.toLocaleLowerCase().includes(fixture.away.toLocaleLowerCase()))?.claim ?? null,
          tenureNote: partitioned.manager[1]?.claim ?? null,
        },
      },
      evidenceProv,
    ),
    model: field(
      {
        pHome: fixture.pHome,
        pDraw: fixture.pDraw,
        pAway: fixture.pAway,
        pOver2_5: fixture.pOver2_5,
        pBttsYes: fixture.pBttsYes,
        factorBreakdown,
      },
      modelProv,
    ),
    market: field(
      { rows: marketRows },
      marketProvenance(markets?.observedAt ?? builtAt),
    ),
    evidence: evidenceItems,
    dropped: evidenceMeta?.dropped ?? [],
    ...(evidenceMeta && !evidenceMeta.syntheticReplayBlocked ? {
      evidenceBuild: {
        replayId: evidenceMeta.replayId,
        captureId: evidenceMeta.captureId ?? null,
        queryCount: evidenceMeta.queryCount,
        resultCount: evidenceItems.length,
        droppedCount: evidenceMeta.droppedCount,
        verifiedCount: evidenceItems.filter((i) => i.verification === "page-verified").length,
      },
    } : {}),
    featureCandidates,
  };
}

function dossierEvidenceReplayScope(): { replayId: string; recordPath: null } | null {
  const replayId = process.env.MATCH_DOSSIER_EVIDENCE_REPLAY?.trim() || DOSSIER_EVIDENCE_REPLAY_ID;
  if (!matchDossierEvidenceEnabled()) return null;
  return { replayId, recordPath: null };
}

export async function buildMatchDossierForFixtureAsync(
  fixture: ModelFixture,
  options: BuildDossierOptions = {},
): Promise<MatchDossier> {
  if (matchDossierFplPrefetchEnabled()) {
    const { prefetchFplBootstrapForBuildPass } = await import("./fpl-bootstrap-injuries");
    await prefetchFplBootstrapForBuildPass();
  }
  if (matchDossierFixtureFirstEnabled()) {
    const { prefetchPlFixturesForBuildPass } = await import("./fixture-first/pl-fixtures-client");
    await prefetchPlFixturesForBuildPass();
    const fplSnapshot = (await import("./fpl-bootstrap-injuries")).getCachedFplBootstrapSnapshot();
    if (fplSnapshot) {
      const { prefetchPlStaffForBuildPass } = await import("./fixture-first/pl-staff-client");
      const fetchedAt = (options.now ?? new Date()).toISOString();
      await prefetchPlStaffForBuildPass([fixture.home, fixture.away], fplSnapshot, fetchedAt);
    }
  }
  let evidence: DossierEvidenceCollectResult | undefined = options.evidence
    ? {
      items: options.evidence.items,
      dropped: options.evidence.dropped,
      droppedCount: options.evidence.droppedCount,
      queryCount: options.evidence.queryCount,
      replayId: options.evidence.replayId,
      syntheticReplayBlocked: options.evidence.syntheticReplayBlocked,
    }
    : undefined;
  if (!evidence && matchDossierEvidenceEnabled()) {
    if (matchDossierEvidenceVerifyEnabled()) {
      const verified = await collectVerifiedDossierEvidence(fixture, {
        now: options.now,
        origin: options.scheduleReason === "on-demand" ? "on-demand" : "scheduled",
        persistCapture: true,
      });
      evidence = {
        items: verified.items,
        dropped: verified.dropped,
        droppedCount: verified.droppedCount,
        queryCount: verified.queryCount,
        replayId: null,
        captureId: verified.captureId ?? null,
      };
    } else {
      evidence = await collectDossierEvidence(fixture, {
        now: options.now,
        origin: options.scheduleReason === "on-demand" ? "on-demand" : "scheduled",
        replayScope: dossierEvidenceReplayScope(),
      });
    }
  }
  return buildMatchDossierForFixture(fixture, {
    ...options,
    evidence,
  });
}

export function filterFixturesInKickoffWindow(
  fixtures: readonly ModelFixture[],
  window: DossierBuildWindow,
): ModelFixture[] {
  const from = Date.parse(window.kickoffFromInclusive);
  const to = Date.parse(window.kickoffToExclusive);
  return fixtures.filter((fixture) => {
    const kickoff = Date.parse(fixture.utcDate);
    return Number.isFinite(kickoff) && kickoff >= from && kickoff < to;
  });
}

/** Default Phase 1 target: EPL fixtures kicking off 23–25 Oct 2026 (UTC). */
export const PHASE1_WEEKEND_WINDOW: DossierBuildWindow = {
  kickoffFromInclusive: "2026-10-23T00:00:00.000Z",
  kickoffToExclusive: "2026-10-26T00:00:00.000Z",
};

export function buildDossiersForWindow(
  window: DossierBuildWindow = PHASE1_WEEKEND_WINDOW,
  options: BuildDossierOptions = {},
): MatchDossier[] {
  const model = getCachedModelData();
  const targets = filterFixturesInKickoffWindow(
    model.fixtures.filter((f) => f.competitionId === "eng.1"),
    window,
  );
  return targets.map((fixture) => buildMatchDossierForFixture(fixture, options));
}

export function buildAndPersistDossiersForWindow(
  window: DossierBuildWindow = PHASE1_WEEKEND_WINDOW,
  options: BuildDossierOptions = {},
): MatchDossier[] {
  const dossiers = buildDossiersForWindow(window, options);
  for (const dossier of dossiers) {
    writeMatchDossier(dossier);
  }
  return dossiers;
}

/** Scheduled slate build: one FPL prefetch (cached) then sync dossier builds for every fixture. */
export async function buildAndPersistDossiersForWindowAsync(
  window: DossierBuildWindow = PHASE1_WEEKEND_WINDOW,
  options: BuildDossierOptions = {},
): Promise<MatchDossier[]> {
  if (matchDossierFplPrefetchEnabled()) {
    const { prefetchFplBootstrapForBuildPass } = await import("./fpl-bootstrap-injuries");
    await prefetchFplBootstrapForBuildPass();
  }
  if (matchDossierFixtureFirstEnabled()) {
    const { prefetchPlFixturesForBuildPass } = await import("./fixture-first/pl-fixtures-client");
    await prefetchPlFixturesForBuildPass();
    const fplSnapshot = (await import("./fpl-bootstrap-injuries")).getCachedFplBootstrapSnapshot();
    if (fplSnapshot) {
      const model = getCachedModelData();
      const targets = filterFixturesInKickoffWindow(
        model.fixtures.filter((f) => f.competitionId === "eng.1"),
        window,
      );
      const sides = targets.flatMap((f) => [f.home, f.away]);
      const { prefetchPlStaffForBuildPass } = await import("./fixture-first/pl-staff-client");
      const fetchedAt = (options.now ?? new Date()).toISOString();
      await prefetchPlStaffForBuildPass(sides, fplSnapshot, fetchedAt);
    }
  }
  return buildAndPersistDossiersForWindow(window, options);
}

export function findModelFixtureByDossierId(fixtureId: string): ModelFixture | null {
  const model = getCachedModelData();
  const direct = model.fixtures.find((f) => publicFixtureId(f) === fixtureId);
  if (direct) return direct;
  const match = /^espn:([^:]+):(\d+)$/.exec(fixtureId);
  if (!match) return null;
  const [, competitionId, idStr] = match;
  const espnId = Number(idStr);
  return model.fixtures.find(
    (f) => f.competitionId === competitionId && f.fixtureId === espnId,
  ) ?? null;
}

export function resolveFixtureFromRequestKey(key: string): ModelFixture | null {
  const trimmed = key.trim();
  const byId = findModelFixtureByDossierId(trimmed);
  if (byId) return byId;
  const model = getCachedModelData();
  const normalized = trimmed.toLowerCase();
  return model.fixtures.find(
    (f) => publicFixtureId(f) === trimmed
      || espnFixtureIdentity(f) === trimmed
      || `${f.home} v ${f.away}`.toLowerCase() === normalized
      || `${f.away} at ${f.home}`.toLowerCase() === normalized,
  ) ?? null;
}
