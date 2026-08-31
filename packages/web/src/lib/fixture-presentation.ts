import type {
  FixtureCapability,
  MatchGrounding,
  MatchResponse,
  ModelFixtureResponse,
  RecognizedFixtureSnapshotRow,
} from "./api";

export interface MarketProbabilityRow {
  id: string;
  label: string;
  pHome: number;
  pDraw: number | null;
  pAway: number;
  observedAt: string | null;
  provenance: "forecast" | "market";
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
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
    label: "My forecast",
    pHome: grounding.pHome,
    pDraw: grounding.pDraw,
    pAway: grounding.pAway,
    observedAt: null,
    provenance: "forecast",
  }];

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
