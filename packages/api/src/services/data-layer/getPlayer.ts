import type { FederatedGrounding } from "../federated-evidence";
import { getTeamNews, type TeamNewsHit } from "./getTeamNews";
import type { DataLayerResult } from "./types";

export interface GetPlayerInput {
  player: string;
  club?: string;
  grounding?: FederatedGrounding;
}

export async function getPlayer(
  input: GetPlayerInput,
  signal?: AbortSignal,
): Promise<DataLayerResult<TeamNewsHit[]>> {
  const clubClause = input.club ? ` at ${input.club}` : "";
  const question = `Latest injury and availability news for ${input.player}${clubClause}`;
  return getTeamNews({ question, grounding: input.grounding }, signal);
}
