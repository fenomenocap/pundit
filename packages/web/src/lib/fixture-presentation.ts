import type {
  EdgeBand,
  FixtureCapability,
  MatchGrounding,
  MatchResponse,
  ModelFixtureResponse,
  OneXTwoOutcome,
  PricingObject,
  RecognizedFixtureSnapshotRow,
  UserLine,
} from "./api";

export interface MarketProbabilityRow {
  id: string;
  label: string;
  pHome: number;
  pDraw: number | null;
  pAway: number;
  observedAt: string | null;
  provenance: "forecast" | "market" | "consensus";
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** Server `evPct` is a fraction. Format only — never recompute EV in the client. */
export function formatSignedEvPct(evPct: number): string {
  const pct = evPct * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function formatEdgeBand(band: EdgeBand | null | undefined): string | null {
  return band ?? null;
}

/** Server fair `1/p`. Display only — never invert a probability in the client. */
export function formatFairOdds(value: number): string {
  return value.toFixed(2);
}

/** Copy when Stake / Kalshi / Polymarket 1X2 is missing from match grounding. */
export const NO_COMPARISON_MARKET = "No comparison market";

/**
 * Desk +EV / pass-or-play turns. Used only to decide whether to POST `userLine`;
 * the decimal always comes from the structured field, never from chip copy.
 */
const DESK_USER_LINE_QUESTION =
  /\+ev\b|\bexpected value\b|\bpass or play\b|\bedge vs(?:\s+the)?\s+book\b/i;

export function parseDeskUserLine(
  outcome: OneXTwoOutcome,
  decimalText: string,
): UserLine | undefined {
  const decimalOdds = Number(decimalText.trim());
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return undefined;
  return { outcome, decimalOdds };
}

export function userLinePayloadForAsk(
  question: string,
  outcome: OneXTwoOutcome,
  decimalText: string,
): UserLine | undefined {
  if (!DESK_USER_LINE_QUESTION.test(question)) return undefined;
  return parseDeskUserLine(outcome, decimalText);
}

export interface DeskBoardOneXTwo {
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  fairHome: number;
  fairDraw: number;
  fairAway: number;
}

export interface DeskBoardUserLine {
  outcome: OneXTwoOutcome;
  outcomeLabel: string;
  decimalOdds: number;
  evPct: number;
  edgeBand: EdgeBand;
}

export interface DeskBoardView {
  oneXTwo: DeskBoardOneXTwo;
  bttsYes: number;
  bttsNo: number;
  over25: number;
  under25: number;
  totalsHonesty: string;
  topScores: Array<{ score: string; probability: number }>;
  markets: MarketProbabilityRow[];
  consensus: MarketProbabilityRow | null;
  userLine: DeskBoardUserLine | null;
  capturedEv: MarketEvRowDisplay[];
}

function outcomeLabel(grounding: MatchGrounding, outcome: OneXTwoOutcome): string {
  if (outcome === "home") return grounding.home;
  if (outcome === "away") return grounding.away;
  return "Draw";
}

/**
 * Flatten match grounding for the desk board. Fair odds and EV% are copied
 * from the server object — never recomputed from p or decimal.
 */
export function deskBoardFromGrounding(grounding: MatchGrounding): DeskBoardView {
  const model = grounding.pricing.model;
  const line = grounding.pricing.userLine;
  const rows = marketRowsFromGrounding(grounding);
  return {
    oneXTwo: {
      home: grounding.home,
      away: grounding.away,
      pHome: grounding.pHome,
      pDraw: grounding.pDraw,
      pAway: grounding.pAway,
      fairHome: model.home.fairOdds,
      fairDraw: model.draw.fairOdds,
      fairAway: model.away.fairOdds,
    },
    bttsYes: grounding.pBttsYes,
    bttsNo: grounding.pBttsNo,
    over25: grounding.pOver2_5,
    under25: grounding.pUnder2_5,
    totalsHonesty: SHARED_TOTAL_XG_SENTENCE,
    topScores: grounding.topScores.slice(0, 3),
    markets: rows.filter((row) => row.provenance === "market"),
    consensus: rows.find((row) => row.provenance === "consensus") ?? null,
    userLine: line
      ? {
          outcome: line.outcome,
          outcomeLabel: outcomeLabel(grounding, line.outcome),
          decimalOdds: line.decimalOdds,
          evPct: line.evPct,
          edgeBand: line.edgeBand,
        }
      : null,
    capturedEv: [...marketEvFromPricing(grounding.pricing).values()],
  };
}

export interface MarketEvLegDisplay {
  impliedP: number;
  evPct: number;
}

export interface MarketEvRowDisplay {
  source: string;
  edgeBand: EdgeBand | null;
  legs: Partial<Record<OneXTwoOutcome, MarketEvLegDisplay>>;
}

const OUTCOMES: OneXTwoOutcome[] = ["home", "draw", "away"];

/**
 * Reads printable EV from server `pricing`. A row without `evPct` is omitted
 * so the card keeps today's percent grid.
 */
export function marketEvFromPricing(
  pricing: PricingObject | null | undefined
): Map<string, MarketEvRowDisplay> {
  const rows = new Map<string, MarketEvRowDisplay>();
  if (!pricing) return rows;
  for (const market of pricing.markets) {
    const legs: MarketEvRowDisplay["legs"] = {};
    for (const outcome of OUTCOMES) {
      const leg = market.legs[outcome];
      if (leg.evPct == null || leg.impliedP == null) continue;
      legs[outcome] = { impliedP: leg.impliedP, evPct: leg.evPct };
    }
    if (Object.keys(legs).length === 0) continue;
    rows.set(market.source, {
      source: market.source,
      edgeBand: market.edgeBand,
      legs,
    });
  }
  return rows;
}

export function marketRowSource(row: Pick<MarketProbabilityRow, "id">): string | null {
  if (row.id === "forecast" || row.id === "consensus") return null;
  if (row.id.startsWith("market-")) return row.id.slice("market-".length);
  return null;
}

/** Same honesty line the API prints for totals. Do not sell Over 2.5 as match-specific. */
export const SHARED_TOTAL_XG_SENTENCE =
  "Totals sit near 50% because every match uses the same 2.70 expected goals.";

export const PUNDIT_FUNDAMENTAL_ROW_LABEL = "My forecast";
export const PUNDIT_CONSENSUS_ROW_LABEL = "Pundit Consensus";

/** Empty-state pull-mode chip. Structured `userLine` is away @ 7; do not parse the label. */
export const PULL_CHIP_OUTCOME: OneXTwoOutcome = "away";
export const PULL_CHIP_DECIMAL = 7;

/** Homepage fixture chip. Must not include preview / analyse / thoughts — that opens the desk. */
export function fixtureChipCopy(
  home: string,
  away: string,
  competitionAbbr: string,
  weekday: string
): string {
  return `${home} vs ${away} · ${competitionAbbr} · ${weekday}`;
}

export function pullModeChipCopy(home: string, odds = PULL_CHIP_DECIMAL): string {
  return `I found ${home} at ${odds} — pass or play?`;
}

/** Per-featured-match desk chip. Structured `userLine` is the same pull payload; do not parse the label. */
export function passOrPlayChipCopy(home: string, away: string): string {
  return `Pass or play · ${home} vs ${away}`;
}

export function priceThisChipCopy(home: string, away: string): string {
  return `Price this · ${home} vs ${away}`;
}

export function deskChipCopy(
  home: string,
  away: string,
  variant: "pass-or-play" | "price-this" = "pass-or-play"
): string {
  return variant === "price-this" ? priceThisChipCopy(home, away) : passOrPlayChipCopy(home, away);
}

const ESPN_IN_PLAY = new Set(["IN_PLAY", "LIVE"]);
const ESPN_FINISHED = new Set(["FINISHED", "FT", "FULL_TIME", "STATUS_FINAL"]);

function normalizedEspnStatus(status: string | null | undefined): string | undefined {
  const trimmed = status?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

/**
 * Suggestion chips are an upcoming desk only: ESPN SCHEDULED (or unknown)
 * and a kickoff still in the future. In-play and finished never qualify.
 */
export function isFutureScheduledFixture(
  utcDate: string,
  espnStatus?: string | null,
  now = Date.now()
): boolean {
  const kickoff = new Date(utcDate).getTime();
  if (Number.isNaN(kickoff) || kickoff <= now) return false;
  const status = normalizedEspnStatus(espnStatus);
  if (!status) return true;
  return status === "SCHEDULED" || status === "STATUS_SCHEDULED";
}

export function modelFixtureStatusLabel(input: {
  utcDate: string;
  espnStatus?: string | null;
  result?: { homeScore: number; awayScore: number } | null;
  now?: number;
}): "Live" | "Full time" | "Upcoming" | "Kickoff passed" {
  const status = normalizedEspnStatus(input.espnStatus);
  if (status && ESPN_IN_PLAY.has(status)) return "Live";
  if ((status && ESPN_FINISHED.has(status)) || input.result) return "Full time";
  const kickoff = new Date(input.utcDate).getTime();
  const now = input.now ?? Date.now();
  if (!Number.isNaN(kickoff) && kickoff > now && (!status || status === "SCHEDULED" || status === "STATUS_SCHEDULED")) {
    return "Upcoming";
  }
  return "Kickoff passed";
}

export function espnStatusByIdentity(
  matches: ReadonlyArray<Pick<MatchResponse, "competitionId" | "id" | "status">>
): Map<string, string> {
  return new Map(matches.map((match) => [
    `espn:${match.competitionId}:${match.id}`,
    match.status,
  ]));
}

export function formatObservedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function sourceLabel(source: "kalshi" | "polymarket"): string {
  return source === "kalshi" ? "Kalshi" : "Polymarket";
}

export function marketRowsFromGrounding(grounding: MatchGrounding): MarketProbabilityRow[] {
  const rows: MarketProbabilityRow[] = [{
    id: "forecast",
    label: PUNDIT_FUNDAMENTAL_ROW_LABEL,
    pHome: grounding.pHome,
    pDraw: grounding.pDraw,
    pAway: grounding.pAway,
    observedAt: null,
    provenance: "forecast",
  }];

  if (grounding.consensus) {
    rows.push({
      id: "consensus",
      label: grounding.consensus.label || PUNDIT_CONSENSUS_ROW_LABEL,
      pHome: grounding.consensus.pHome,
      pDraw: grounding.consensus.pDraw,
      pAway: grounding.consensus.pAway,
      observedAt: grounding.consensus.observedAt,
      provenance: "consensus",
    });
  }

  if (
    grounding.stakePHome !== null
    && grounding.stakePDraw !== null
    && grounding.stakePAway !== null
  ) {
    rows.push({
      id: "market-stake",
      label: "Stake",
      pHome: grounding.stakePHome,
      pDraw: grounding.stakePDraw,
      pAway: grounding.stakePAway,
      observedAt: grounding.stakeObservedAt ?? null,
      provenance: "market",
    });
  }

  for (const source of grounding.oddsSources) {
    rows.push({
      id: `market-${source.source}`,
      label: sourceLabel(source.source),
      pHome: source.pHome,
      pDraw: source.pDraw,
      pAway: source.pAway,
      observedAt: source.observedAt ?? null,
      provenance: "market",
    });
  }
  return rows;
}

export function marketRowsFromModel(fixture: ModelFixtureResponse): MarketProbabilityRow[] {
  const rows: MarketProbabilityRow[] = [];
  if (
    fixture.stakePHome !== null
    && fixture.stakePDraw !== null
    && fixture.stakePAway !== null
  ) {
    rows.push({
      id: "market-stake",
      label: "Stake",
      pHome: fixture.stakePHome,
      pDraw: fixture.stakePDraw,
      pAway: fixture.stakePAway,
      observedAt: fixture.stakeObservedAt ?? null,
      provenance: "market",
    });
  }
  for (const source of fixture.oddsSources ?? []) {
    rows.push({
      id: `market-${source.source}`,
      label: sourceLabel(source.source),
      pHome: source.pHome,
      pDraw: source.pDraw,
      pAway: source.pAway,
      observedAt: source.observedAt ?? null,
      provenance: "market",
    });
  }
  return rows;
}

export function capabilityLabel(capability: FixtureCapability): string {
  switch (capability.status) {
    case "priced":
      return "Forecast ready";
    case "temporarily-unpriced":
      return capability.reason === "ratings-refreshing"
        ? "Forecast ratings refreshing"
        : "Forecast loading";
    case "outside-coverage":
      if (capability.reason === "friendly-policy-disabled") return "Outside forecast coverage · friendly policy";
      if (capability.reason === "unsupported-competition") return "Competition · outside forecast coverage";
      return "Outside forecast coverage";
    case "insufficient-model-input":
      if (capability.reason === "neutral-venue-unknown") return "Neutral venue not confirmed";
      if (capability.reason === "ratings-unavailable") return "Team ratings unavailable";
      return "Required forecast input missing";
  }
}

export function capabilityTone(capability: FixtureCapability): "ready" | "waiting" | "outside" {
  if (capability.status === "priced") return "ready";
  if (capability.status === "temporarily-unpriced") return "waiting";
  return "outside";
}

export function sortFixturesChronologically<T extends Pick<MatchResponse, "utcDate" | "id">>(
  fixtures: readonly T[]
): T[] {
  return [...fixtures].sort((a, b) => (
    new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime() || a.id - b.id
  ));
}

export function recognizedFixtureMap(rows: readonly RecognizedFixtureSnapshotRow[]) {
  return new Map(rows.map((row) => [row.fixture.fixtureId, row]));
}
