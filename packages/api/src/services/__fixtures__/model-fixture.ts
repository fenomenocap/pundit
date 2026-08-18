import { ModelFixture } from "../model-data";

/**
 * A complete, priced `ModelFixture` with everything the grounding builders read
 * already populated, so a test only states the part it is about.
 *
 * Shared rather than redeclared per suite: the guard chain in `ask.ts` is now
 * exercised from several test files, and a per-file copy of this shape drifts
 * into per-file assumptions about what a priced fixture contains.
 */
export function fixture(
  home: string,
  away: string,
  overrides: Partial<ModelFixture> = {}
): ModelFixture {
  return {
    competitionId: "eng.1",
    competition: "Premier League",
    fixtureId: 1,
    utcDate: "2026-08-02T15:00:00.000Z",
    date: "2026-08-02",
    group: null,
    stage: "match",
    home,
    away,
    homeElo: 1800,
    awayElo: 1700,
    pHome: 0.4,
    pDraw: 0.3,
    pAway: 0.3,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [{ score: "1-1", probability: 0.12 }],
    scorelines: [{ score: "1-1", probability: 0.12 }, { score: "3-2", probability: 0.011 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
    ...overrides,
  };
}
