import type { Grounding } from "../ask";
import { getClubFormSnapshot } from "../club-form";
import { formatTimestampSgt, shortModelVersionLabel } from "../basics-answer-voice";
import type { MatchDossier } from "../match-dossier/types";
import type { PunditTakeSourcesFooter } from "./types";

function labelSource(source: string): string {
  if (source === "kalshi") return "Kalshi";
  if (source === "polymarket") return "Polymarket";
  if (source === "stake") return "Stake";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function buildTakeSourcesFooter(
  grounding: Grounding,
  dossier: MatchDossier | null,
): PunditTakeSourcesFooter {
  const odds = grounding.pricing.markets
    .filter((row) => row.legs.draw.impliedP != null || row.legs.draw.decimalOdds != null)
    .map((row) => ({
      source: row.source,
      label: labelSource(row.source),
      observedAt: row.observedAt,
      observedAtSgt: formatTimestampSgt(row.observedAt),
    }));

  const evidenceUrls = (dossier?.evidence ?? [])
    .filter((item) => item.verification === "cited" && item.sourceUrl)
    .map((item) => ({
      id: item.id,
      url: item.sourceUrl,
      publisher: item.publisher,
    }));

  const formSnap = getClubFormSnapshot(grounding.competitionId);
  const tableAsOf = formSnap.lastUpdated ?? grounding.freshness.espnLastUpdated ?? null;

  return {
    modelVersion: grounding.pricing.modelVersion,
    modelPricedAt: grounding.pricing.pricedAt,
    modelPricedAtSgt: formatTimestampSgt(grounding.pricing.pricedAt),
    ratingsAsOf: grounding.freshness.ratingsAsOf ?? null,
    tableSource: "ESPN standings (club-form snapshot)",
    tableAsOf,
    tableAsOfSgt: tableAsOf ? formatTimestampSgt(tableAsOf) : null,
    odds,
    evidenceUrls,
  };
}
