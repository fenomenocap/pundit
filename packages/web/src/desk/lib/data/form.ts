import { TEAM_LIST, type TeamId } from "./teams";

export type ResultMark = "W" | "D" | "L";

/** Last-N league form from ESPN `/api/matches/recent` `clubForm`, including the previous season when needed. Empty before hydrate. */
export const FORM: Record<TeamId, ResultMark[]> = Object.fromEntries(
  TEAM_LIST.map((team) => [team.id, [] as ResultMark[]]),
) as Record<TeamId, ResultMark[]>;

export function applyLiveForm(rows: Partial<Record<TeamId, ResultMark[]>>) {
  for (const team of TEAM_LIST) {
    FORM[team.id] = rows[team.id] ? [...rows[team.id]!] : [];
  }
}

export function formString(id: TeamId) {
  return FORM[id].join("");
}
