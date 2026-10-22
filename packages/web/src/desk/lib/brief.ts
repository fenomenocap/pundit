import { OPEN_FIXTURES, SETTLED_FIXTURES, gw3Record, hasCapturedForecast, modelProbFor, selectionLabel, type ForecastFixture, type Fixture } from "./data/fixtures";
import { FORM, formString } from "./data/form";
import { TEAMS } from "./data/teams";
import { fmtKickoff, fmtPct } from "./format";
import { scorersForTeam } from "./live";

const WEEKEND_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

function lineFor(f: ForecastFixture) {
  const home = TEAMS[f.home];
  const away = TEAMS[f.away];
  const lean = selectionLabel(f, f.modelPick);
  const p = modelProbFor(f, f.modelPick);
  const menH = scorersForTeam(f.home, 2)
    .map((x) => x.name)
    .join(", ");
  const menA = scorersForTeam(f.away, 2)
    .map((x) => x.name)
    .join(", ");
  return [
    `${home.name} vs ${away.name}`,
    `${fmtKickoff(f.kickoff)} · ${f.venue}`,
    `form ${formString(f.home)} / ${formString(f.away)}`,
    `xG ${f.xg[0].toFixed(2)}–${f.xg[1].toFixed(2)}`,
    `our 1X2 ${fmtPct(f.model.home)} / ${fmtPct(f.model.draw)} / ${fmtPct(f.model.away)}`,
    `O2.5 ${fmtPct(f.model.over25)} · BTTS ${fmtPct(f.model.btts)}`,
    `lean ${lean} (${fmtPct(p)})`,
    `in form: ${menH || "—"} · ${menA || "—"}`,
    f.brief,
  ].join(" · ");
}

export function slateBlock() {
  const rec = gw3Record();
  const settled = SETTLED_FIXTURES.map((f) => {
    const score = f.score ? `${f.score[0]}–${f.score[1]}` : "n/a";
    if (!hasCapturedForecast(f) || typeof f.modelHit !== "boolean") {
      return `${TEAMS[f.home].name} ${score} ${TEAMS[f.away].name} · no captured pre-kickoff forecast`;
    }
    return `${TEAMS[f.home].name} ${score} ${TEAMS[f.away].name} · pre-kickoff forecast ${selectionLabel(f, f.modelPick)} · ${f.modelHit ? "HIT" : "MISS"} · ${f.brief}`;
  }).join("\n");
  const open = OPEN_FIXTURES.filter(hasCapturedForecast).map(lineFor).join("\n");
  return [
    rec.pct === null
      ? "No captured settled forecasts are available for a record."
      : `Captured model 1X2 record: ${rec.hits}/${rec.n} (${fmtPct(rec.pct)}).`,
    "",
    "RECENT RESULTS:",
    settled || "No recent results.",
    "",
    "CURRENT PRICED FIXTURES:",
    open || "No priced fixtures are live right now.",
  ].join("\n");
}

export function fixtureCard(f: Fixture) {
  const home = TEAMS[f.home];
  const away = TEAMS[f.away];
  const score = f.score ? ` FT ${f.score[0]}–${f.score[1]}` : " upcoming";
  const menH = scorersForTeam(f.home, 3)
    .map((x) => `${x.name} ${x.pos} ${x.goals}g`)
    .join(", ");
  const menA = scorersForTeam(f.away, 3)
    .map((x) => `${x.name} ${x.pos} ${x.goals}g`)
    .join(", ");
  const forecast = hasCapturedForecast(f) ? [
    `xG ${f.xg[0].toFixed(2)}–${f.xg[1].toFixed(2)}.`,
    `Our 1X2 ${fmtPct(f.model.home)} / ${fmtPct(f.model.draw)} / ${fmtPct(f.model.away)}.`,
    `Over 2.5 ${fmtPct(f.model.over25)}. BTTS ${fmtPct(f.model.btts)}.`,
    `Our forecast: ${selectionLabel(f, f.modelPick)}.`,
  ] : ["No captured pre-kickoff forecast is available for this result."];
  return [
    `FOCUS: ${home.name} vs ${away.name}${score}`,
    `${f.venue}. Kickoff ${fmtKickoff(f.kickoff)}.`,
    `Form ${home.name} ${formString(f.home)} (${FORM[f.home].join("-")}). ${away.name} ${formString(f.away)}.`,
    ...forecast,
    `Key ${home.name}: ${menH}.`,
    `Key ${away.name}: ${menA}.`,
    f.brief,
  ].join(" ");
}

export function weekendNote() {
  const rec = gw3Record();
  // "The weekend" is the next round only, so a later round never leads the summary.
  const ranked = rankedOpen();
  const top = ranked.slice(0, 3);
  const derby = OPEN_FIXTURES.find((f) => f.home === "MUN" && f.away === "MCI");
  const lines = top.map((t, i) => {
    const f = t.f;
    return `${i + 1}. ${TEAMS[f.home].name} vs ${TEAMS[f.away].name} (${fmtKickoff(f.kickoff)}) — ${selectionLabel(f, f.modelPick)}, model ${fmtPct(t.p, 1)}. ${f.brief}`;
  });
  const missNote = rec.pct === null
    ? null
    : rec.pct < 0.5
      ? "The misses were the games that died — 0-0s and late steals. Bankers paid; coin-flips did not."
      : "The model cleared the weekend on the sides it was supposed to.";
  return [
    rec.pct === null
      ? null
      : `The captured model went ${rec.hits} from ${rec.n} on 1X2. ${missNote}`,
    "",
    "This weekend's priced fixtures, in order of conviction:",
    ...lines,
    derby
      ? `\nThe derby at Old Trafford is the argument of the weekend — ${derby.brief}`
      : "",
    "\nAsk a match, a player, a tactical matchup, or the slate. Analysis only — not betting advice.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function conviction(f: Fixture) {
  return hasCapturedForecast(f) ? modelProbFor(f, f.modelPick) : 0;
}

/** The next round of priced fixtures: kickoffs within four days of the first one. */
export function weekendFixtures() {
  const priced = [...OPEN_FIXTURES].filter(hasCapturedForecast);
  const first = Math.min(...priced.map((f) => Date.parse(f.kickoff)).filter(Number.isFinite));
  return priced.filter((f) => Date.parse(f.kickoff) < first + WEEKEND_WINDOW_MS);
}

export function rankedOpen() {
  return weekendFixtures()
    .map((f) => ({ f, p: modelProbFor(f, f.modelPick) }))
    .sort((a, b) => b.p - a.p);
}
