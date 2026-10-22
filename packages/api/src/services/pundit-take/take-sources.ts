import type { Grounding } from "../ask";
import { getClubFormSnapshot } from "../club-form";
import { formatTimestampSgt, shortModelVersionLabel } from "../basics-answer-voice";
import type { MatchDossier } from "../match-dossier/types";
import type { PunditTakeSourcesFooter } from "./types";
import { takeEligibleDossierEvidence } from "./take-dossier-evidence";
import { fplInjuryStatusFooterAsOfSgt } from "./take-fpl-injuries";
import { livePricingMarkets } from "./take-plan-live-markets";

function labelSource(source: string): string {
  if (source === "kalshi") return "Kalshi";
  if (source === "polymarket") return "Polymarket";
  if (source === "stake") return "Stake";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function buildTakeSourcesFooter(
  grounding: Grounding,
  dossier: MatchDossier | null,
  nowMs = Date.now(),
): PunditTakeSourcesFooter {
  const odds = livePricingMarkets(grounding, nowMs).map((row) => ({
      source: row.source,
      label: labelSource(row.source),
      observedAt: row.observedAt,
      observedAtSgt: formatTimestampSgt(row.observedAt),
    }));

  const evidenceUrls = (dossier?.evidence ?? [])
    .filter((item) => takeEligibleDossierEvidence(item) && item.sourceUrl)
    .map((item) => ({
      id: item.id,
      url: item.sourceUrl,
      publisher: item.publisher,
    }));

  const formSnap = getClubFormSnapshot(grounding.competitionId);
  const tableAsOf = formSnap.lastUpdated ?? grounding.freshness.espnLastUpdated ?? null;
  const formAsOf = grounding.freshness.espnLastUpdated ?? formSnap.lastUpdated ?? null;

  return {
    modelVersion: grounding.pricing.modelVersion,
    modelPricedAt: grounding.pricing.pricedAt,
    modelPricedAtSgt: formatTimestampSgt(grounding.pricing.pricedAt),
    ratingsAsOf: grounding.freshness.ratingsAsOf ?? null,
    ratingsAsOfSgt: grounding.freshness.ratingsAsOf
      ? formatTimestampSgt(grounding.freshness.ratingsAsOf)
      : null,
    homeClubRating: Number.isFinite(grounding.homeElo) ? Math.round(grounding.homeElo * 1000) / 1000 : null,
    awayClubRating: Number.isFinite(grounding.awayElo) ? Math.round(grounding.awayElo * 1000) / 1000 : null,
    tableSource: "ESPN standings (club-form snapshot)",
    tableAsOf,
    tableAsOfSgt: tableAsOf ? formatTimestampSgt(tableAsOf) : null,
    formSource: "ESPN results (club-form snapshot)",
    formAsOf,
    formAsOfSgt: formAsOf ? formatTimestampSgt(formAsOf) : null,
    odds,
    evidenceUrls,
    fplInjuryStatusAsOfSgt: fplInjuryStatusFooterAsOfSgt(grounding, dossier),
  };
}

export function formatTakeSourcesFooterBlock(
  footer: PunditTakeSourcesFooter,
  options?: { includeOdds?: boolean },
): string {
  const includeOdds = options?.includeOdds ?? true;
  const lines: string[] = [];
  lines.push(`Model ${shortModelVersionLabel(footer.modelVersion)} (priced ${footer.modelPricedAtSgt}).`);
  if (footer.tableAsOfSgt) {
    lines.push(`${footer.tableSource} as of ${footer.tableAsOfSgt}.`);
  }
  if (footer.formAsOfSgt) {
    lines.push(`${footer.formSource} as of ${footer.formAsOfSgt}.`);
  }
  if (includeOdds) {
    for (const row of footer.odds) {
      lines.push(`${row.label} as of ${row.observedAtSgt}.`);
    }
  }
  if (footer.fplInjuryStatusAsOfSgt) {
    lines.push(`FPL injury status (as of ${footer.fplInjuryStatusAsOfSgt}).`);
  }
  return lines.join("\n");
}
