import type { TeamId } from "./teams";

export type ResultMark = "W" | "D" | "L";

/** Last five league results, oldest → newest. GW3 is the last letter. */
export const FORM: Record<TeamId, ResultMark[]> = {
  ARS: ["W", "W", "D", "W", "W"],
  AVL: ["W", "W", "D", "W", "D"],
  BOU: ["L", "W", "D", "W", "D"],
  BRE: ["W", "L", "D", "D", "D"],
  BHA: ["D", "W", "W", "L", "D"],
  CHE: ["W", "D", "W", "W", "L"],
  COV: ["D", "L", "W", "L", "L"],
  CRY: ["D", "W", "L", "W", "W"],
  EVE: ["L", "D", "D", "W", "D"],
  FUL: ["W", "D", "W", "L", "L"],
  HUL: ["L", "D", "L", "D", "D"],
  IPS: ["L", "L", "D", "L", "L"],
  LEE: ["W", "L", "D", "W", "D"],
  LIV: ["W", "W", "W", "D", "W"],
  MCI: ["W", "W", "W", "W", "W"],
  MUN: ["L", "D", "W", "L", "D"],
  NEW: ["W", "L", "W", "W", "D"],
  NFO: ["D", "W", "L", "D", "D"],
  SUN: ["L", "D", "W", "L", "D"],
  TOT: ["W", "D", "L", "W", "D"],
};

export function formString(id: TeamId) {
  return FORM[id].join("");
}
