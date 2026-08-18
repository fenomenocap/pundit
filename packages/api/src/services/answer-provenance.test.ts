import { describe, expect, it } from "vitest";
import {
  mapEvidenceRegions,
  segmentAnswer,
  splitAnswerSentences,
  splitPriceSafeSentences,
  TEAM_NEWS_CLAIM,
} from "./answer-provenance";

describe("splitPriceSafeSentences", () => {
  it("does not split a decimal price", () => {
    expect(splitPriceSafeSentences("The home win is 3.40 and the away win 3.60."))
      .toEqual(["The home win is 3.40 and the away win 3.60."]);
    expect(splitPriceSafeSentences("Arsenal win 56.3%. Draw 24.1%."))
      .toEqual(["Arsenal win 56.3%. ", "Draw 24.1%."]);
  });

  it("returns pieces that rejoin into the original line", () => {
    const line = "One.  Two! Three?   Four";
    expect(splitPriceSafeSentences(line).join("")).toBe(line);
  });

  it("has nothing to split in an empty line", () => {
    expect(splitPriceSafeSentences("")).toEqual([]);
  });
});

describe("splitAnswerSentences", () => {
  it("trims the sentences and drops the empties", () => {
    expect(splitAnswerSentences("  One.   Two.  ")).toEqual(["One.", "Two."]);
  });

  it("rejoins a marker-only fragment onto the sentence it cites", () => {
    expect(splitAnswerSentences("Saka is out. [[S1]]"))
      .toEqual(["Saka is out. [[S1]]"]);
    expect(splitAnswerSentences("Saka is out. [[S1]] [[S2]]"))
      .toEqual(["Saka is out. [[S1]] [[S2]]"]);
  });

  it("keeps a leading marker fragment rather than losing it", () => {
    expect(splitAnswerSentences("[[S1]]")).toEqual(["[[S1]]"]);
  });

  it("treats a line break as a sentence boundary", () => {
    expect(splitAnswerSentences("**Team news**\nSaka is injured [[S1]]."))
      .toEqual(["**Team news**", "Saka is injured [[S1]]."]);
  });
});

describe("TEAM_NEWS_CLAIM", () => {
  it("matches squad availability language", () => {
    for (const text of [
      "Saka is injured.",
      "Rice is suspended.",
      "Odegaard is doubtful.",
      "Havertz has been ruled out.",
      "Timber is sidelined.",
      "The starting XI is unchanged.",
      "The lineup is confirmed.",
      "Jesus returns from a knee problem.",
      "Tomiyasu is fit again.",
      "White picked up a knock.",
    ]) {
      expect(TEAM_NEWS_CLAIM.test(text), text).toBe(true);
    }
  });

  it("does not match ordinary model prose", () => {
    for (const text of [
      "Pundit's model gives Arsenal 56.3%.",
      "The draw is priced at 3.40.",
      "Arsenal are the stronger side on Elo.",
      "This is a close fixture with a narrow home edge.",
    ]) {
      expect(TEAM_NEWS_CLAIM.test(text), text).toBe(false);
    }
  });
});

describe("segmentAnswer", () => {
  it("tiles the answer exactly", () => {
    const answer = "**Verdict**\n\nArsenal win 56.3%. Saka is injured [[S1]].\n\nKick-off is Saturday.";
    const segments = segmentAnswer(answer);
    expect(segments.map((segment) => segment.text).join("")).toBe(answer);
    for (const segment of segments) {
      expect(answer.slice(segment.start, segment.end)).toBe(segment.text);
    }
  });

  it("leaves model-grounded prose as model", () => {
    const segments = segmentAnswer("Pundit's model gives Arsenal 56.3%, the draw 24.1%.");
    expect(segments.map((segment) => segment.provenance)).toEqual(["model"]);
  });

  it("classifies a cited sentence as evidence and its neighbours as model", () => {
    const answer = "Arsenal win 56.3%. Saka is out [[S1]]. The model still favours the hosts.";
    const segments = segmentAnswer(answer);
    const evidence = segments.filter((segment) => segment.provenance === "evidence");
    expect(evidence.map((segment) => segment.text.trim())).toEqual(["Saka is out [[S1]]."]);
    expect(segments.some((segment) =>
      segment.provenance === "model" && segment.text.includes("56.3%"))).toBe(true);
    expect(segments.some((segment) =>
      segment.provenance === "model" && segment.text.includes("favours the hosts"))).toBe(true);
  });

  it("classifies an uncited squad claim as evidence", () => {
    const segments = segmentAnswer("Arsenal win 56.3%. Rice is suspended for this one.");
    expect(segments.filter((segment) => segment.provenance === "evidence")
      .map((segment) => segment.text.trim())).toEqual(["Rice is suspended for this one."]);
  });

  it("classifies a squad claim hidden inside a Verdict section as evidence", () => {
    // The safety property: a section label never launders a claim about the
    // outside world into model output.
    const answer = "**Verdict**\n\nArsenal are the pick at 56.3%, and Saka is ruled out.";
    const segments = segmentAnswer(answer);
    const claim = segments.find((segment) => segment.text.includes("ruled out"));
    expect(claim?.provenance).toBe("evidence");
    expect(segments.find((segment) => segment.text.includes("**Verdict**"))?.provenance)
      .toBe("model");
  });

  it("classifies plain sentences under a team-news label as evidence", () => {
    const answer = "**Team news**\n\nBoth sides name unchanged sides.\n\n"
      + "**Verdict**\n\nArsenal win 56.3%.";
    const byText = new Map(segmentAnswer(answer).map((segment) => [segment.text.trim(), segment.provenance]));
    expect(byText.get("**Team news**")).toBe("evidence");
    expect(byText.get("Both sides name unchanged sides.")).toBe("evidence");
    expect(byText.get("**Verdict**")).toBe("model");
    expect(byText.get("Arsenal win 56.3%.")).toBe("model");
  });

  it("ends the team-news section at the next label", () => {
    const answer = "**Injuries**\n\nNothing new to report.\n\n**Model**\n\nArsenal win 56.3%.";
    const byText = new Map(segmentAnswer(answer).map((segment) => [segment.text.trim(), segment.provenance]));
    expect(byText.get("Nothing new to report.")).toBe("evidence");
    expect(byText.get("Arsenal win 56.3%.")).toBe("model");
  });

  it("never classifies whitespace as a claim", () => {
    for (const segment of segmentAnswer("**Team news**\n\n   \n\nSaka is out.")) {
      if (!/[\p{L}\p{N}]/u.test(segment.text)) expect(segment.provenance).toBe("model");
    }
  });

  it("does not split a decimal price across segments", () => {
    const segments = segmentAnswer("The home price is 3.40 and the draw 4.20.");
    expect(segments).toHaveLength(1);
  });

  it("segments an empty answer into nothing", () => {
    expect(segmentAnswer("")).toEqual([]);
  });
});

describe("mapEvidenceRegions", () => {
  it("returns the answer unchanged under an identity map", () => {
    const answer = "**Verdict**\n\nArsenal win 56.3%.\n\n**Team news**\n\nSaka is out [[S1]].";
    expect(mapEvidenceRegions(answer, (text) => text)).toBe(answer);
  });

  it("rewrites only the evidence regions", () => {
    const answer = "Arsenal win 56.3%. Saka is out [[S1]]. The hosts remain favourites.";
    expect(mapEvidenceRegions(answer, () => "")).toBe("Arsenal win 56.3%. The hosts remain favourites.");
  });

  it("cannot touch model prose even when the map deletes everything", () => {
    const answer = "Pundit's model gives Arsenal 56.3%, the draw 24.1% and Chelsea 19.6%.";
    expect(mapEvidenceRegions(answer, () => "")).toBe(answer);
  });
});
