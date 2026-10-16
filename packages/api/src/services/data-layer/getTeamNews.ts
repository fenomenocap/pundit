import {
  mergeSearchResults,
  planFederatedQueries,
  type FederatedGrounding,
} from "../federated-evidence";
import { searchWeb, type WebSearchOutcome } from "../web-search";
import type { DataLayerResult } from "./types";
import { dataLayerResult } from "./types";
import { currentFreshnessBlock } from "./shared";

export interface TeamNewsHit {
  title: string;
  link: string;
  snippet: string;
  date: string;
  tier: "official" | "analytics" | "news" | "other";
}

export interface GetTeamNewsInput {
  question: string;
  grounding?: FederatedGrounding;
}

export async function getTeamNews(
  input: GetTeamNewsInput,
  signal?: AbortSignal,
): Promise<DataLayerResult<TeamNewsHit[]>> {
  const queries = planFederatedQueries(input.question, input.grounding ?? null, input.question);
  const outcomes: WebSearchOutcome[] = [];
  for (const query of queries) {
    outcomes.push(await searchWeb(query, signal));
  }
  const merged = mergeSearchResults(outcomes, { asksStats: false });
  const asOf = new Date().toISOString();
  const data = merged.map((row) => ({
    title: row.title,
    link: row.link,
    snippet: row.snippet,
    date: row.date,
    tier: row.tier,
  }));
  return dataLayerResult({
    data,
    sources: data.map((row, index) => ({
      id: `search-${index + 1}`,
      label: row.title,
      trustTier: row.tier,
      observedAt: row.date || asOf,
      url: row.link,
    })),
    asOf,
    stale: false,
    freshness: currentFreshnessBlock(),
  });
}
