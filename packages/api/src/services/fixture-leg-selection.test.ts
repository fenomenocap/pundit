import { describe, expect, it } from "vitest";
import { selectRecognizedLeg } from "./fixture-leg-selection";
import { recognizeEspnFixture, type RecognizedFixture } from "./fixture-registry";

function leg(
  id: number,
  home: string,
  away: string,
  utcDate: string,
  status = "SCHEDULED"
): RecognizedFixture {
  return recognizeEspnFixture({
    id,
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifying",
    homeTeam: home,
    awayTeam: away,
    utcDate,
    status,
    stage: "qualifying",
    matchday: null,
    group: null,
    score: null,
    neutralVenue: false,
  });
}

const first = leg(1, "Dinamo Zagreb", "Viking", "2026-08-18T19:00:00.000Z");
const second = leg(2, "Viking", "Dinamo Zagreb", "2026-08-26T19:00:00.000Z");
const tie = [second, first];
const now = new Date("2026-08-17T09:00:00.000Z");

describe("selectRecognizedLeg", () => {
  it("returns the only fixture unchanged", () => {
    expect(selectRecognizedLeg("Dinamo Zagreb vs Viking", [first], now)).toBe(first);
  });

  it("defaults to the next leg to be played regardless of input order", () => {
    expect(selectRecognizedLeg("Dinamo Zagreb vs Viking", tie, now)).toBe(first);
  });

  it("reads leg cues", () => {
    expect(selectRecognizedLeg("first leg of Dinamo Zagreb vs Viking", tie, now)).toBe(first);
    expect(selectRecognizedLeg("second leg of Dinamo Zagreb vs Viking", tie, now)).toBe(second);
    expect(selectRecognizedLeg("the 2nd leg", tie, now)).toBe(second);
    expect(selectRecognizedLeg("the reverse leg", tie, now)).toBe(second);
  });

  it("reads absolute date cues", () => {
    expect(selectRecognizedLeg("on 2026-08-26", tie, now)).toBe(second);
    expect(selectRecognizedLeg("on the 26th", tie, now)).toBe(second);
    expect(selectRecognizedLeg("on 26 August", tie, now)).toBe(second);
    expect(selectRecognizedLeg("on Aug 18", tie, now)).toBe(first);
    expect(selectRecognizedLeg("on Wednesday", tie, now)).toBe(second);
    expect(selectRecognizedLeg("Tuesday's game", tie, now)).toBe(first);
  });

  it("reads relative date cues against the supplied clock", () => {
    expect(selectRecognizedLeg("tomorrow", tie, now)).toBe(first);
    expect(selectRecognizedLeg("tonight", tie, new Date("2026-08-18T09:00:00.000Z"))).toBe(first);
    expect(selectRecognizedLeg("tomorrow", tie, new Date("2026-08-25T09:00:00.000Z"))).toBe(second);
  });

  // A bare number is not a date: "over 2.5" and "the 26th" must not read alike,
  // and a cue matching both legs is no cue at all.
  it("ignores numbers that are not dates and cues that fit both legs", () => {
    expect(selectRecognizedLeg("over 2.5 goals", tie, now)).toBe(first);
    expect(selectRecognizedLeg("in August", tie, now)).toBe(first);
  });

  it("prefers the most recent leg once every leg is complete", () => {
    const played = [
      leg(1, "Dinamo Zagreb", "Viking", "2026-08-18T19:00:00.000Z", "FINISHED"),
      leg(2, "Viking", "Dinamo Zagreb", "2026-08-26T19:00:00.000Z", "FINISHED"),
    ];
    expect(selectRecognizedLeg("How did it go?", played, now)).toBe(played[1]);
  });

  // Two legs of a tie are never simultaneous, so identical kickoffs are a data
  // anomaly. Refusing keeps the caller failing closed instead of picking one of
  // two fixtures it cannot tell apart.
  it("refuses fixtures that share the winning kickoff instant", () => {
    const clash = [first, leg(3, "Viking", "Dinamo Zagreb", first.kickoff)];
    expect(selectRecognizedLeg("Dinamo Zagreb vs Viking", clash, now)).toBeUndefined();
    expect(selectRecognizedLeg("first leg", clash, now)).toBeUndefined();
  });

  it("returns nothing for an empty candidate list", () => {
    expect(selectRecognizedLeg("Dinamo Zagreb vs Viking", [], now)).toBeUndefined();
  });
});
