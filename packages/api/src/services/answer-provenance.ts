/**
 * Where a piece of an answer came from.
 *
 * The guard layer around `POST /api/ask` was written as if every sentence in a
 * generated answer were a claim about the outside world, so web-evidence
 * verification was applied to prose that was produced from Pundit's own model
 * grounding and never touched a search result. This module supplies the
 * missing distinction: it splits an answer into sentences and labels each one
 * `"model"` or `"evidence"`, so a guard can be pointed at the evidence-derived
 * text alone and leave the model's own output intact.
 *
 * Nothing here decides what to do with a segment -- classification only.
 */

/**
 * Sentence split that survives prices. The naive
 * `/[^.!?\n]+(?:[.!?]+|$)/g` treats the point in "3.40" as a full stop, which
 * would leave "40 and the away win at 3.60." behind after a removal. A
 * terminator only ends a sentence when it is not between two digits and is
 * followed by whitespace or end of line. Trailing whitespace stays inside each
 * piece so the surviving pieces rejoin into the original line.
 */
export function splitPriceSafeSentences(line: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (!/[.!?]/.test(line[index])) continue;
    if (line[index] === "."
      && /\d/.test(line[index - 1] ?? "")
      && /\d/.test(line[index + 1] ?? "")) continue;
    let end = index + 1;
    while (end < line.length && /[.!?]/.test(line[end])) end += 1;
    if (end < line.length && !/\s/.test(line[end])) continue;
    while (end < line.length && /\s/.test(line[end])) end += 1;
    sentences.push(line.slice(start, end));
    start = end;
    index = end - 1;
  }
  if (start < line.length) sentences.push(line.slice(start));
  return sentences;
}

/**
 * A fragment that is nothing but server-owned citation markers. The generator
 * sometimes emits the marker after the terminator, which leaves the split with
 * a "sentence" carrying the provenance of the sentence before it and no words
 * of its own.
 */
const MARKER_ONLY_FRAGMENT = /^(?:\[\[S\d+\]\]\s*)+$/;

/** Any server-owned citation marker. */
export const CITATION_MARKER = /\[\[S\d+\]\]/;

/**
 * The answer split into trimmed sentences, with orphaned citation markers
 * rejoined onto the sentence they belong to. Line breaks end a sentence: the
 * repo's answer format uses them as separators between labelled sections, and
 * a section body is not a continuation of the label above it.
 */
export function splitAnswerSentences(line: string): string[] {
  const pieces = line.split("\n").flatMap((part) => splitPriceSafeSentences(part));
  const joined: string[] = [];
  for (const sentence of pieces.map((value) => value.trim()).filter(Boolean)) {
    if (MARKER_ONLY_FRAGMENT.test(sentence) && joined.length) {
      joined[joined.length - 1] = `${joined[joined.length - 1]} ${sentence}`;
    } else {
      joined.push(sentence);
    }
  }
  return joined;
}

/**
 * A squad-availability claim -- the narrow class of statement that genuinely
 * needs an outside source, because Pundit's own grounding says nothing about
 * who is fit. Kept deliberately narrow: the point of this module is that a
 * pattern broad enough to match ordinary prose is indistinguishable from "verify
 * everything", which is what destroyed the answers in the first place.
 *
 * Canonical definition. `scripts/chat-battle-test-lib.mjs` carries its own copy
 * because it is plain ESM and cannot import this TypeScript module; keep the two
 * in step.
 */
export const TEAM_NEWS_CLAIM =
  /\b(?:injur\w*|suspend\w*|suspension|doubtful|ruled out|sidelined|unavailable for selection|starting (?:xi|eleven)|lineup|line-up|returns? from|fit again|knock|miss(?:es|ed|ing)?|absence|absent)\b/i;

/**
 * "Missing" and "absent" are the two words in `TEAM_NEWS_CLAIM` that are not
 * inherently about people. Pundit's own deterministic copy says a fixture is
 * "missing a required model input" and that "required model context or input is
 * missing" -- capability notices, not squad claims -- and a guard that deletes
 * unsourced team news deletes those too unless the object is checked. Every
 * other alternative in the pattern already names a footballing condition.
 */
export const NON_SQUAD_ABSENCE =
  /\b(?:miss(?:es|ed|ing)?|absent|absence)\b[^.!?\n]{0,40}\b(?:model|input|context|data|coverage|market|source|price|line|probabilit\w*|fixture|rating|evidence|citation)s?\b|\b(?:model|input|context|data|coverage|market|source|price|probabilit\w*|fixture|rating|evidence|citation)s?\b[^.!?\n]{0,40}\b(?:is|are|was|were)\s+(?:miss(?:ing)?|absent)\b/i;

/**
 * The squad-availability half of `TEAM_NEWS_CLAIM`: everything except a bare
 * "missing"/"absent" whose object is one of Pundit's own inputs.
 */
export function assertsSquadAvailability(sentence: string): boolean {
  if (!TEAM_NEWS_CLAIM.test(sentence)) return false;
  const absenceOnly = /\b(?:injur\w*|suspend\w*|suspension|doubtful|ruled out|sidelined|unavailable for selection|starting (?:xi|eleven)|lineup|line-up|returns? from|fit again|knock)\b/i;
  if (absenceOnly.test(sentence)) return true;
  return !NON_SQUAD_ABSENCE.test(sentence);
}

/** A standalone bold section label, e.g. `**Verdict**` or `**Verdict:**`. */
export const SECTION_LABEL_LINE = /^\s*\*\*[^*\n]+\*\*:?\s*$/;

/**
 * A section label that introduces squad availability. Broader than
 * `TEAM_NEWS_CLAIM` because a heading names its topic rather than asserting it:
 * "**Team news**" contains no availability verb at all.
 */
const TEAM_NEWS_SECTION_LABEL =
  /\b(?:team news|squad|availability|available|absent\w*|injur\w*|suspensions?|fitness|line-?up|starting (?:xi|eleven))\b/i;

export type Provenance = "model" | "evidence";

export interface AnswerSegment {
  text: string;
  provenance: Provenance;
  /** Offset of `text` in the answer it was segmented from. */
  start: number;
  /** Offset one past the end of `text`. Segments tile the answer exactly. */
  end: number;
}

/** Whitespace or punctuation with nothing to assert is never a claim. */
const HAS_SUBSTANCE = /[\p{L}\p{N}]/u;

/**
 * Splits `answer` into contiguous segments that tile it exactly -- concatenating
 * every `text` reproduces the input, byte for byte -- and labels each one.
 *
 * A sentence is `"evidence"` when it carries a citation marker, when it makes a
 * squad-availability claim, or when it sits under a team-news section label.
 * Everything else is `"model"`.
 *
 * The sentence-level rules apply inside every section, including `**Verdict**`.
 * A squad claim smuggled into a verdict paragraph is still a claim about the
 * outside world, and classifying it as model output would let it ship
 * unverified. That is the safety property this function exists to hold.
 */
export function segmentAnswer(answer: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let offset = 0;
  let inTeamNewsSection = false;

  const push = (text: string, provenance: Provenance) => {
    if (!text) return;
    segments.push({ text, provenance, start: offset, end: offset + text.length });
    offset += text.length;
  };

  const lines = answer.split("\n");
  lines.forEach((line, index) => {
    if (SECTION_LABEL_LINE.test(line)) {
      // A label opens a section and closes the one before it. The label itself
      // belongs to the region it introduces, so a team-news heading is part of
      // the evidence region rather than a stray piece of model prose.
      inTeamNewsSection = TEAM_NEWS_SECTION_LABEL.test(line);
      push(line, inTeamNewsSection ? "evidence" : "model");
    } else {
      for (const sentence of splitPriceSafeSentences(line)) {
        const substantive = HAS_SUBSTANCE.test(sentence);
        const evidence = substantive
          && (CITATION_MARKER.test(sentence)
            // Squad availability, not a bare "missing". Pundit's own capability
            // copy says a fixture is "missing a required model input"; if that
            // is filed as evidence, the abstention sweep replaces the server's
            // deterministic notice with "no verified team news was established".
            || assertsSquadAvailability(sentence)
            || inTeamNewsSection);
        push(sentence, evidence ? "evidence" : "model");
      }
    }
    if (index < lines.length - 1) push("\n", "model");
  });

  return mergeMarkerOnlyFragments(segments);
}

/**
 * A trailing "[[S1]]" split off as its own piece is not a separate claim -- it
 * is the provenance of the piece before it. Fold it back so a rewriter never
 * sees a citation marker detached from the sentence it cites.
 */
function mergeMarkerOnlyFragments(segments: AnswerSegment[]): AnswerSegment[] {
  const merged: AnswerSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous
      && MARKER_ONLY_FRAGMENT.test(segment.text.trim())
      && previous.end === segment.start
      && HAS_SUBSTANCE.test(previous.text)) {
      merged[merged.length - 1] = {
        text: `${previous.text}${segment.text}`,
        // The marker carries evidence provenance onto whatever it cites.
        provenance: "evidence",
        start: previous.start,
        end: segment.end,
      };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

/**
 * Rewrites only the evidence-derived regions of `answer`, returning model
 * segments exactly as they were. With an identity `fn` the answer is returned
 * unchanged.
 */
export function mapEvidenceRegions(answer: string, fn: (text: string) => string): string {
  return segmentAnswer(answer)
    .map((segment) => (segment.provenance === "evidence" ? fn(segment.text) : segment.text))
    .join("");
}
