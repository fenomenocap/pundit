import type { Grounding } from "../ask";
import type { DossierEvidenceItem, MatchDossier } from "../match-dossier/types";
import { isFplBootstrapInjuryItem } from "../match-dossier/types";
import { compactTeamLabel, formatTimestampSgt } from "../basics-answer-voice";
import type { TakePlanPoint } from "./types";
import { punditTakeV2HeaderOverrideActive } from "./flags";

const FPL_INJURY_MAX_AGE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

function clubMatchesFixture(club: string, grounding: Grounding): boolean {
  const normalized = club.trim().toLowerCase();
  const candidates = [
    grounding.home,
    grounding.away,
    compactTeamLabel(grounding.home),
    compactTeamLabel(grounding.away),
  ].map((name) => name.trim().toLowerCase());
  return candidates.includes(normalized);
}

function withinFreshnessWindow(newsAddedAt: string | null | undefined, now: Date): boolean {
  if (!newsAddedAt) return false;
  const ts = Date.parse(newsAddedAt);
  if (Number.isNaN(ts)) return false;
  const ageMs = now.getTime() - ts;
  return ageMs >= 0 && ageMs <= FPL_INJURY_MAX_AGE_DAYS * MS_PER_DAY;
}

export function formatFplInjuryFact(item: DossierEvidenceItem): string | null {
  if (!isFplBootstrapInjuryItem(item)) return null;
  const player = item.player!.trim();
  if (!player) return null;
  const status = item.status;
  if (!status) return null;
  if (status === "u" || status === "i" || status === "s") {
    return `${player} is out.`;
  }
  if (status === "d") {
    if (item.chanceOfPlaying != null && Number.isFinite(item.chanceOfPlaying)) {
      const pct = Math.round(item.chanceOfPlaying);
      return `${player} is doubtful, ${pct}% to play.`;
    }
    return `${player} is doubtful.`;
  }
  return null;
}

export function selectEligibleFplInternalInjuries(
  grounding: Grounding,
  dossier: MatchDossier | null,
  now = new Date(),
): DossierEvidenceItem[] {
  if (!punditTakeV2HeaderOverrideActive()) return [];
  const raw = dossier?.injuries.value.items ?? [];
  const eligible: DossierEvidenceItem[] = [];
  for (const item of raw) {
    if (!isFplBootstrapInjuryItem(item)) continue;
    if (!clubMatchesFixture(item.club!, grounding)) continue;
    if (!withinFreshnessWindow(item.newsAddedAt, now)) continue;
    if (formatFplInjuryFact(item) == null) continue;
    eligible.push(item);
  }
  return eligible;
}

export function buildFplInternalInjuryPoints(
  grounding: Grounding,
  dossier: MatchDossier | null,
  now = new Date(),
): TakePlanPoint[] {
  return selectEligibleFplInternalInjuries(grounding, dossier, now).slice(0, 2).map((item, index) => ({
    id: `fpl-injury-${index}`,
    role: "contradict" as const,
    text: formatFplInjuryFact(item)!,
    fieldPath: `injuries.fpl-bootstrap-static[${index}]`,
  }));
}

export function fplInjuryStatusFooterAsOfSgt(
  grounding: Grounding,
  dossier: MatchDossier | null,
  now = new Date(),
): string | null {
  const eligible = selectEligibleFplInternalInjuries(grounding, dossier, now);
  if (!eligible.length) return null;
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const item of eligible) {
    const ts = Date.parse(item.newsAddedAt ?? "");
    if (!Number.isNaN(ts) && ts > maxTs) maxTs = ts;
  }
  if (!Number.isFinite(maxTs)) return null;
  return formatTimestampSgt(new Date(maxTs).toISOString());
}
