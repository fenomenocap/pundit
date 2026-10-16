import type { FederatedGrounding } from "../federated-evidence";
import { getTeamNews, type TeamNewsHit } from "./getTeamNews";
import type { DataLayerResult } from "./types";

export interface GetManagersInput {
  club: string;
  grounding?: FederatedGrounding;
}

export async function getManagers(
  input: GetManagersInput,
  signal?: AbortSignal,
): Promise<DataLayerResult<TeamNewsHit[]>> {
  const question = `Who is the current manager of ${input.club}?`;
  return getTeamNews({ question, grounding: input.grounding }, signal);
}
