import { RecognizedFixture } from "./fixture-registry";

/**
 * Two-legged ties resolve to one leg.
 *
 * Both legs of a tie carry the same two clubs, so "Dinamo Zagreb vs Viking"
 * matches two recognized fixtures and used to fail closed to the discovery
 * candidate tier -- the user got "no authoritative structured fixture identity"
 * and no probabilities for a fixture Pundit had priced all along. Every default
 * homepage suggestion chip was a two-legged tie, so that dead end sat on the
 * product's front door.
 *
 * The rule, in order:
 *   1. An explicit leg cue ("first leg", "return leg") picks by kickoff order.
 *   2. A date cue that identifies exactly one leg ("on the 26th", "Wednesday",
 *      "2026-08-26", "tomorrow") picks that leg.
 *   3. Otherwise the next leg to be played -- the earliest kickoff that has not
 *      finished. It is the leg a bare "X vs Y" means: the imminent one, and the
 *      only one whose result is still open. When every leg is already complete
 *      the most recent one wins instead, because a question asked after the tie
 *      is about the last thing that happened.
 *
 * Selection is refused, and the caller keeps failing closed, when the winning
 * kickoff instant is shared by more than one fixture. Real legs are never
 * simultaneous, so that is a data anomaly rather than a tie, and guessing
 * between two indistinguishable fixtures is exactly the silent wrong answer
 * this function exists to avoid.
 */
export function selectRecognizedLeg(
  question: string,
  matches: RecognizedFixture[],
  now: Date = new Date()
): RecognizedFixture | undefined {
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  const upcoming = matches.filter((fixture) => fixture.status !== "completed");
  const pool = upcoming.length > 0 ? upcoming : matches;
  const ordered = [...pool].sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  const legCue = explicitLegCue(question);
  if (legCue === "first") return unambiguous(ordered[0], ordered);
  if (legCue === "second") return unambiguous(ordered[ordered.length - 1], ordered);

  const dated = ordered.filter((fixture) => matchesDateCue(question, fixture.kickoff, now));
  if (dated.length === 1) return dated[0];

  // No cue: the next unplayed leg, or the most recent one once all have been
  // played.
  const chosen = upcoming.length > 0 ? ordered[0] : ordered[ordered.length - 1];
  return unambiguous(chosen, ordered);
}

function unambiguous(
  chosen: RecognizedFixture,
  ordered: RecognizedFixture[]
): RecognizedFixture | undefined {
  const sameInstant = ordered.filter((fixture) => fixture.kickoff === chosen.kickoff);
  return sameInstant.length === 1 ? chosen : undefined;
}

function explicitLegCue(question: string): "first" | "second" | undefined {
  const normalized = question.toLowerCase();
  if (/\b(?:first|1st|opening)\s+leg\b/.test(normalized)) return "first";
  if (/\b(?:second|2nd|return|reverse)\s+leg\b/.test(normalized)) return "second";
  return undefined;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

/**
 * Cues are matched against the kickoff's UTC calendar day. All Pundit kickoffs
 * are stored in UTC and the two legs of a tie are days apart, so a viewer's
 * local offset cannot flip which leg a date cue selects.
 */
function matchesDateCue(question: string, kickoff: string, now: Date): boolean {
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return false;
  const normalized = question.toLowerCase();

  const iso = date.toISOString().slice(0, 10);
  if (normalized.includes(iso)) return true;

  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const monthShort = month.slice(0, 3);
  const weekday = WEEKDAYS[date.getUTCDay()];
  const weekdayShort = weekday.slice(0, 3);

  // A bare number is not a date cue -- "over 2.5" and "the 26th" must not be
  // read the same way -- so the day only counts with an ordinal suffix or a
  // month beside it.
  const dayPatterns = [
    new RegExp(`\\b${day}(?:st|nd|rd|th)\\b`),
    new RegExp(`\\b(?:${month}|${monthShort})\\.?\\s+${day}(?:st|nd|rd|th)?\\b`),
    new RegExp(`\\b${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${month}|${monthShort})\\b`),
  ];
  if (dayPatterns.some((pattern) => pattern.test(normalized))) return true;

  if (new RegExp(`\\b(?:${weekday}|${weekdayShort})\\b`).test(normalized)) return true;

  const daysFromNow = Math.round(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
      - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    / 86_400_000
  );
  if (daysFromNow === 0 && /\b(?:today|tonight)\b/.test(normalized)) return true;
  if (daysFromNow === 1 && /\btomorrow\b/.test(normalized)) return true;

  return false;
}
