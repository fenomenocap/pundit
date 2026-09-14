import { fetchLiveSlate, resetLiveScorers, resetLiveStats } from "./live";
import { OPEN_FIXTURES, SETTLED_FIXTURES } from "./data/fixtures";

export async function loadSlate() {
  try {
    return await fetchLiveSlate();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    const useStaticFixtures = process.env.NEXT_PUBLIC_USE_MOCK === "true";
    console.warn(
      useStaticFixtures
        ? "[desk] live slate unavailable; using explicit mock fixtures"
        : "[desk] live slate unavailable",
      message,
    );
    resetLiveScorers();
    resetLiveStats();
    return {
      open: useStaticFixtures ? OPEN_FIXTURES : [],
      settled: useStaticFixtures ? SETTLED_FIXTURES : [],
      source: useStaticFixtures ? "static" as const : "unavailable" as const,
      asOf: new Date().toISOString(),
    };
  }
}
