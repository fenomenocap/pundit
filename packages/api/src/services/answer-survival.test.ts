import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGrounding,
  computeMarketDivergence,
  deliverAnswer,
  generateAnalysis,
  hasGroundedAnswerShape,
  hasMeaningfulProse,
  normalizeAnalystIdentity,
  sanitizeDeliveredAnswer,
  statesConditionalClose,
  statesValueVerdict,
  type AskGrounding,
  type CompetitionGrounding,
  type EvidenceBundle,
  type Grounding,
  type SeasonGrounding,
} from "./ask";
import { segmentAnswer, SECTION_LABEL_LINE } from "./answer-provenance";
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
const toOutcome = vi.hoisted(() => (results: unknown[]) => ({
  status: results.length ? "ok" : "empty",
  results,
  provider: results.length ? "minimax" : null,
  reason: null,
  usedFallback: false,
  attempts: [],
}));
vi.mock("./web-search", () => ({
  searchWeb: (query: string, signal?: AbortSignal) =>
    Promise.resolve(searchWeb(query, signal)).then(toOutcome),
  searchWebBatch: (queries: string[], signal?: AbortSignal) =>
    Promise.all(queries.map((q) => Promise.resolve(searchWeb(q, signal)).then(toOutcome))),
  withSearchQuestion: (fn: () => unknown) => fn(),
}));

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

const marketGrounding: Grounding = (() => {
  const oddsSources: Grounding["oddsSources"] = [{
    source: "kalshi",
    observedAt: "2026-08-21T08:40:43.502Z",
    pHome: 0.5,
    pDraw: 0.25,
    pAway: 0.25,
  }];
  return {
    ...matchGrounding,
    oddsSources,
    marketDivergence: computeMarketDivergence(matchGrounding, oddsSources),
  };
})();

/**
 * Every figure the grounding above supplies, as the answer writes them. A guard
 * that eats any one of these is the failure this file exists to catch, so they
 * are asserted individually rather than as one blob of prose.
 */
const MODEL_NUMBERS = ["40.0%", "30.0%", "55.0%", "52.0%", "12.0%", "1.1%"];

const SECTION_LABELS = ["**Verdict**", "**Goals**", "**Likely scorelines**", "**Team news**"];

/**
 * Fail-closed one-liners that can only ever mean the answer was destroyed.
 * There is no scope at which "the structured probabilities are available, but
 * the unsupported interpretation was omitted" belongs inside an otherwise
 * intact match answer, so these stay blocked outright, anywhere in the text.
 */
const BOILERPLATE = [
  "I could not establish a supported",
  "omitted those numbers",
  "The structured probabilities are available",
];

/**
 * The one fail-closed phrase that is not inherently a destroyed answer.
 *
 * It used to be. Before the evidence guards were scoped, this sentence only
 * ever appeared having replaced the entire answer, so forbidding it outright
 * was the correct assertion. Now that those guards confine themselves to
 * evidence-derived regions, the same sentence is the legitimate team-news
 * abstention: verdict, goals and scorelines intact, and this under
 * **Team news**. Forbidding it everywhere would now fail the target shape.
 *
 * So the assertion is re-targeted, not dropped. The property that always
 * mattered was never "this phrase is absent" -- it was "this phrase never
 * REPLACES the answer" -- and `segmentAnswer` states exactly that. Under a
 * team-news label the sentence is an `"evidence"` segment; standing alone as
 * the whole answer it is a `"model"` segment, because it makes no squad claim
 * and no team-news label precedes it. The destruction shape therefore still
 * fails this check, and only the scoped abstention passes it.
 */
const SCOPED_ABSTENTION = "No verified, dated team-news update was established";

/**
 * Asserts that the scoped abstention, wherever it appears, appears only inside
 * an evidence-derived region -- and never as the answer itself.
 */
function expectAbstentionStaysScoped(answer: string) {
  const carrying = segmentAnswer(answer).filter((segment) =>
    segment.text.includes(SCOPED_ABSTENTION));
  for (const segment of carrying) expect(segment.provenance).toBe("evidence");
  if (carrying.length) {
    // Belt and braces on top of provenance: a replaced answer is one sentence
    // with no sections above it, so the abstention is neither the opening line
    // nor the only thing in the answer.
    const lines = answer.split("\n").filter((line) => line.trim());
    expect(lines[0]).not.toContain(SCOPED_ABSTENTION);
    expect(lines.filter((line) => SECTION_LABEL_LINE.test(line)).length)
      .toBeGreaterThan(1);
  }
}

/** Either wording the pipeline uses to abstain on squad availability. */
const ABSTENTION_WORDING =
  /could not establish a verified current update|no (?:additional )?(?:verified|confirmed)\b/i;

/**
 * Asserts the abstention landed where it belongs: under the team-news label,
 * as that section's body. This is the positive half of the re-targeted
 * assertion -- the answer must not merely avoid being destroyed, the section
 * that lost its claim has to say so.
 */
function expectTeamNewsAbstained(answer: string) {
  const lines = answer.split("\n").filter((line) => line.trim());
  const label = lines.findIndex((line) => /^\s*\*\*Team news\*\*:?\s*$/.test(line));
  expect(label).toBeGreaterThanOrEqual(0);
  expect(lines.slice(label + 1).join(" ")).toMatch(ABSTENTION_WORDING);
}

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
  expectAbstentionStaysScoped(answer);
}

describe("V2 deterministic fact delivery", () => {
  const deliverFallback = (question: string, grounding: Grounding = marketGrounding) =>
    deliverAnswer({
      // Invalid JSON deliberately exercises the same deterministic fallback
      // production used after rejecting a draft, followed by the full V2 tail.
      answer: "not a structured draft",
      tier: "match",
      grounding,
      bundle: emptyBundle(),
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question,
      evidenceRequired: false,
      candidateUnrecognized: false,
      hasHistory: true,
      structuredDraftExpected: true,
    });

  it("preserves a server-composed exact-score probability and fair price", async () => {
    const delivered = await deliverFallback("What is your fair decimal price for an exact 3-2 score?");
    expect(delivered.answer).toMatch(/Arsenal 3-2 Coventry City.*1\.1%.*90\.91/i);
    expect(delivered.answer).toContain("fair decimal odds");
    expect(delivered.answer).not.toContain("omitted those numbers");
  });

  it("preserves a complete server-composed model-market comparison", async () => {
    const delivered = await deliverFallback("Where do you disagree most with the available 1X2 market?");
    expect(delivered.answer).toMatch(/Arsenal.*40\.0%.*Kalshi.*50\.0%.*10\.0 percentage points/i);
    expect(delivered.answer).toMatch(/not its cause|does not establish.*cause/i);
    expect(delivered.answer).not.toContain("omitted those numbers");
  });

  it("does not invent an earlier claim when correction language has no history", async () => {
    const delivered = await deliverAnswer({
      answer: "I need to know which side and fixture you mean.",
      tier: "general",
      grounding: null,
      bundle: emptyBundle(),
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question: "Is that side actually stronger?",
      evidenceRequired: false,
      candidateUnrecognized: false,
      hasHistory: false,
    });
    expect(delivered.answer).toBe("I need to know which side and fixture you mean.");
    expect(delivered.answer).not.toMatch(/earlier claim|earlier sentence/i);
  });
});

/** The match-specific contract: the model's own numbers and its sections. */
function expectMatchContentIntact(answer: string) {
  expectDeliverable(answer, true);
  for (const label of SECTION_LABELS) expect(answer).toContain(label);
  for (const number of MODEL_NUMBERS) expect(answer).toContain(number);
  expect(answer).toContain("2 August 2026");
}

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

describe("a correct match answer survives the real delivery path", () => {
  /**
   * Re-targeted, not weakened, and for the same reason `SCOPED_ABSTENTION` was.
   *
   * The property this test has always been about is that the guard chain
   * changes nothing the model wrote. It used to state that as byte-identity,
   * which was exact while the chain only ever removed text. It no longer only
   * removes: `guaranteeMatchReadCompleteness` appends a conditional close to a
   * full match read that has none, and this answer is precisely the shape it
   * exists for -- one that ends on "No verified team-news update was
   * established for this fixture.", a true sentence that tells the reader
   * nothing about what would move the read.
   *
   * So the assertion is split into the two halves byte-identity was conflating:
   * every byte the model wrote survives, in order, at the front; and the only
   * thing after it is the server's own close.
   */
  it("returns the model's own text unchanged when no search ran", async () => {
    const delivered = await deliver({
      answer: ABSTAINING_ANSWER,
      tier: "match",
      grounding: matchGrounding,
      bundle: emptyBundle(),
      evidenceRequired: false,
    });
    expectMatchContentIntact(delivered.answer);
    const voicedAnswer = normalizeAnalystIdentity(ABSTAINING_ANSWER);
    expect(delivered.answer.startsWith(voicedAnswer)).toBe(true);
    const appended = delivered.answer.slice(voicedAnswer.length);
    expect(appended).toContain("**What would change this**");
    expect(statesConditionalClose(appended)).toBe(true);
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
    expectTeamNewsAbstained(delivered.answer);
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

  /**
   * The re-targeted assertion has to keep catching what the blocklist caught.
   * Loosening "this phrase is absent" to "this phrase stays inside an evidence
   * region" is only safe if the destruction shape still fails, so that is
   * asserted directly rather than assumed: this is the exact text three of five
   * live match questions returned, and it must never be accepted.
   */
  it("still rejects the abstention standing as the whole answer", () => {
    const destroyed = "No verified, dated team-news update was established.";
    expect(segmentAnswer(destroyed).every((segment) => segment.provenance === "model"))
      .toBe(true);
    expect(() => expectAbstentionStaysScoped(destroyed)).toThrow();
    // And the same sentence under a team-news label is accepted, which is the
    // whole point of the distinction.
    expect(() => expectAbstentionStaysScoped(`**Verdict**\nArsenal win **40.0%**,`
      + ` the draw **30.0%**, Coventry City **30.0%**.\n\n**Team news**\n${destroyed}`))
      .not.toThrow();
  });
});

/**
 * The prompt tells the model to compare its numbers against the market and to
 * give a read on the underdog, so a well-formed match answer necessarily
 * contains exactly the language `sanitizeGroundedMatchNarrative` inspects:
 * both team names, favourite/underdog wording, market comparisons, and
 * percentages mixed into prose. The single-sentence probes that guard is
 * unit-tested with never look like this, which is how it kept shipping
 * deletions that only appeared against real output.
 */
describe("realistic match answers are not eaten by the narrative guard", () => {
  /** The same fixture, priced, so the market cross-check has something to do. */
  const pricedGrounding: Grounding = {
    ...matchGrounding,
    oddsSources: [{
      source: "kalshi",
      observedAt: new Date().toISOString(),
      pHome: 0.41,
      pDraw: 0.27,
      pAway: 0.32,
    }],
  };

  /**
   * Each variant lists the prose the guard must not touch. Byte-identity is
   * not the assertion: the market-price sanitizer legitimately rewrites a
   * quoted Kalshi triple into the server-owned rendering, and that is a
   * correction, not a deletion. What must survive is the reasoning.
   */
  const VARIANTS: Record<string, { answer: string; intact: string[] }> = {
    "market comparison and an underdog read": { answer: [
      "**Verdict**",
      "Pundit's model makes **Arsenal the favourite at 40.0%**, with the **draw at 30.0%**"
        + " and **Coventry City at 30.0%** for the 2 August 2026 fixture. Kalshi is at"
        + " 41.0% / 27.0% / 32.0%, so the model sees marginally less edge on the home win.",
      "",
      "**Goals**",
      "**Over 2.5 at 55.0%** and **both teams to score at 52.0%** point to an open game.",
      "",
      "**Likely scorelines**",
      "**1-1 (12.0%)** leads, with **3-2 (1.1%)** among the outside results.",
      "",
      "**Read on the underdog**",
      "Coventry City need the game to stay low-scoring; the market prices them at 32.0%,"
        + " a shade above where the model has them.",
    ].join("\n"), intact: [
      "Pundit's model makes **Arsenal the favourite at 40.0%**",
      "point to an open game",
      "**1-1 (12.0%)** leads",
      "Coventry City need the game to stay low-scoring",
      "a shade above where the model has them",
    ] },
    "the draw discussed alongside the home probability": { answer: [
      "**Verdict**",
      "Arsenal are the model's favourite at **40.0%**, with **Coventry City at 30.0%**."
        + " The **draw at 30.0%** adds to the uncertainty around Arsenal's win probability"
        + " rather than resolving it.",
      "",
      "**Goals**",
      "**Over 2.5 at 55.0%** and **both teams to score at 52.0%**.",
      "",
      "**Likely scorelines**",
      "**1-1 (12.0%)** leads, with **3-2 (1.1%)** an outside result.",
      "",
      "**Read on the underdog**",
      "Three points are at stake for Coventry City, and the model still gives them 30.0%.",
    ].join("\n"), intact: [
      "Arsenal are the model's favourite at **40.0%**",
      // The draw sentence is true and the guard has no business touching it:
      // pDraw is not folded into pHome here, it is merely discussed near it.
      "adds to the uncertainty around Arsenal's win probability",
      "Three points are at stake for Coventry City",
    ] },
    "the market and the model agreeing": { answer: [
      "**Verdict**",
      "Pundit's model favours Arsenal at **40.0%**, the **draw at 30.0%** and"
        + " **Coventry City at 30.0%**. Kalshi favours Arsenal too, so there is no live edge.",
      "",
      "**Goals**",
      "**Over 2.5 at 55.0%** and **both teams to score at 52.0%**.",
      "",
      "**Likely scorelines**",
      "**1-1 (12.0%)** leads, ahead of **3-2 (1.1%)**.",
      "",
      "**Read on the underdog**",
      "Coventry City are underdogs on both the model and the market, and their route runs"
        + " through a tight, low-scoring game.",
    ].join("\n"), intact: [
      "Pundit's model favours Arsenal at **40.0%**",
      "Kalshi favours Arsenal too, so there is no live edge",
      "Coventry City are underdogs on both the model and the market",
    ] },
  };

  for (const [shape, variant] of Object.entries(VARIANTS)) {
    it(`survives with ${shape}`, async () => {
      const delivered = await deliver({
        answer: variant.answer,
        tier: "match",
        grounding: pricedGrounding,
        bundle: emptyBundle(),
        evidenceRequired: false,
      });
      expectDeliverable(delivered.answer, true);
      for (const number of MODEL_NUMBERS) expect(delivered.answer).toContain(number);
      // The guard's job is to remove claims the grounding contradicts. None of
      // these contradicts anything, so the reasoning must arrive intact.
      const normalized = normalizeWhitespace(delivered.answer);
      for (const phrase of variant.intact) {
        expect(normalized).toContain(normalizeWhitespace(normalizeAnalystIdentity(phrase)));
      }
      for (const label of ["**Verdict**", "**Goals**", "**Likely scorelines**"]) {
        expect(delivered.answer).toContain(label);
      }
    });
  }
});

describe("the final safety gate", () => {
  /** An answer the chain empties: a label with no body is swept, leaving "". */
  const EMPTIED = "**Verdict**";

  it("uses the deterministic grounded market answer after an abstaining mandatory search", async () => {
    const artifactAnswer = [
      "**Model vs market**",
      "Pundit's model makes Arsenal 40.0%, the draw 30.0% and Coventry City 30.0%.",
      "Kalshi has Arsenal 50.0%, draw 25.0%, Coventry City 25.0%.",
      "",
      "**What would change this**",
      "If any first-choice attacker is rotated or Coventry City parks a low block, the draw moves toward the priced 25%.",
    ].join("\n");
    const delivered = await deliverAnswer({
      answer: artifactAnswer,
      tier: "match",
      grounding: marketGrounding,
      bundle: { queries: ["Arsenal Coventry market odds"], results: [], providerCalls: 1 },
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question: "How do the market prices for Arsenal vs Coventry City compare with the model?",
      evidenceRequired: true,
      candidateUnrecognized: false,
    });
    expect(delivered.verification.status).toBe("abstain");
    expect(delivered.answer).toContain("Kalshi market-implied probabilities (third-party data, not a Pundit forecast)");
    expect(delivered.answer).toContain("Arsenal 50.0%, draw 25.0%, Coventry City 25.0%");
    expect(delivered.answer).toContain("snapshot establishes the size and direction of the gap, not its cause");
    expect(delivered.answer).not.toMatch(/first-choice attacker|parks a low block|moves toward/i);
  });

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

  /**
   * The negative guards lost this race four times: each new surface form of a
   * tool request written as text passed the stripper that was written for the
   * last one. The structural gate is the answer to that, so it is tested the
   * way it is meant to work -- against one form that actually shipped and two
   * that nobody has ever seen, which is the point.
   */
  describe("rejects a turn that is a tool request rather than an answer", () => {
    const LEAKS: Record<string, string> = {
      // Verbatim production output: the entire answer served for "Celtic vs
      // LASK second leg", 117 characters, with full match grounding attached.
      "the bracket-and-colon form that reached production":
        "[web_search:Celtic LASK Champions League playoff 2026 team news injuries]\n"
        + "[web_search:Celtic lineup news August 2026]",
      // Invented. Neither markup, nor JSON, nor bracketed -- a shape no
      // existing stripper has any vocabulary for.
      "an invented bare directive form":
        "SEARCH -> Celtic LASK second leg team news\n"
        + "SEARCH -> Celtic starting eleven confirmed August 2026",
      // Invented. Reads as ordinary sentences, so every prose heuristic in the
      // pipeline is satisfied; it is still not an answer.
      "an invented conversational form":
        "I am going to look up the latest Celtic and LASK team news before answering, "
        + "and then I will check whether the first leg result has been confirmed anywhere.",
    };

    for (const [shape, leak] of Object.entries(LEAKS)) {
      it(`falls back to the grounded answer for ${shape}`, async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const delivered = await deliverAnswer({
          answer: leak,
          tier: "match",
          grounding: matchGrounding,
          bundle: emptyBundle(),
          client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
          question: "Celtic vs LASK second leg",
          evidenceRequired: false,
          candidateUnrecognized: false,
        });
        // Not one byte of the request may reach the user.
        expect(delivered.answer).not.toContain("web_search");
        expect(delivered.answer).not.toContain("SEARCH");
        expect(delivered.answer).not.toContain("look up the latest");
        // And what does reach them is the server-owned answer.
        expectDeliverable(delivered.answer, true);
        for (const label of SECTION_LABELS) expect(delivered.answer).toContain(label);
        for (const number of ["40.0%", "30.0%", "55.0%", "52.0%"]) {
          expect(delivered.answer).toContain(number);
        }
        // Distinguished from the emptied-answer case: this answer was readable,
        // it just was not an answer.
        expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toContainEqual({
          event: "answer_degraded",
          tier: "match",
          reason: "answer_not_shaped_like_an_answer",
        });
        warn.mockRestore();
      });
    }

    /**
     * The other half of the contract. A positive shape test is only safe if the
     * shortest thing the prompt permits still passes it, so both signals are
     * exercised alone: a follow-up answered in one unlabelled sentence with a
     * number, and a labelled section carrying no number at all.
     */
    const SHORT_BUT_LEGITIMATE: Record<string, string> = {
      "a one-line follow-up carrying only a percentage":
        "Arsenal are the side the model prefers here, at **40.0%** against"
        + " Coventry City's 30.0%.",
      "a single labelled section carrying no number":
        "**Read on the underdog**\nCoventry City need the game to stay tight; their"
        + " route runs through a low-scoring draw or a one-goal away win.",
      // The two shapes a pure team-news question produces. Both legitimately
      // carry no label and no percentage, and substituting the 1X2 fallback for
      // either would answer a question the user did not ask -- destroying
      // correct content from the opposite direction to the leak.
      "a cited team-news answer with no label and no percentage":
        "Coventry City's first-choice keeper is suspended"
        + " ([Coventry City team news](https://example.com/coventry-team-news), 2026-08-01).",
      "an abstention standing as the answer to a pure team-news question":
        "No verified, dated team-news update was established for this fixture.",
    };

    for (const [shape, answer] of Object.entries(SHORT_BUT_LEGITIMATE)) {
      it(`still delivers ${shape}`, async () => {
        const delivered = await deliverAnswer({
          answer,
          tier: "match",
          grounding: matchGrounding,
          bundle: emptyBundle(),
          client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
          question: "Why?",
          evidenceRequired: false,
          candidateUnrecognized: false,
        });
        expect(normalizeWhitespace(delivered.answer))
          .toContain(normalizeWhitespace(normalizeAnalystIdentity(answer)));
      });
    }
  });

  /**
   * Both directions of the shape gate, pinned as one table.
   *
   * A positive gate has two ways to be wrong, and the second is the more
   * dangerous: rejecting a leak is the point, but rejecting a correct answer is
   * the exact failure -- destroying correct content -- that this whole repair
   * exists to eliminate. So the accept column is not a courtesy, it is half the
   * contract, and it is stated here rather than left implicit in the end-to-end
   * tests above.
   */
  describe("the shape gate's accept/reject matrix", () => {
    const REJECTED: Record<string, string> = {
      "the production leak": "[web_search:Celtic LASK Champions League playoff 2026"
        + " team news injuries]\n[web_search:Celtic lineup news August 2026]",
      "an invented bare directive": "SEARCH -> Celtic LASK second leg team news",
      "an invented conversational request": "I am going to look up the latest Celtic and"
        + " LASK team news before answering, and then check the first leg result.",
      "a bare tool JSON payload":
        '{"search_queries": ["Celtic LASK team news", "LASK squad August 2026"]}',
    };

    const ACCEPTED: Record<string, string> = {
      "a full match answer":
        "**Verdict**\nCeltic win **51.2%**, the draw **26.3%**, LASK **22.5%**.",
      "a label with no number":
        "**Read on the underdog**\nLASK need the game to stay tight and low-scoring.",
      "a number with no label":
        "Celtic are the side the model prefers, at 51.2% against LASK's 22.5%.",
      "a short percentage follow-up": "About 26.3%.",
      // The false positive the first cut of this gate had: a correctly cited
      // team-news answer carries neither a label nor a percentage, and the gate
      // would have thrown it away to substitute 1X2 probabilities instead.
      "a cited team-news answer": "Saka is out ([BBC](https://bbc.co.uk/x), 2026-08-18).",
      "an abstention standing alone":
        "No verified, dated team-news update was established.",
      "an abstention in the could-not-verify wording":
        "Pundit could not verify any current squad news for this fixture.",
    };

    for (const [shape, text] of Object.entries(REJECTED)) {
      it(`rejects ${shape}`, () => expect(hasGroundedAnswerShape(text)).toBe(false));
    }
    for (const [shape, text] of Object.entries(ACCEPTED)) {
      it(`accepts ${shape}`, () => expect(hasGroundedAnswerShape(text)).toBe(true));
    }
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

/**
 * The delivery-time guarantee that a match answer states where the model and
 * the market disagree.
 *
 * The prompt asks for it; MiniMax supplied it in roughly half of live samples,
 * and this file's own probe -- a complete Celtic-vs-LASK grounding carrying an
 * eleven-point gap, delivered byte-identical with no mention of a market --
 * reproduced that. Since MiniMax's real compliance cannot be observed offline,
 * the assertion is on the floor underneath it: the server states the gap when
 * the answer did not, states it only when a market actually validates, and
 * never states it twice.
 */
describe("the divergence a match answer must state", () => {
  /** The real Celtic vs LASK payload: model 66.9/20.8/12.4 against two books. */
  const celtic: Grounding = {
    ...buildGrounding(fixture("Celtic", "LASK", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      pHome: 0.669,
      pDraw: 0.208,
      pAway: 0.124,
    })),
    oddsSources: [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: 0.238, pAway: 0.208 },
      { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.565, pDraw: 0.235, pAway: 0.2 },
    ],
  };

  const CELTIC_BODY = [
    "**Verdict**",
    "Pundit's model makes **Celtic 66.9%**, the **draw 20.8%** and **LASK 12.4%**"
      + " for the 2 August 2026 fixture.",
    "",
    "**Goals**",
    "**Over 2.5 at 55.0%** and **both teams to score at 52.0%**.",
    "",
    "**Team news**",
    "No verified team-news update was established for this fixture.",
  ].join("\n");

  const deliverCeltic = (answer: string, grounding: Grounding = celtic) => deliver({
    answer,
    tier: "match",
    grounding,
    bundle: emptyBundle(),
    evidenceRequired: false,
    question: "Celtic vs LASK second leg",
  });

  it("states the gap when the model left it out", async () => {
    const delivered = await deliverCeltic(CELTIC_BODY);
    expectDeliverable(delivered.answer, true);
    // Server-composed from the validated record, so every figure in it is one
    // the market guard would vouch for.
    expect(delivered.answer).toContain(
      "Against Kalshi, which prices Celtic at 55.4%, my 66.9% estimate is"
      + " 11.5 percentage points higher"
    );
    // It lands beside the numbers rather than as a trailing recital, and the
    // model's own text is untouched.
    expect(delivered.answer.split("\n")[1]).toContain("66.9%");
    expect(delivered.answer).toContain("No verified team-news update");
    // Nothing machine-shaped: no ISO timestamp, no bare source header.
    expect(delivered.answer).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("does not reintroduce a market comparison after a model-only request", async () => {
    const delivered = await deliver({
      answer: `${CELTIC_BODY}\n\n**Market comparison**\nKalshi prices Celtic at 55.4%.`,
      tier: "match",
      grounding: celtic,
      bundle: emptyBundle(),
      evidenceRequired: false,
      question: "Which side has the stronger model case, and why? Use model evidence only.",
    });
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain("I make **Celtic 66.9%**");
    expect(delivered.answer).not.toMatch(/kalshi|polymarket|market comparison|market gap/i);
  });

  it("adds nothing when the model already stated a gap, however phrased", async () => {
    const phrasings = [
      "Kalshi has Celtic at 55.4%, some 11.5 points below the model.",
      "The model is about 11 percentage points higher than the market on Celtic.",
      "Against the market, Pundit is 11.4 higher on the home win.",
      // A different leg is still a divergence: the reader was told where a gap is.
      "The model is 8.4 percentage points under the market on LASK.",
      // The gap ahead of the source name, and the source name ahead of the gap.
      // Neither quotes a price, so neither is the market guard's business.
      "The model is 11.5 percentage points higher than Kalshi on Celtic.",
      "Kalshi sits 11.5 percentage points below the model on Celtic.",
    ];
    for (const line of phrasings) {
      const delivered = await deliverCeltic(
        CELTIC_BODY.replace("**Goals**", `${line}\n\n**Goals**`)
      );
      expectDeliverable(delivered.answer, true);
      expect(delivered.answer).not.toContain("the widest gap between the two");
      // Exactly one statement of the gap, which is the model's own.
      expect(delivered.answer).toContain(
        normalizeAnalystIdentity(line).split(",")[0].split(" than")[0].slice(0, 20)
      );
    }
  });

  /**
   * Never invent a market. With no source, or with one too stale for the market
   * guard to vouch for, there is no divergence to state and the answer must
   * arrive exactly as written.
   */
  it("says nothing about a market it does not have", async () => {
    /**
     * The same re-targeting as above, and for the same reason: this test's
     * subject is the market, and byte-identity was only ever a convenient way
     * to say "nothing about a market was added". The conditional close is added
     * to a full match read whatever the payload holds, so the market property
     * is now stated directly -- no source named, no gap, no value verdict --
     * and the close is checked to be anchored on the model's own lean rather
     * than on an edge Pundit is in no position to claim.
     */
    const expectNoMarketInvented = (answer: string) => {
      const voicedBody = normalizeAnalystIdentity(CELTIC_BODY);
      expect(answer.startsWith(voicedBody)).toBe(true);
      const appended = answer.slice(voicedBody.length);
      expect(appended).not.toMatch(/kalshi|polymarket|market/i);
      expect(appended).not.toMatch(/percentage points|the value is on|priced/i);
      expect(appended).toContain("my lean towards Celtic");
      expect(statesConditionalClose(appended)).toBe(true);
    };

    const unpriced = await deliverCeltic(CELTIC_BODY, { ...celtic, oddsSources: [] });
    expectNoMarketInvented(unpriced.answer);

    const stale = await deliverCeltic(CELTIC_BODY, {
      ...celtic,
      oddsSources: [{
        source: "kalshi",
        observedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        pHome: 0.554,
        pDraw: 0.238,
        pAway: 0.208,
      }],
    });
    expectNoMarketInvented(stale.answer);

    const partial = await deliverCeltic(CELTIC_BODY, {
      ...celtic,
      oddsSources: [{
        source: "kalshi",
        observedAt: new Date().toISOString(),
        pHome: 0.554,
        pDraw: null,
        pAway: 0.208,
      }],
    });
    expectNoMarketInvented(partial.answer);
  });

  /**
   * The composed sentence has to survive the same chain it bypasses. It is
   * built from the validated record, so re-running the settled answer through
   * the guards must be a no-op -- checked on a `uefa.champions_qual` fixture,
   * where the qualifier points rewrites also run over the word "points".
   */
  it("composes a sentence the guard chain returns unchanged", async () => {
    const delivered = await deliverCeltic(CELTIC_BODY);
    expect(sanitizeDeliveredAnswer(delivered.answer, "match", celtic))
      .toBe(delivered.answer);
  });

  it("counts model non-compliance so the prompt layer can be measured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await deliverCeltic(CELTIC_BODY);
    await deliverCeltic(CELTIC_BODY.replace(
      "**Goals**",
      "Kalshi has Celtic at 55.4%, some 11.5 points below the model.\n\n**Goals**"
    ));
    const counted = log.mock.calls
      .map(([line]) => { try { return JSON.parse(String(line)); } catch { return {}; } })
      .filter((entry) => entry.event === "match_divergence_guarantee");
    // The verdict and the close are counted alongside the divergence, because
    // they are floors under the same prompt instruction and the insertion rate
    // is the only read available on whether the prompt layer is working.
    expect(counted).toEqual([
      { event: "match_divergence_guarantee", tier: "match", source: "kalshi", outcome: "home", gapPoints: 11.5, stated: false, inserted: true, statedValueVerdict: false, statedConditionalClose: false },
      { event: "match_divergence_guarantee", tier: "match", source: "kalshi", outcome: "home", gapPoints: 11.5, stated: true, inserted: false, statedValueVerdict: false, statedConditionalClose: false },
    ]);
    log.mockRestore();
  });

  /**
   * A divergence the model stated in its own words reaches the user in its own
   * words, and exactly once.
   *
   * "The model is 11.5 percentage points higher than Kalshi on Celtic" quotes
   * no market price at all -- only the difference between two probabilities --
   * so the market guard has nothing to validate and nothing to object to. This
   * assertion previously ran the other way: it required the sentence to be
   * deleted and the server's own copy substituted, because the guard read the
   * gap figure as an unattributable price purely on word order. That was the
   * defect, not the contract; the guarantee is the floor under a missing
   * divergence, never a reason to overwrite one the model supplied.
   */
  it("keeps a divergence the model stated in its own words, once", async () => {
    const stated = "The model is 11.5 percentage points higher than Kalshi on Celtic.";
    const delivered = await deliverCeltic(CELTIC_BODY.replace(
      "**Goals**",
      `${stated}\n\n**Goals**`
    ));
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain(normalizeAnalystIdentity(stated));
    // `statesMarketDivergence` recognises it, so no second copy is appended.
    expect(delivered.answer).not.toContain("the widest gap between the two");
    expect(delivered.answer.match(/11\.5 percentage points/g)).toHaveLength(1);
    // And it is stable: re-running the settled answer changes nothing.
    expect(sanitizeDeliveredAnswer(delivered.answer, "match", celtic))
      .toBe(delivered.answer);
  });

  it("gives the grounded fallback the divergence too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const delivered = await deliverAnswer({
      answer: "**Verdict**",
      tier: "match",
      grounding: celtic,
      bundle: emptyBundle(),
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question: "Celtic vs LASK second leg",
      evidenceRequired: false,
      candidateUnrecognized: false,
    });
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain("11.5 percentage points higher");
    warn.mockRestore();
  });
});

/**
 * The two things a good match answer does that a correct one need not, and
 * that MiniMax supplied only sometimes.
 *
 * The divergence repair established the pattern: what the server can determine,
 * the server determines, and the prompt keeps the writing. These follow it, and
 * the split between them is drawn at derivability.
 *
 * The value verdict is derivable. Given the signed gaps and a noise band, which
 * outcome the value is on and which are priced about right is arithmetic, so
 * the floor under it is exact -- including the answer nobody wants to give,
 * that the fixture is efficiently priced and there is nothing to take.
 *
 * The conditional close is NOT derivable. Which unknown matters most is a
 * judgement, and the server has no basis for it. What it can guarantee is
 * presence: a match answer that ends without saying what would move the read is
 * incomplete, and the composed fallback names the one unknown that is
 * unresolved on every pre-match fixture by construction -- who starts -- while
 * asserting nothing about who is fit.
 *
 * The probe these were built against was an answer that stated the divergence
 * and did neither, and it passed through the whole chain untouched.
 */
describe("the verdict and the close a match answer must carry", () => {
  const celticFixture = (overrides: Partial<Grounding> = {}): Grounding => ({
    ...buildGrounding(fixture("Celtic", "LASK", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      pHome: 0.669,
      pDraw: 0.208,
      pAway: 0.124,
    })),
    oddsSources: [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: 0.238, pAway: 0.208 },
      { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.565, pDraw: 0.235, pAway: 0.2 },
    ],
    ...overrides,
  });

  /** Model 66.9/20.8/12.4 against Kalshi 55.4/23.8/20.8 and Polymarket. */
  const priced = celticFixture();

  /** The same fixture with every leg inside the two-point agreement band. */
  const efficient = celticFixture({
    oddsSources: [{
      source: "kalshi",
      observedAt: new Date().toISOString(),
      pHome: 0.675,
      pDraw: 0.2,
      pAway: 0.125,
    }],
  });

  /**
   * The reproduction probe: a realistic answer that states the divergence in
   * the model's own words, gives no verdict on it, and ends in a dead end.
   */
  const DIVERGENCE_ONLY = [
    "**Model vs market**",
    "Pundit's model makes **Celtic 66.9%**, the **draw 20.8%** and **LASK 12.4%** for the"
      + " 2 August 2026 fixture. The model is 11.5 percentage points higher than Kalshi on Celtic.",
    "",
    "**Goals**",
    "**Over 2.5 at 55.0%** and **both teams to score at 52.0%**.",
    "",
    "**Likely scorelines**",
    "**1-1 (12.0%)** leads.",
    "",
    "**Team news**",
    "No verified team-news update was established for this fixture.",
  ].join("\n");

  const deliverCeltic = (answer: string, grounding: Grounding = priced) => deliver({
    answer,
    tier: "match",
    grounding,
    bundle: emptyBundle(),
    evidenceRequired: false,
    question: "Celtic vs LASK second leg",
  });

  it("rules on where the value is when the model only stated the gap", async () => {
    const delivered = await deliverCeltic(DIVERGENCE_ONLY);
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain(
      "I rate Celtic higher than the market does; the market rates the draw and LASK"
      + " higher than I do."
    );
    // A verdict is a direction, not a second recital: the sizes were stated one
    // sentence earlier, and every figure it repeated would be one the market
    // guard has to attribute to a source.
    const verdict = delivered.answer.split("\n")
      .flatMap((line) => line.split(". "))
      .find((sentence) => sentence.includes("I rate Celtic higher"))!;
    expect(verdict).not.toMatch(/\d/);
    // It lands beside the gap it judges, not as a trailing aside.
    expect(delivered.answer.split("\n")[1]).toContain("I rate Celtic higher");
    // The calibration the verdict was missing: a gap is a disagreement to
    // explain, not a side to back.
    expect(delivered.answer).toContain("not a recommendation to back anything");
    // The model's own divergence sentence is untouched and still stated once.
    expect(delivered.answer.match(/11\.5 percentage points/g)).toHaveLength(1);
  });

  it("calls an efficiently priced fixture efficiently priced", async () => {
    const delivered = await deliverCeltic(DIVERGENCE_ONLY, efficient);
    expectDeliverable(delivered.answer, true);
    // Saying there is no edge is a finding, and the one the prompt is most
    // likely to talk itself out of. Every leg here is inside the band, so the
    // floor must produce the abstention rather than dress 0.8 points as value.
    expect(delivered.answer).toContain(
      "No outcome here is more than two percentage points from the market, so my"
      + " view and the market agree across the board."
    );
    expect(delivered.answer).not.toContain("The value is on");
    expect(delivered.answer).not.toMatch(/\bworth backing\b|\bedge to take\b/i);
  });

  it("replaces a tip with the calibrated verdict instead of keeping it", async () => {
    // Pundit prices no stake and sees no execution price. A recommendation is
    // dropped and the server's own direction-only verdict is inserted in its
    // place, so the answer still carries a verdict -- just not a bet.
    const delivered = await deliverCeltic(
      DIVERGENCE_ONLY.replace("**Goals**", "The value is on Celtic and the draw looks overpriced.\n\n**Goals**")
    );
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).not.toContain("The value is on Celtic");
    expect(delivered.answer).toContain("I rate Celtic higher");
    expect(delivered.answer).toContain("not a recommendation to back anything");
  });

  it("keeps the comparison when only a trailing clause was the tip", async () => {
    // "LASK are priced above where the model has them" is a divergence
    // statement; only what follows it is a recommendation.
    const delivered = await deliverCeltic(
      DIVERGENCE_ONLY.replace("**Goals**",
        "LASK are priced above where the model has them, so there is nothing to take there.\n\n**Goals**")
    );
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain("LASK are priced above where I have them");
    expect(delivered.answer).not.toContain("nothing to take");
  });

  it("adds no second verdict when the model already gave one, however phrased", async () => {
    // Phrasings that report a comparison rather than recommend a bet. A tip is
    // no longer one of these: it is removed, and the server's own calibrated
    // verdict takes its place, which the test below covers.
    const phrasings = [
      "The moneyline is efficiently priced -- skip it.",
      "Kalshi's price on the draw is generous relative to the model.",
      "There is no real edge on the away win at this price.",
      "Celtic look cheap against the market here.",
    ];
    for (const line of phrasings) {
      expect(statesValueVerdict(line, priced)).toBe(true);
      const delivered = await deliverCeltic(
        DIVERGENCE_ONLY.replace("**Goals**", `${line}\n\n**Goals**`)
      );
      expectDeliverable(delivered.answer, true);
      expect(delivered.answer).not.toContain("The model rates Celtic higher than the market does;");
      expect(delivered.answer).not.toContain("looks efficiently priced and there is no edge");
    }
  });

  /**
   * The other half of the detector. Its error budget runs the opposite way to
   * `statesMarketDivergence`'s: a false positive there costs a duplicated
   * sentence, one here costs the verdict entirely. So the ambiguous words --
   * "edge", "value" -- are only a verdict beside a price, and these are the
   * sentences that must NOT suppress the floor.
   */
  it("does not mistake a statement about the model's favourite for a verdict", () => {
    for (const line of [
      "The model gives Celtic the edge in this tie.",
      "Celtic's edge comes from a stronger squad rather than the venue.",
      "**Value**",
      "Pundit's model makes Celtic 66.9%, the draw 20.8% and LASK 12.4%.",
    ]) {
      expect(statesValueVerdict(line, priced)).toBe(false);
    }
  });

  it("closes on what would change the read when the answer ends in a dead end", async () => {
    const delivered = await deliverCeltic(DIVERGENCE_ONLY);
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain("**What would change this**");
    expect(delivered.answer).toContain(
      "A material change to the club-strength inputs or fixture context would require a refreshed forecast"
    );
    expect(delivered.answer).toContain("does not quantify lineup counterfactuals");
    // It invents nothing. No player, absence, injury or uncomputed direction.
    // The model's dead-end team-news line is left exactly as written.
    expect(delivered.answer).toContain("No verified team-news update was established");
    expect(delivered.answer).not.toMatch(/\b(?:injur|suspend|doubtful|ruled out|sidelined)/i);
    expect(statesConditionalClose(delivered.answer)).toBe(true);
  });

  it("adds no second close when the model already wrote one", async () => {
    const phrasings = [
      "If the first-choice back line starts, the gap holds; if two are missing, that gap"
        + " is the first thing to shrink.",
      "A confirmed lineup would change this read either way.",
      "Unless Celtic rotate heavily, the model's edge stands.",
      "Until the team sheets land, treat the gap on the home win as provisional -- it"
        + " narrows quickly if the back line changes.",
    ];
    for (const line of phrasings) {
      expect(statesConditionalClose(line)).toBe(true);
      const delivered = await deliverCeltic(`${DIVERGENCE_ONLY}\n\n${line}`);
      expectDeliverable(delivered.answer, true);
      expect(delivered.answer).not.toContain("**What would change this**");
      expect(delivered.answer).not.toContain("Confirmed team sheets are what would move this");
    }
  });

  it("does not read an ordinary conditional as a close", () => {
    for (const line of [
      "Celtic should hold on if they score first.",
      "If the game stays open, 2-1 is the most likely finish.",
    ]) {
      expect(statesConditionalClose(line)).toBe(false);
    }
  });

  /**
   * A one-line follow-up is complete as written. Appending "what would change
   * this" to "About 26.3%." would be machinery, which is precisely the failure
   * the raw-timestamp recital was removed for.
   */
  it("leaves a short follow-up without a section it does not need", async () => {
    const answer = "Celtic are the side the model prefers here, at **66.9%** against LASK's 12.4%.";
    const delivered = await deliverAnswer({
      answer,
      tier: "match",
      grounding: priced,
      bundle: emptyBundle(),
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question: "Why?",
      evidenceRequired: false,
      candidateUnrecognized: false,
    });
    expect(delivered.answer).not.toContain("**What would change this**");
    expect(delivered.answer).not.toContain("Confirmed team sheets");
  });

  /**
   * Everything composed has to survive the chain it is added after. Checked on
   * a `uefa.champions_qual` fixture, where the qualifier points rewrites run
   * over the word "points" and the market guard runs over every figure --
   * a sentence the guards strip is worse than no sentence.
   */
  it("composes prose the guard chain returns unchanged", async () => {
    for (const grounding of [priced, efficient, celticFixture({ oddsSources: [] })]) {
      const delivered = await deliverCeltic(DIVERGENCE_ONLY, grounding);
      expect(sanitizeDeliveredAnswer(delivered.answer, "match", grounding))
        .toBe(delivered.answer);
      // And the composed prose is prose: no leaked field names, no ISO stamp,
      // no bare source header standing where a sentence belongs.
      expect(delivered.answer).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(delivered.answer).not.toMatch(/gapPoints|marketPercent|modelPercent/);
      expectDeliverable(delivered.answer, true);
    }
  });

  it("gives the grounded fallback the verdict and the close too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const delivered = await deliverAnswer({
      answer: "**Verdict**",
      tier: "match",
      grounding: priced,
      bundle: emptyBundle(),
      client: clientWith(message("unused", "end_turn")) as Pick<Anthropic, "messages">,
      question: "Celtic vs LASK second leg",
      evidenceRequired: false,
      candidateUnrecognized: false,
    });
    expectDeliverable(delivered.answer, true);
    expect(delivered.answer).toContain("11.5 percentage points higher");
    expect(delivered.answer).toContain("I rate Celtic higher");
    expect(statesConditionalClose(delivered.answer)).toBe(true);
    expect(sanitizeDeliveredAnswer(delivered.answer, "match", priced))
      .toBe(delivered.answer);
    warn.mockRestore();
  });
});
