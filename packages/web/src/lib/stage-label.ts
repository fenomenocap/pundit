const STAGE_LABELS: Record<string, string> = {
  "group-stage": "Group Stage",
  "round-of-32": "Round of 32",
  "round-of-16": "Round of 16",
  "quarterfinals": "Quarterfinal",
  "semifinals": "Semifinal",
  "3rd-place-match": "3rd Place Match",
  "final": "Final",
};

export function formatStage(stage: string | null): string {
  if (!stage) return "Match";
  return STAGE_LABELS[stage] ?? stage;
}

// Order knockout/group stages progress in, for grouping the fixtures page.
export const STAGE_ORDER = [
  "group-stage",
  "round-of-32",
  "round-of-16",
  "quarterfinals",
  "semifinals",
  "3rd-place-match",
  "final",
];
