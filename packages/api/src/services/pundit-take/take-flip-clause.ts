import type { Grounding } from "../ask";
import type { PunditTakePlan, TakePlanGridCall } from "./types";

const INVALID_FLIP_PATTERN =
  /\bwould shift me\b|\bpoints to a clearer favourite\b|\bapplied in this forecast\b|\bWhy:|Risk:|Lean:/i;

const PAST_FORM_PATTERN =
  /\bhave scored \d+ across\b|\bhave leaked \d+ in their last\b|\bOver their last \d+ league games\b/i;

/** Condition-only fragment suitable after "I'd shift if …". */
export function isCleanFlipClause(body: string): boolean {
  const t = body.trim();
  if (!t || t.length > 140) return false;
  if (INVALID_FLIP_PATTERN.test(t)) return false;
  if (PAST_FORM_PATTERN.test(t)) return false;
  if ((t.match(/[.!?]/g) ?? []).length > 1) return false;
  if (/^A cagey\b/i.test(t)) return false;
  return true;
}

export function normalizeFlipClause(raw: string, home: string, away: string): string | null {
  let t = raw.trim().replace(/\.$/, "");
  if (!t) return null;

  const homeEsc = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const awayEsc = away.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const homePast = new RegExp(
    `${homeEsc} have scored (\\d+) across their last (\\d+) league games(?: at this venue stretch)?`,
    "i",
  );
  const mHome = t.match(homePast);
  if (mHome) {
    t = `${home} keep scoring in league play (${mHome[1]} in their last ${mHome[2]}).`;
  }

  const homeLeaky = new RegExp(
    `${homeEsc} have leaked (\\d+) in their last (\\d+) league games`,
    "i",
  );
  const mLeaky = t.match(homeLeaky);
  if (mLeaky) {
    t = `${home} leak more than a goal a game over their last ${mLeaky[2]} league outings.`;
  }

  const awayPast = new RegExp(
    `${awayEsc} have scored (\\d+) across their last (\\d+) league games`,
    "i",
  );
  const mAway = t.match(awayPast);
  if (mAway) {
    t = `${away} keep scoring in league play (${mAway[1]} in their last ${mAway[2]}).`;
  }

  t = t.replace(/\bat this venue stretch\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return isCleanFlipClause(t) ? t : null;
}

export function genericMarketFlipFallback(
  plan: PunditTakePlan,
  grounding: Grounding,
  gridCall: TakePlanGridCall | null,
): string {
  if (gridCall?.sideKey === "under") {
    return "either side finds a hot streak in front of goal early";
  }
  if (gridCall?.sideKey === "over") {
    return "the first hour stays goalless";
  }
  if (gridCall?.sideKey === "yes") {
    return "one side fails to register a shot on target in the first half";
  }
  if (gridCall?.sideKey === "no") {
    return "each side scores in the first half";
  }
  const against = plan.call.outcome;
  if (against === "draw") {
    return "the favourite scores inside the first 20 minutes";
  }
  const other = against === "home" ? grounding.away : grounding.home;
  return `${other} grab the first goal`;
}
