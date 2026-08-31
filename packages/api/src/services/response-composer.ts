import type { Grounding } from "./ask";
import { buildResponseFacts, factById } from "./response-facts";
import { planResponse, resolveRequestedScoreline, type ResponsePlan } from "./response-plan";

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

  if (plan.mode === "player-or-scorer") {
    return "I can discuss the matchup, but I can’t price a scorer or player prop from this match forecast. "
      + "Without a verified player market, I won’t turn a team-level view into a made-up player probability.";
  }
  if (plan.mode === "lineup-counterfactual") {
    return "A confirmed lineup change could alter my read, but I can’t quantify the swing without verified team news and a revised forecast. I won’t invent a percentage adjustment.";
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
    `Over 2.5 is ${pct(grounding.pOver2_5)} and both teams to score is ${pct(grounding.pBttsYes)}.${scores ? ` The leading scorelines are ${scores}.` : ""}`,
    [marketRows, market].filter(Boolean).join(" "),
    "I would revisit the read only after verified team news or a materially different market snapshot; I can’t assign a lineup effect from these facts alone.",
  ].filter(Boolean).join("\n\n");
}
