import { fetchLiveSlate } from "./live";
import { OPEN_FIXTURES, SETTLED_FIXTURES } from "./data/fixtures";

export async function loadSlate() {
  try {
    return await fetchLiveSlate();
  } catch {
    return {
      open: OPEN_FIXTURES,
      settled: SETTLED_FIXTURES,
      source: "static" as const,
      asOf: new Date().toISOString(),
    };
  }
}
