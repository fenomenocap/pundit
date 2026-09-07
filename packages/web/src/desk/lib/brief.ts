import {
  OPEN_FIXTURES,
  SETTLED_FIXTURES,
  gw3Record,
  modelProbFor,
  selectionLabel,
  type Fixture,
} from "./data/fixtures";
import { FORM, formString } from "./data/form";
import { playersForTeam } from "./data/players";
import { TEAMS } from "./data/teams";
import { fmtKickoff, fmtPct } from "./format";

function lineFor(f: Fixture) {
  const home = TEAMS[f.home];
  const away = TEAMS[f.away];
  const lean = selectionLabel(f, f.modelPick);
  const p = modelProbFor(f, f.modelPick);
  const menH = playersForTeam(f.home, 2)
    .map((x) => x.name)
    .join(", ");
  const menA = playersForTeam(f.away, 2)
    .map((x) => x.name)
    .join(", ");
  return [
    `${home.short} vs ${away.short}`,
    `${fmtKickoff(f.kickoff)} · ${f.venue}`,
    `form ${formString(f.home)} / ${formString(f.away)}`,
    `xG ${f.xg[0].toFixed(2)}–${f.xg[1].toFixed(2)} (desk split)`,
    `model 1X2 ${fmtPct(f.model.home)} / ${fmtPct(f.model.draw)} / ${fmtPct(f.model.away)}`,
    `O2.5 ${fmtPct(f.model.over25)} (desk) · BTTS ${fmtPct(f.model.btts)} (engine)`,
    `lean ${lean} (${fmtPct(p)})`,
    `in form: ${menH} · ${menA}`,
    f.brief,
  ].join(" · ");
}

export function slateBlock() {
  const rec = gw3Record();
  const settled = SETTLED_FIXTURES.map((f) => {
    const score = f.score ? `${f.score[0]}–${f.score[1]}` : "n/a";
    return `${TEAMS[f.home].short} ${score} ${TEAMS[f.away].short} · lean ${selectionLabel(f, f.modelPick)} · ${f.modelHit ? "HIT" : "MISS"} · ${f.brief}`;
  }).join("\n");
  const open = OPEN_FIXTURES.map(lineFor).join("\n");
  return [
    `GW3 model 1X2 record: ${rec.hits}/${rec.n} (${fmtPct(rec.pct)}).`,
    "",
    "SETTLED GW3:",
    settled,
    "",
    "OPEN GW4:",
    open,
  ].join("\n");
}

export function fixtureCard(f: Fixture) {
  const home = TEAMS[f.home];
  const away = TEAMS[f.away];
  const score = f.score ? ` FT ${f.score[0]}–${f.score[1]}` : " upcoming";
  const menH = playersForTeam(f.home, 3)
    .map((x) => `${x.name} ${x.pos} form ${x.form.toFixed(1)}`)
    .join(", ");
  const menA = playersForTeam(f.away, 3)
    .map((x) => `${x.name} ${x.pos} form ${x.form.toFixed(1)}`)
    .join(", ");
  return [
    `FOCUS: ${home.name} vs ${away.name}${score}`,
    `${f.venue}. Kickoff ${fmtKickoff(f.kickoff)}.`,
    `Form ${home.short} ${formString(f.home)} (${FORM[f.home].join("-")}). ${away.short} ${formString(f.away)}.`,
    `xG ${f.xg[0].toFixed(2)}–${f.xg[1].toFixed(2)} (desk split).`,
    `Model 1X2 ${fmtPct(f.model.home)} / ${fmtPct(f.model.draw)} / ${fmtPct(f.model.away)}.`,
    `Over 2.5 ${fmtPct(f.model.over25)} (desk reconstruction). BTTS ${fmtPct(f.model.btts)} (engine).`,
    `Model lean: ${selectionLabel(f, f.modelPick)}.`,
    `Key ${home.short}: ${menH}.`,
    `Key ${away.short}: ${menA}.`,
    f.brief,
  ].join(" ");
}

export function weekendNote() {
  const rec = gw3Record();
  const ranked = [...OPEN_FIXTURES]
    .map((f) => ({ f, p: modelProbFor(f, f.modelPick) }))
    .sort((a, b) => b.p - a.p);
  const top = ranked.slice(0, 3);
  const derby = OPEN_FIXTURES.find((f) => f.home === "MUN" && f.away === "MCI");
  const lines = top.map((t, i) => {
    const f = t.f;
    return `${i + 1}. ${TEAMS[f.home].short} vs ${TEAMS[f.away].short} — ${selectionLabel(f, f.modelPick)}, model ${fmtPct(t.p)}. ${f.brief}`;
  });
  const missNote =
    rec.pct < 0.5
      ? "The misses were the games that died — 0-0s and late steals. Bankers paid; coin-flips did not."
      : "The model cleared the weekend on the sides it was supposed to.";
  return [
    `GW3 the model went ${rec.hits} from ${rec.n} on 1X2. ${missNote}`,
    "",
    "GW4, in order of conviction:",
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
  return modelProbFor(f, f.modelPick);
}

export function rankedOpen() {
  return [...OPEN_FIXTURES]
    .map((f) => ({ f, p: modelProbFor(f, f.modelPick) }))
    .sort((a, b) => b.p - a.p);
}
