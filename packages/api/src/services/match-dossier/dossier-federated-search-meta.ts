import { openRouterModelId } from "../inference-config";

/** Documented stack for dossier federated search cost estimation (#188 path). */
export const DOSSIER_FEDERATED_SEARCH_STACK = {
  provider: "openrouter",
  model: openRouterModelId(),
  tool: "openrouter:web_search",
  searchEngine: "exa",
  searchMode: "fast",
  maxResultsPerQuery: 8,
} as const;

export function logDossierFederatedSearchStack(): void {
  console.log(JSON.stringify({
    event: "dossier_federated_search_stack",
    ...DOSSIER_FEDERATED_SEARCH_STACK,
  }));
}
