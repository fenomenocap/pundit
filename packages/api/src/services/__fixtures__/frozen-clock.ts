import { vi } from "vitest";

/**
 * Pin only `Date` (timers stay real) so suites that build dossiers or read
 * pinned model artifacts do not depend on the wall-clock date. The instant sits
 * inside the validity window of every committed pin (calibration origin
 * 2026-10-07, ClubElo pin 2026-10-20), so freshness checks run on their normal
 * path instead of fail-closed.
 */
export const FROZEN_NOW_ISO = "2026-10-22T12:00:00.000Z";

export function freezeWallClock(iso: string = FROZEN_NOW_ISO): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

export function restoreWallClock(): void {
  vi.useRealTimers();
}
