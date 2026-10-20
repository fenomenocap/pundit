const SESSION_KEY = "pundit.take.v2.optIn";

let urlSynced = false;

/** Parse `take` query; only exact `v2` activates opt-in. */
export function isTakeV2QueryValue(value: string | null): boolean {
  return value === "v2";
}

/**
 * Read `?take=v2` once per page load and persist for the tab session.
 * Invalid values are ignored (session unchanged).
 */
export function syncPunditTakeV2OptInFromUrl(): void {
  if (typeof window === "undefined") return;
  if (urlSynced) return;
  urlSynced = true;
  const take = new URLSearchParams(window.location.search).get("take");
  if (isTakeV2QueryValue(take)) {
    sessionStorage.setItem(SESSION_KEY, "1");
  }
}

export function isPunditTakeV2OptInActive(): boolean {
  if (typeof window === "undefined") return false;
  syncPunditTakeV2OptInFromUrl();
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

/** JSON POST headers for `/api/ask`; byte-identical to legacy when opt-in is off. */
export function buildPunditAskJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isPunditTakeV2OptInActive()) {
    headers["x-pundit-take"] = "v2";
  }
  return headers;
}

/** Test-only reset. */
export function resetPunditTakeV2OptInForTests(): void {
  urlSynced = false;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function __testApplyTakeQuery(
  takeParam: string | null,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  if (isTakeV2QueryValue(takeParam)) {
    storage.setItem(SESSION_KEY, "1");
  }
}
