import { fetchLiveSlate, resetLiveScorers } from "./live";
import { OPEN_FIXTURES, SETTLED_FIXTURES } from "./data/fixtures";

export async function loadSlate() {
  try {
    return await fetchLiveSlate();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.warn("[desk] live slate unavailable; using static fixtures", message);
    resetLiveScorers();
    return {
      open: OPEN_FIXTURES,
      settled: SETTLED_FIXTURES,
      source: "static" as const,
      asOf: new Date().toISOString(),
    };
  }
}
