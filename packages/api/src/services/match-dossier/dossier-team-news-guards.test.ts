import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeWallClock, restoreWallClock } from "../__fixtures__/frozen-clock";
import { fixture } from "../__fixtures__/model-fixture";
import { buildMatchPricing } from "../response-correctness";
import { sampleMatchContextFields } from "../match-context";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import {
  deterministicSearchQuery,
  finalizeMatchDeliveredTextForTests,
  type Grounding,
} from "../ask";
import { buildMatchDossierForFixture } from "./builder";
import {
  loadFplBootstrap841Recorded,
  resetFplBootstrapCacheForTests,
  setFplBootstrapCacheForTests,
} from "./fpl-bootstrap-injuries";
import {
  loadPlFixturesFromRecordedFixture,
  resetPlFixturesCacheForTests,
  setPlFixturesCacheForTests,
  setPlBuildPassCompSeasonIdForTests,
} from "./fixture-first/pl-fixtures-client";
import {
  recordedPlCompSeasonIdFromStaffFixtures,
  resetPlStaffCacheForTests,
  seedPlStaffCacheForFixtureSides,
} from "./fixture-first/pl-staff-client";
import { composeFixtureFirstTeamNewsAnswer } from "./dossier-team-news-answer";
import { enforceFplAbsenceClaims } from "./fpl-absence-guard";
import { composePunditTakeDelivery } from "../pundit-take/compose";
import { stashTakeDossier, withPunditTakeRequestScope } from "../pundit-take/flags";
import { planResponse } from "../response-plan";

const ENV_KEYS = [
  "MATCH_DOSSIER_ENABLED",
  "MATCH_DOSSIER_FIXTURE_FIRST_ENABLED",
  "MATCH_DOSSIER_FPL_ENABLED",
  "MATCH_DOSSIER_EVIDENCE_ENABLED",
] as const;

const STAFF_FETCHED_AT = "2026-10-21T12:00:00.000Z";

function munBouGrounding(): Grounding {
  const pHome = 0.459;
  const pDraw = 0.275;
  const pAway = 0.265;
  return {
    kind: "match",
    fixtureId: "eng.1:401879900",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-25T14:00:00.000Z",
    stage: "Regular Season",
    home: "Man United",
    away: "Bournemouth",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.52,
    pUnder2_5: 0.48,
    pBttsYes: 0.51,
    pBttsNo: 0.49,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401879900",
      home: "Man United",
      away: "Bournemouth",
      kickoff: "2026-10-25T14:00:00.000Z",
      pricedAt: STAFF_FETCHED_AT,
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    freshness: sampleAgentFreshness(),
    ...sampleMatchContextFields(),
  };
}

describe("dossier team-news guards", () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    freezeWallClock();
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.MATCH_DOSSIER_ENABLED = "true";
    process.env.MATCH_DOSSIER_FIXTURE_FIRST_ENABLED = "true";
    process.env.MATCH_DOSSIER_FPL_ENABLED = "true";
    process.env.MATCH_DOSSIER_EVIDENCE_ENABLED = "false";
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T12:00:00.000Z"));
  });

  afterEach(() => {
    restoreWallClock();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetFplBootstrapCacheForTests();
    resetPlFixturesCacheForTests();
    resetPlStaffCacheForTests();
    vi.restoreAllMocks();
  });

  function buildMunBouDossier() {
    const snapshot = loadFplBootstrap841Recorded();
    seedPlStaffCacheForFixtureSides(["Man United", "Bournemouth"], snapshot, STAFF_FETCHED_AT);
    setPlBuildPassCompSeasonIdForTests(recordedPlCompSeasonIdFromStaffFixtures());
    setFplBootstrapCacheForTests(snapshot);
    setPlFixturesCacheForTests(loadPlFixturesFromRecordedFixture(), STAFF_FETCHED_AT);
    const row = fixture("Man United", "Bournemouth", {
      fixtureId: 401879900,
      utcDate: "2026-10-25T14:00:00.000Z",
    });
    return buildMatchDossierForFixture(row, {
      now: new Date("2026-10-21T12:00:00.000Z"),
    });
  }

  it("keeps Mun–Bou take prose when Martinez doubtful 75% passes numeric trace (D1)", () => {
    const grounding = munBouGrounding();
    const dossier = buildMunBouDossier();
    const martinez = dossier.teamNews!.value.items.find((i) => i.player === "Martinez" && i.club === "Man United");
    expect(martinez?.status).toBe("d");
    expect(martinez?.chanceOfPlaying).toBe(75);
    const question = "Who wins Man United v Bournemouth?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: false });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan, dossier)!);
    expect(delivery.answer).toMatch(/Martinez \(Man United\) is doubtful, 75% to play/);
    const finalized = withPunditTakeRequestScope("v2", () => {
      stashTakeDossier(dossier);
      return finalizeMatchDeliveredTextForTests(delivery.answer, grounding, question);
    });
    expect(finalized).toMatch(/Martinez \(Man United\) is doubtful, 75% to play/);
    expect(finalized).toMatch(/Man United v Bournemouth/);
  });

  it("answers team-news turns from dossier.teamNews only when fixture-first is on", () => {
    const grounding = munBouGrounding();
    const dossier = buildMunBouDossier();
    const question = "Any injuries for Man United v Bournemouth?";
    expect(deterministicSearchQuery(question, "", grounding)).toBeNull();
    const answer = composeFixtureFirstTeamNewsAnswer(grounding, dossier);
    expect(answer).toMatch(/Martinez \(Man United\) is doubtful, 75% to play/);
    expect(answer).not.toMatch(/couldn.t establish a verified/i);
    expect(planResponse("Who's missing for Man United v Bournemouth?", { groundingKind: "match" }).mode)
      .toBe("team-news");
  });

  it("drops Yoro suspended without FPL support but keeps Martinez doubtful (absence guard)", () => {
    const grounding = munBouGrounding();
    const dossier = buildMunBouDossier();
    const raw = [
      "Man United v Bournemouth — Man United at 46%.",
      "Leny Yoro (Man United) was suspended.",
      "Martinez (Man United) is doubtful, 75% to play.",
    ].join("\n");
    const guarded = enforceFplAbsenceClaims(raw, grounding, dossier);
    expect(guarded).not.toMatch(/Yoro.*suspended/i);
    expect(guarded).toMatch(/Martinez \(Man United\) is doubtful, 75% to play/);
  });
});
