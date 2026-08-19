import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGrounding,
  deliverAnswer,
  generateAnalysis,
  hasMeaningfulProse,
  type AskGrounding,
  type CompetitionGrounding,
  type EvidenceBundle,
  type Grounding,
  type SeasonGrounding,
} from "./ask";
import { fixture } from "./__fixtures__/model-fixture";
import { clientWith, message } from "./__fixtures__/anthropic-stubs";
import {
  validateAnswerCopy,
  validateAnswerStructure,
  validateNoDraftLeak,
} from "../../../../scripts/chat-battle-test-lib.mjs";

/**
 * The missing half of the answer pipeline's test suite.
 *
 * Every guard around `POST /api/ask` is unit-tested for what it *removes*, and
 * nothing anywhere asserted that a correct answer *survives*. Four separate
 * guards then shipped a bug that deleted correct content, and a live sample of
 * five match questions returned three single-sentence boilerplate replies and
 * one answer consisting of literally `[[1]]`.
 *
 * So these tests state the opposite contract: given a well-formed answer and a
 * complete grounding, the delivered text still contains the model's numbers,
 * still has its sections, and is not any of the fail-closed one-liners.
 *
 * Two rules make that contract real rather than decorative.
 *
 * First, the REAL production path. `generateAnalysis` runs Stage A and the tier
 * chain; `deliverAnswer` runs the post-tier stage. Neither is re-implemented
 * here -- a hand-rolled copy of the chain is what let the battle harness certify
 * a pipeline that was destroying answers.
 *
 * Second, a REAL grounding, from `buildGrounding` over a complete fixture. A
 * partial `{...} as Grounding` literal is missing `pOver2_5` and `topScores`,
 * and a grounding missing those cannot detect a guard that eats those numbers.
 */

// The tool loop executes searches for real; stub the backend so these tests
// stay offline and deterministic.
const searchWeb = vi.hoisted(() => vi.fn());
vi.mock("./web-search", () => ({ searchWeb }));

// The delivery tail fetches and verifies evidence pages. Both are stubbed so
// the guards -- not the network -- decide what the delivered answer looks like.
const retrieveEvidencePages = vi.hoisted(() => vi.fn());
vi.mock("./evidence-page-retrieval", () => ({ retrieveEvidencePages }));
const verifyClaimsOnce = vi.hoisted(() => vi.fn());
vi.mock("./claim-verifier", () => ({ verifyClaimsOnce }));

const SOURCE = {
  id: "S1",
  title: "Coventry City team news",
  url: "https://example.com/coventry-team-news",
  date: "2026-08-01",
  snippet: "Coventry City's first-choice keeper is suspended.",
};

beforeEach(() => {
  searchWeb.mockReset();
  searchWeb.mockResolvedValue([
    { title: SOURCE.title, link: SOURCE.url, snippet: SOURCE.snippet, date: SOURCE.date },
  ]);
  retrieveEvidencePages.mockReset();
  retrieveEvidencePages.mockImplementation(async (candidates: Array<Record<string, unknown>>) =>
    candidates.map((candidate) => ({
      ...candidate,
      finalUrl: candidate.url,
      text: SOURCE.snippet,
      retrievedAt: "2026-08-01T00:00:00.000Z",
    })));
  verifyClaimsOnce.mockReset();
  verifyClaimsOnce.mockImplementation(async (
    _client: unknown,
    claims: Array<{ id: string }>
  ) => ({
    status: "verified",
    decisions: claims.map((claim) => ({
      claimId: claim.id,
      outcome: "supported",
      evidenceIds: [SOURCE.id],
    })),
    summary: "supported",
  }));
});

/** A complete, priced match grounding, built by the production converter. */
const matchGrounding: Grounding = buildGrounding(fixture("Arsenal", "Coventry City"));

/**
 * Every figure the grounding above supplies, as the answer writes them. A guard
 * that eats any one of these is the failure this file exists to catch, so they
 * are asserted individually rather than as one blob of prose.
 */
const MODEL_NUMBERS = ["40.0%", "30.0%", "55.0%", "52.0%", "12.0%", "1.1%"];

const SECTION_LABELS = ["**Verdict**", "**Goals**", "**Likely scorelines**", "**Team news**"];

/**
 * The fail-closed one-liners. Each is a legitimate answer in its own narrow
 * case and a catastrophe when it replaces a correct one, which is what all four
 * shipped bugs did.
 */
const BOILERPLATE = [
  "I could not establish a supported",
  "omitted those numbers",
  "The structured probabilities are available",
  "could not establish a verified current update",
];

/** The answer body, minus the team-news sentence, which each variant supplies. */
const ANSWER_BODY = [
  "**Verdict**",
  "Pundit's model makes **Arsenal the favourite at 40.0%**, with the **draw at 30.0%**"
    + " and **Coventry City at 30.0%** for the 2 August 2026 fixture.",
  "",
  "**Goals**",
  "**Over 2.5 at 55.0%** and **both teams to score at 52.0%** point to an open game.",
  "",
  "**Likely scorelines**",
  "**1-1 (12.0%)** leads, with **3-2 (1.1%)** among the outside results.",
  "",
  "**Team news**",
].join("\n");

const answerWith = (teamNews: string) => `${ANSWER_BODY}\n${teamNews}`;

const ABSTAINING_ANSWER = answerWith("No verified team-news update was established for this fixture.");
const CITED_ANSWER = answerWith(
  "Coventry City's first-choice keeper is suspended for this fixture [[S1]]."
);
const UNCITED_ANSWER = answerWith(
  "Coventry City's first-choice keeper is suspended for this fixture."
);
const BARE_MARKER_ANSWER = answerWith(
  "Coventry City's first-choice keeper is suspended for this fixture [[1]]."
);

function searchBundle(withSource = true): EvidenceBundle {
  return {
    queries: ["Arsenal Coventry City team news"],
    providerCalls: 0,
    results: withSource ? [{ ...SOURCE }] : [],
  };
}

function emptyBundle(): EvidenceBundle {
  return { queries: [], providerCalls: 0, results: [] };
}

/**
 * Runs the real pipeline end to end: Stage A and the tier chain inside
 * `generateAnalysis`, then the post-tier stage inside `deliverAnswer`.
 */
async function deliver(options: {
  answer: string;
  tier: "match" | "competition" | "season" | "general";
  grounding: AskGrounding;
  bundle: EvidenceBundle;
  evidenceRequired: boolean;
  question?: string;
}) {
  const client = clientWith(message(options.answer, "end_turn"));
  const generated = await generateAnalysis(
    client,
    "system",
    [{ role: "user", content: options.question ?? "How does Arsenal vs Coventry City look?" }],
    options.tier,
    options.grounding ?? undefined,
    options.bundle
  );
  return deliverAnswer({
    answer: generated,
    tier: options.tier,
    grounding: options.grounding,
    bundle: options.bundle,
    client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
    question: options.question ?? "How does Arsenal vs Coventry City look?",
    evidenceRequired: options.evidenceRequired,
    candidateUnrecognized: false,
  });
}

/** The contract every delivered answer has to meet, whatever the tier. */
function expectDeliverable(answer: string, expectHeadlineOneXTwo = false) {
  expect(hasMeaningfulProse(answer)).toBe(true);
  expect(validateAnswerStructure(answer, { expectHeadlineOneXTwo }).failures).toEqual([]);
  expect(validateAnswerCopy(answer).failures).toEqual([]);
  expect(validateNoDraftLeak(answer).failures).toEqual([]);
  for (const phrase of BOILERPLATE) expect(answer).not.toContain(phrase);
}

/** The match-specific contract: the model's own numbers and its sections. */
function expectMatchContentIntact(answer: string) {
  expectDeliverable(answer, true);
  for (const label of SECTION_LABELS) expect(answer).toContain(label);
  for (const number of MODEL_NUMBERS) expect(answer).toContain(number);
  expect(answer).toContain("2 August 2026");
}

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

describe("a correct match answer survives the real delivery path", () => {
  it("is returned byte-identical when no search ran", async () => {
    const delivered = await deliver({
      answer: ABSTAINING_ANSWER,
      tier: "match",
      grounding: matchGrounding,
      bundle: emptyBundle(),
      evidenceRequired: false,
    });
    expectMatchContentIntact(delivered.answer);
    expect(normalizeWhitespace(delivered.answer)).toBe(normalizeWhitespace(ABSTAINING_ANSWER));
    expect(delivered.verification.status).toBe("not-required");
  });

  it("renders a cited team-news sentence as a link and keeps everything else", async () => {
    const bundle = searchBundle();
    const delivered = await deliver({
      answer: CITED_ANSWER,
      tier: "match",
      grounding: matchGrounding,
      bundle,
      evidenceRequired: true,
    });
    expectMatchContentIntact(delivered.answer);
    // The marker is server-owned syntax: it must become a link, and no bracketed
    // residue may reach the user.
    expect(delivered.answer).toContain(`](${SOURCE.url})`);
    expect(delivered.answer).toContain(SOURCE.date);
    expect(delivered.answer).not.toContain("[[");
    expect(delivered.answer).not.toContain("]]");
    expect(delivered.citations.map((citation) => citation.id)).toEqual(["S1"]);
  });

  it("abstains on team news alone when the answer carries no markers at all", async () => {
    const delivered = await deliver({
      answer: UNCITED_ANSWER,
      tier: "match",
      grounding: matchGrounding,
      bundle: searchBundle(),
      evidenceRequired: true,
    });
    // The verdict, goals and scorelines were never evidence claims -- they came
    // from Pundit's own grounding -- so an unverifiable team-news sentence must
    // cost the user that sentence and nothing else. Replacing the whole answer
    // is the exact regression that produced three boilerplate replies in five.
    expectMatchContentIntact(delivered.answer);
    expect(delivered.answer).not.toContain("first-choice keeper is suspended");
    expect(delivered.answer).toMatch(/no (?:additional )?(?:verified|confirmed)\b/i);
  });

  it("never lets a bare numeric marker reach the user", async () => {
    const withSource = await deliver({
      answer: BARE_MARKER_ANSWER,
      tier: "match",
      grounding: matchGrounding,
      bundle: searchBundle(),
      evidenceRequired: true,
    });
    // `[[1]]` is the model writing the ordinal of S1. With S1 in the bundle it
    // resolves to that source; a user was served an answer that was nothing but
    // this marker, so the one thing that must never happen is that it ships.
    expectMatchContentIntact(withSource.answer);
    expect(withSource.answer).not.toContain("[[");
    expect(withSource.answer).not.toContain("]]");
    expect(withSource.answer).toContain(`](${SOURCE.url})`);

    const withoutSource = await deliver({
      answer: BARE_MARKER_ANSWER,
      tier: "match",
      grounding: matchGrounding,
      bundle: searchBundle(false),
      evidenceRequired: true,
    });
    // Nothing to resolve to: the marker is stripped and the claim it decorated
    // goes with it, but the model's own numbers still stand.
    expectMatchContentIntact(withoutSource.answer);
    expect(withoutSource.answer).not.toContain("[[");
    expect(withoutSource.answer).not.toContain("]]");
  });
});

describe("the final safety gate", () => {
  /** An answer the chain empties: a label with no body is swept, leaving "". */
  const EMPTIED = "**Verdict**";

  it("writes a match answer from the grounding when the chain left no prose", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const delivered = await deliverAnswer({
      answer: EMPTIED,
      tier: "match",
      grounding: matchGrounding,
      bundle: emptyBundle(),
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question: "How does Arsenal vs Coventry City look?",
      evidenceRequired: false,
      candidateUnrecognized: false,
    });
    // Every figure is server-owned, so the fallback is prose the model could not
    // have got wrong -- which is what makes it safe to serve unguarded. It
    // quotes the headline 1X2, the totals and the top scorelines, not the whole
    // scorelines array, so the shared content assertion does not apply.
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain("Arsenal");
    expect(delivered.answer).toContain("Coventry City");
    expect(delivered.answer).toContain("2 August 2026");
    for (const number of ["40.0%", "30.0%", "55.0%", "52.0%", "45.0%", "12.0%"]) {
      expect(delivered.answer).toContain(number);
    }
    for (const label of SECTION_LABELS) expect(delivered.answer).toContain(label);
    expect(delivered.citations).toEqual([]);
    const degraded = warn.mock.calls
      .map(([line]) => JSON.parse(String(line)))
      .filter((entry) => entry.event === "answer_degraded");
    expect(degraded).toEqual([
      { event: "answer_degraded", tier: "match", reason: "guard_chain_left_no_prose" },
    ]);
    warn.mockRestore();
  });

  it("fails the request where there is no server-owned payload to rebuild from", async () => {
    // A canned one-liner for a general question would be a fabricated answer
    // rather than a degraded one, so these fail the way an empty generation does.
    await expect(deliverAnswer({
      answer: EMPTIED,
      tier: "general",
      grounding: null,
      bundle: emptyBundle(),
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question: "How does the offside rule work?",
      evidenceRequired: false,
      candidateUnrecognized: false,
    })).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("the other tiers keep their answers too", () => {
  const competitionGrounding: CompetitionGrounding = {
    kind: "competition",
    competitionId: "eng.1",
    competition: "Premier League",
    updatedAt: "2026-08-02T00:00:00.000Z",
    standings: [
      { position: 1, team: "Arsenal", playedGames: 9, points: 21, goalDifference: 12 },
      { position: 2, team: "Chelsea", playedGames: 9, points: 19, goalDifference: 8 },
    ],
  };

  const seasonGrounding: SeasonGrounding = {
    ...competitionGrounding,
    kind: "season",
    seasonOutlook: {
      competitionId: "eng.1",
      competition: "Premier League",
      runs: 10_000,
      titleProbabilities: [
        { team: "Arsenal", probability: 0.41 },
        { team: "Chelsea", probability: 0.27 },
      ],
      topFourProbabilities: [
        { team: "Arsenal", probability: 0.88 },
        { team: "Chelsea", probability: 0.79 },
      ],
      remainingFixtures: 291,
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  };

  it("keeps a competition answer's table facts", async () => {
    const answer = [
      "**Table**",
      "Arsenal lead on **21 points** from 9 games, two clear of Chelsea on **19 points**.",
      "",
      "**Read**",
      "Nine games in, a two-point gap says almost nothing about where this ends.",
    ].join("\n");
    const delivered = await deliver({
      answer,
      tier: "competition",
      grounding: competitionGrounding,
      bundle: emptyBundle(),
      evidenceRequired: false,
      question: "Who is top of the Premier League?",
    });
    expectDeliverable(delivered.answer);
    expect(delivered.answer).toContain("21 points");
    expect(delivered.answer).toContain("19 points");
  });

  it("keeps a season answer's outlook numbers", async () => {
    const answer = [
      "**Title race**",
      "The season simulation gives Arsenal **41.0%** and Chelsea **27.0%**.",
      "",
      "**Top four**",
      "Arsenal reach the top four in **88.0%** of runs, Chelsea in **79.0%**.",
    ].join("\n");
    const delivered = await deliver({
      answer,
      tier: "season",
      grounding: seasonGrounding,
      bundle: emptyBundle(),
      evidenceRequired: false,
      question: "Who wins the Premier League this season?",
    });
    expectDeliverable(delivered.answer);
    for (const number of ["41.0%", "27.0%", "88.0%", "79.0%"]) {
      expect(delivered.answer).toContain(number);
    }
  });

  it("keeps a general answer and its disclaimer", async () => {
    const answer = [
      "**The offside law**",
      "A player is offside when any part of the head, body or feet with which a goal",
      "can be scored is nearer the opponents' goal line than both the ball and the",
      "second-last opponent at the moment the ball is played.",
    ].join("\n");
    const delivered = await deliver({
      answer,
      tier: "general",
      grounding: null,
      bundle: emptyBundle(),
      evidenceRequired: false,
      question: "How does the offside rule work?",
    });
    expectDeliverable(delivered.answer);
    expect(delivered.answer).toContain("second-last opponent");
    expect(delivered.answer).toMatch(/general football analysis/i);
  });
});
