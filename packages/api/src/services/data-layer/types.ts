import type { AgentFreshnessMetadata } from "../../config/freshness-policy";
import type { EvidenceTier } from "../evidence-authority";

export type DataTrustTier = EvidenceTier | "fixture-spine" | "model-pin" | "market-fetch";

export interface DataLayerSource {
  id: string;
  label: string;
  trustTier: DataTrustTier;
  observedAt: string;
  url?: string;
}

export interface DataLayerResult<T> {
  data: T;
  sources: DataLayerSource[];
  asOf: string;
  stale: boolean;
  freshness?: AgentFreshnessMetadata;
}

export function dataLayerResult<T>(input: {
  data: T;
  sources: DataLayerSource[];
  asOf: string;
  stale?: boolean;
  freshness?: AgentFreshnessMetadata;
}): DataLayerResult<T> {
  return {
    data: input.data,
    sources: input.sources,
    asOf: input.asOf,
    stale: input.stale ?? false,
    ...(input.freshness ? { freshness: input.freshness } : {}),
  };
}
