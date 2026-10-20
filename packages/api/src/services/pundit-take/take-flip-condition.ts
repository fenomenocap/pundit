import type { Grounding } from "../ask";
import type { MatchDossier } from "../match-dossier/types";
import {
  buildStructuredFlipCondition,
  renderFlipSentenceFromSpec,
} from "./take-flip-spec";
import type { TakePlanCall, TakePlanGridCall, TakePlanPoint } from "./types";

export function buildTakeFlipCondition(
  dossier: MatchDossier | null,
  grounding: Grounding,
  call: TakePlanCall,
  gridCall: TakePlanGridCall | null,
  marketKind: "1x2" | "btts" | "totals",
): TakePlanPoint | null {
  const spec = buildStructuredFlipCondition(dossier, grounding, call, gridCall, marketKind);
  const text = renderFlipSentenceFromSpec(spec, grounding);
  return {
    id: `flip-${spec.kind}`,
    role: "flip",
    text,
    fieldPath: `flip.${spec.kind}`,
  };
}
