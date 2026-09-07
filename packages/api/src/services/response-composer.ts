import type { Grounding } from "./ask";
import type { OneXTwoOutcome } from "./response-correctness";
import { buildResponseFacts, factById } from "./response-facts";
import { planResponse, resolveRequestedScoreline, type ResponsePlan } from "./response-plan";

export const SHARED_TOTAL_XG_SENTENCE =
  "Totals sit near 50% because every match uses the same 2.70 expected goals.";

export const STAKE_REFUSAL_SENTENCE =
  "I can print the price. I will not size a stake without a bankroll and a risk band.";

function outcomeLabel(grounding: Grounding, outcome: "home" | "draw" | "away"): string {
  return outcome === "draw" ? "the draw" : grounding[outcome];
}

function signedEvPct(evPct: number): string {
  const pct = evPct * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function composeTotalsAnswer(question: string, grounding: Grounding): string {
  const askedUnder = /\bunder\b/i.test(question) && !/\bover\b/i.test(question);
  const lead = askedUnder
    ? `I have under 2.5 at ${pct(grounding.pUnder2_5)}; over 2.5 is ${pct(grounding.pOver2_5)}.`
    : `I have over 2.5 at ${pct(grounding.pOver2_5)}; under 2.5 is ${pct(grounding.pUnder2_5)}.`;
  return `${lead} ${SHARED_TOTAL_XG_SENTENCE}`;
}

function fattestCapturedEv(grounding: Grounding): {
  source: string;
  outcome: OneXTwoOutcome;
  decimalOdds: number;
  evPct: number;
  edgeBand: string | null;
} | null {
  let best: {
    source: string;
    outcome: OneXTwoOutcome;
    decimalOdds: number;
    evPct: number;
    edgeBand: string | null;
  } | null = null;
  for (const market of grounding.pricing.markets) {
    for (const outcome of ["home", "draw", "away"] as const) {
      const leg = market.legs[outcome];
      if (leg.decimalOdds == null || leg.evPct == null) continue;
      if (!best || Math.abs(leg.evPct) > Math.abs(best.evPct)) {
        best = {
          source: market.source,
          outcome,
          decimalOdds: leg.decimalOdds,
          evPct: leg.evPct,
          edgeBand: market.edgeBand,
        };
      }
    }
  }
  return best;
}

function composePricingDeskAnswer(grounding: Grounding): string {
  const model = grounding.pricing.model;
  const oneXTwo = `My 1X2 is ${grounding.home} ${pct(model.home.p)} (fair ${model.home.fairOdds.toFixed(2)}), `
    + `draw ${pct(model.draw.p)} (fair ${model.draw.fairOdds.toFixed(2)}) and `
    + `${grounding.away} ${pct(model.away.p)} (fair ${model.away.fairOdds.toFixed(2)}).`;
  if (grounding.pricing.userLine) {
    return `${oneXTwo} ${composeUserLineAnswer(grounding)}`;
  }
  const captured = fattestCapturedEv(grounding);
  if (captured) {
    const subject = outcomeLabel(grounding, captured.outcome);
    const source = captured.source[0].toUpperCase() + captured.source.slice(1);
    const band = captured.edgeBand ? ` (${captured.edgeBand})` : "";
    return `${oneXTwo} Against the captured ${source} decimal of ${captured.decimalOdds.toFixed(2)} on ${subject}, `
      + `EV is ${signedEvPct(captured.evPct)}${band}.`;
  }
  return `${oneXTwo} I need a captured decimal line before I can print EV% or pass or play.`;
}

function composeUserLineAnswer(grounding: Grounding): string {
  const line = grounding.pricing.userLine;
  if (!line) {
    return "I need a decimal line on home, draw, or away before I can pass or play.";
  }
  const subject = outcomeLabel(grounding, line.outcome);
  const modelP = grounding.pricing.model[line.outcome].p;
  const decimal = line.decimalOdds.toFixed(2);
  const decision = line.decimalOdds >= line.playPrice
    ? "play"
    : line.decimalOdds < line.passPrice
      ? "pass"
      : "abstain";
  const call = decision === "play"
    ? `That clears the play price of ${line.playPrice.toFixed(2)}, so I play.`
    : decision === "pass"
      ? `That is below the pass price of ${line.passPrice.toFixed(2)}, so I pass.`
      : `That sits between the pass price of ${line.passPrice.toFixed(2)} and the play price of ${line.playPrice.toFixed(2)}, so I will not call it.`;
  return `On ${subject} at ${decimal}, I make it ${pct(modelP)} against that line, EV ${signedEvPct(line.evPct)} (${line.edgeBand}). ${call} Risk is ${line.riskBand}.`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function dateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function headlineMarket(grounding: Grounding): string | null {
  const row = grounding.marketDivergence
    .flatMap((market) => market.legs.map((leg) => ({ market, leg })))
    .sort((a, b) => Math.abs(b.leg.gapPoints) - Math.abs(a.leg.gapPoints))[0];
  if (!row) return null;
  const source = row.market.source[0].toUpperCase() + row.market.source.slice(1);
  return `On ${row.leg.label}, I am at ${row.leg.modelPercent.toFixed(1)}% and ${source} is at `
    + `${row.leg.marketPercent.toFixed(1)}%: I am ${Math.abs(row.leg.gapPoints).toFixed(1)} percentage points `
    + `${row.leg.gapPoints >= 0 ? "higher" : "lower"} on ${row.leg.label}. `
    + "That establishes the disagreement, not its cause or a bet to place.";
}

export function composeMatchResponse(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan = planResponse(question, { groundingKind: "match" })
): string {
  const contract = buildResponseFacts(grounding);
  const scoreRequest = resolveRequestedScoreline(question, grounding);
  const score = scoreRequest?.score ?? null;

  if (plan.mode === "totals") {
    return composeTotalsAnswer(question, grounding);
  }
  if (plan.mode === "pricing-desk") {
    return composePricingDeskAnswer(grounding);
  }
  if (plan.mode === "player-or-scorer") {
    return "I don’t have player-level projections or a verified scorer market for this fixture, "
      + "so I can’t name a most likely scorer without inventing one.";
  }
  if (plan.mode === "lineup-counterfactual") {
    return "I can’t quantify that lineup effect without verified team news and a revised forecast. A confirmed change could alter my read, but I won’t invent a percentage adjustment.";
  }
  if (plan.mode === "team-news") {
    return "I couldn’t establish a verified, dated team-news update for this fixture, so I won’t make an availability claim.";
  }
  if ((plan.mode === "fair-price" || plan.mode === "exact-score") && score) {
    const fact = factById(contract, `score.${score}`);
    if (!fact?.numeric || fact.numeric.value <= 0) {
      return `I don’t have a publishable probability for ${grounding.home} ${score} ${grounding.away}, so I can’t give you a fair price without inventing one.`;
    }
    const fair = (1 / fact.numeric.value).toFixed(2);
    const orientation = scoreRequest?.orientation === "home-away-default"
      ? `Reading ${score} in home-away order, for`
      : "For";
    return plan.mode === "fair-price"
      ? `${orientation} ${grounding.home} ${score} ${grounding.away}, I make it ${pct(fact.numeric.value)}, or about ${fair} in fair decimal odds. I don’t have a comparable live exact-score quote here, so that is a fair price, not a claim that the market is wrong.`
      : `${scoreRequest?.orientation === "home-away-default" ? `Reading ${score} in home-away order, I` : "I"} make ${grounding.home} ${score} ${grounding.away} ${pct(fact.numeric.value)} for this fixture.`;
  }
  if (plan.mode === "user-line") {
    return composeUserLineAnswer(grounding);
  }
  if (plan.mode === "stake-refusal") {
    const priced = grounding.pricing.userLine
      ? composeUserLineAnswer(grounding)
      : `My 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`;
    return `${priced}\n\n${STAKE_REFUSAL_SENTENCE}`;
  }
  if (plan.mode === "market-comparison") {
    return headlineMarket(grounding)
      ?? "I don’t have a complete, same-source and same-time 1X2 market to compare with this fixture, so I can’t claim a pricing disagreement.";
  }
  if (plan.mode === "match-follow-up") {
    const favourite = [
      { label: grounding.home, p: grounding.pHome },
      { label: "the draw", p: grounding.pDraw },
      { label: grounding.away, p: grounding.pAway },
    ].sort((a, b) => b.p - a.p)[0];
    if (/\b1x2\b/i.test(question)) {
      return `My 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`;
    }
    if (/\b(?:which|what)\b.{0,40}\b(?:input|factor|driver)\b.{0,30}\b(?:matters? most|most important|drives?|explains?)\b|\b(?:most important|main)\b.{0,20}\b(?:input|factor|driver)\b/i.test(question)) {
      return "I can’t isolate one input as the cause of that edge. My read uses reviewed team strength and the competition’s home-field setting, but these facts do not provide a causal contribution for either input.";
    }
    if (/\b(?:which side|who)\b.{0,50}\b(?:stronger|strongest|better case|edge)\b|\bstronger\b.{0,20}\b(?:case|side)\b/i.test(question)) {
      return `I have ${favourite.label} as the stronger case at ${pct(favourite.p)}. That is the direct matchup read; I can’t honestly decompose the edge into an exact contribution from each input.`;
    }
    return `My short answer is ${favourite.label} at ${pct(favourite.p)}. The main constraint is that this is a team-strength view; it does not include a confirmed lineup.`;
  }

  const scores = grounding.topScores.slice(0, 3)
    .map((row) => `${row.score} (${pct(row.probability)})`).join(", ");
  const market = headlineMarket(grounding);
  const marketRows = grounding.oddsSources
    .filter((row) => row.pDraw !== null)
    .map((row) => {
      const source = row.source[0].toUpperCase() + row.source.slice(1);
      return `${source} market-implied probabilities: ${grounding.home} ${pct(row.pHome)}, `
        + `draw ${pct(row.pDraw!)}, ${grounding.away} ${pct(row.pAway)}.`;
    }).join(" ");
  const outcomes = [
    { label: grounding.home, p: grounding.pHome },
    { label: "the draw", p: grounding.pDraw },
    { label: grounding.away, p: grounding.pAway },
  ].sort((a, b) => b.p - a.p);
  return [
    `I make ${outcomes[0].label} the likeliest outcome at ${pct(outcomes[0].p)}. For ${dateLabel(grounding.date)}, my full 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`,
    `Both teams to score is ${pct(grounding.pBttsYes)}.${scores ? ` The leading scorelines are ${scores}.` : ""} ${SHARED_TOTAL_XG_SENTENCE}`,
    [marketRows, market].filter(Boolean).join(" "),
    "I would revisit the read only after verified team news or a materially different market snapshot; I can’t assign a lineup effect from these facts alone.",
  ].filter(Boolean).join("\n\n");
}
