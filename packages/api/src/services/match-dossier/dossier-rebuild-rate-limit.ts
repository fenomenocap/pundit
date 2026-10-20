/** Minimum interval between authorized slate rebuild triggers. */
export const DOSSIER_SLATE_REBUILD_COOLDOWN_MS = 30 * 60 * 1000;

/** Minimum interval between authorized per-fixture rebuild triggers (per fixture key). */
export const DOSSIER_FIXTURE_REBUILD_COOLDOWN_MS = 10 * 60 * 1000;

let lastSlateRebuildTriggeredAt: number | null = null;
const lastFixtureRebuildTriggeredAt = new Map<string, number>();

export function resetDossierRebuildRateLimitsForTests(): void {
  lastSlateRebuildTriggeredAt = null;
  lastFixtureRebuildTriggeredAt.clear();
}

export function setLastSlateRebuildTriggeredAtForTests(atMs: number): void {
  lastSlateRebuildTriggeredAt = atMs;
}

export function slateRebuildCooldownRetryAfterSec(nowMs = Date.now()): number | null {
  if (lastSlateRebuildTriggeredAt == null) return null;
  const remaining = DOSSIER_SLATE_REBUILD_COOLDOWN_MS - (nowMs - lastSlateRebuildTriggeredAt);
  if (remaining <= 0) return null;
  return Math.ceil(remaining / 1000);
}

export function noteSlateRebuildTriggered(nowMs = Date.now()): void {
  lastSlateRebuildTriggeredAt = nowMs;
}

export function fixtureRebuildCooldownRetryAfterSec(
  fixtureKey: string,
  nowMs = Date.now(),
): number | null {
  const last = lastFixtureRebuildTriggeredAt.get(fixtureKey);
  if (last == null) return null;
  const remaining = DOSSIER_FIXTURE_REBUILD_COOLDOWN_MS - (nowMs - last);
  if (remaining <= 0) return null;
  return Math.ceil(remaining / 1000);
}

export function noteFixtureRebuildTriggered(fixtureKey: string, nowMs = Date.now()): void {
  lastFixtureRebuildTriggeredAt.set(fixtureKey, nowMs);
}
