import { describe, expect, it } from "vitest";
import { sanitizeRuntimeResponseCorrectness, buildGrounding, type Grounding } from "./ask";
import { fixture } from "./__fixtures__/model-fixture";

/**
 * `sanitizeRuntimeResponseCorrectness` runs three times on the way to a single
 * delivered match answer -- once inside the common guard block of
 * `sanitizeAnswerForTier`, once again on the settled answer inside
 * `deliverAnswer`, and a third time when `sanitizeDeliveredAnswer` re-runs the
 * tier chain -- and nothing anywhere states that running it twice is the same as
 * running it once.
 *
 * That contract matters more than it sounds. A guard that only fires on pass two
 * removes content that pass one deliberately left alone, and it does so without
 * a test failing anywhere, because every test applies the guard exactly once.
 * Two of the four shipped answer-deletion bugs were of that shape: correct on
 * the text they were written against, destructive on the text a previous guard
 * had already rewritten.
 *
 * The fix is not to delete a call site. A guard that fires only on pass two is a
 * real defect and removing the second pass would hide it rather than fix it, so
 * every call site stays and the property is asserted instead.
 */

const matchGrounding: Grounding = buildGrounding(fixture("Arsenal", "Coventry City"));

/**
 * Realistic answers across the classes the guard actually rewrites: intact
 * model prose, quoted markets, abstentions, orphaned labels, external prices,
 * contradictory rationales, and the football-geometry claim.
 */
const ANSWERS: Array<{ name: string; text: string; grounding?: Grounding }> = [
  {
    name: "intact match answer",
    grounding: matchGrounding,
    text: [
      "**Verdict**",
      "Pundit's model makes **Arsenal the favourite at 40.0%**, with the **draw at 30.0%**"
        + " and **Coventry City at 30.0%** for the 2 August 2026 fixture.",
      "",
      "**Goals**",
      "**Over 2.5 at 55.0%** and **both teams to score at 52.0%** point to an open game.",
      "",
      "**Likely scorelines**",
      "**1-1 (12.0%)** leads, with **3-2 (1.1%)** among the outside results.",
    ].join("\n"),
  },
  {
    name: "answer stating no market line is available",
    grounding: matchGrounding,
    text: "**Verdict**\nNo Kalshi market is available.\nArsenal win **40.0%**, draw **30.0%**,"
      + " Coventry City **30.0%**.\nOver 2.5 sits at **55.0%**.",
  },
  {
    name: "answer quoting a complete named market",
    grounding: matchGrounding,
    text: "**Market**\nKalshi prices Arsenal at 41.0%, the draw at 32.4% and Coventry City at"
      + " 26.6%, so the model is about a point keener on the home win.",
  },
  {
    name: "answer quoting an uncited external bookmaker price",
    grounding: matchGrounding,
    text: "**Verdict**\nKalshi has Arsenal at 62% and the bookmakers price the draw at 3.40."
      + "\n\n**Read on the underdog**\nCoventry City need an early goal.",
  },
  {
    name: "answer with an incomplete external market",
    grounding: matchGrounding,
    text: "**Market**\nThe home win is available at 1.85 with one book, though no matching draw"
      + " or away price was found at the same time.",
  },
  {
    name: "abstaining answer",
    grounding: matchGrounding,
    text: "**Verdict**\nArsenal win **40.0%**, draw **30.0%**, Coventry City **30.0%**."
      + "\n\n**Team news**\nNo verified team-news update was established for this fixture.",
  },
  {
    name: "answer left with an orphaned section label",
    grounding: matchGrounding,
    text: "**Verdict**\n\n**Likely scorelines**\n**1-1 (12.0%)** leads.",
  },
  {
    name: "answer with contradictory directional rationales",
    grounding: matchGrounding,
    text: "**Read**\nThe home side's midfield gives it an edge.\nThe away side's midfield gives"
      + " it an advantage.\nThe matchup remains close.",
  },
  {
    name: "answer with the reversed high-line claim",
    text: "**Tactics**\nA higher defensive line shrinks the space behind the defenders, so the"
      + " press is safer than it looks.",
  },
  {
    name: "answer attributing a stale manager era",
    text: "**History**\nThe 2019 win came during Wrong Manager's tenure, which colours the"
      + " head-to-head record.",
  },
  {
    name: "answer with a market table written as prose",
    grounding: matchGrounding,
    text: "**Market**\nStake market: home 99%, draw 0.5%, away 0.5%.\nThat is far from the"
      + " model's own read.",
  },
  {
    name: "answer citing dated sources",
    grounding: matchGrounding,
    text: "**Team news**\nCoventry City's keeper is suspended ([Coventry team news]"
      + "(https://example.com/a), 2026-08-01).",
  },
  {
    name: "answer with decimal prices inside prose",
    grounding: matchGrounding,
    text: "**Prices**\nThe home win trades around 2.10, the draw at 3.40 and the away side"
      + " at 3.60 across the books checked.",
  },
  {
    name: "competition answer with no grounding",
    text: "**Table**\nArsenal lead on **21 points** from 9 games, two clear of Chelsea on"
      + " **19 points**.\n\n**Read**\nThe gap says little this early.",
  },
  {
    name: "general answer with no numbers at all",
    text: "**The offside law**\nA player is offside when any part of the head, body or feet"
      + " with which a goal can be scored is nearer the opponents' goal line than both the"
      + " ball and the second-last opponent at the moment the ball is played.",
  },
];

describe("sanitizeRuntimeResponseCorrectness is idempotent", () => {
  // A property test rather than fifteen cases: the interesting failure is a
  // guard that fires on its own output, and which input exposes it is not
  // something a hand-written case list can predict.
  for (const { name, text, grounding } of ANSWERS) {
    it(`f(f(x)) === f(x) for a ${name}`, () => {
      const once = sanitizeRuntimeResponseCorrectness(text, grounding);
      const twice = sanitizeRuntimeResponseCorrectness(once, grounding);
      expect(twice).toBe(once);
      // The third pass matters on its own: the delivery path really does run
      // this guard three times per match request.
      expect(sanitizeRuntimeResponseCorrectness(twice, grounding)).toBe(once);
    });
  }
});
