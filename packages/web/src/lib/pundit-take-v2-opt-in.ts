const SESSION_KEY = "pundit.take.v2.optIn";

let urlSynced = false;

/** Parse `take` query; only exact `v2` selects the explicit v2 session. */
export function isTakeV2QueryValue(value: string | null): boolean {
  return value === "v2";
}

/** Parse `take` query; only exact `legacy` selects the rollback session. */
export function isTakeLegacyQueryValue(value: string | null): boolean {
  return value === "legacy";
}

/**
 * Read `?take=v2` or `?take=legacy` once per page load and persist for the tab session.
 * Invalid values are ignored (session unchanged). Absence leaves the stored value.
 */
export function syncPunditTakeV2OptInFromUrl(): void {
  if (typeof window === "undefined") return;
  if (urlSynced) return;
  urlSynced = true;
  const take = new URLSearchParams(window.location.search).get("take");
  if (isTakeV2QueryValue(take)) {
    sessionStorage.setItem(SESSION_KEY, "1");
  } else if (isTakeLegacyQueryValue(take)) {
    sessionStorage.setItem(SESSION_KEY, "legacy");
  }
}

function storedTakePreference(): "v2" | "legacy" | null {
  if (typeof window === "undefined") return null;
  syncPunditTakeV2OptInFromUrl();
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (raw === "1" || raw === "v2") return "v2";
  if (raw === "legacy") return "legacy";
  return null;
}

/** Explicit `?take=v2` session. The no-query default is also v2, without this flag. */
export function isPunditTakeV2OptInActive(): boolean {
  return storedTakePreference() === "v2";
}

/**
 * GFM tables and the collapsed Sources disclosure.
 * On for the default and for `?take=v2`. Off only for `?take=legacy`.
 */
export function isPunditTakeV2RenderingActive(): boolean {
  if (typeof window === "undefined") return true;
  return storedTakePreference() !== "legacy";
}

/**
 * JSON POST headers for `/api/ask`.
 * Default omits `x-pundit-take` (API `DEFAULT_TAKE` is v2).
 * `?take=v2` sends v2. `?take=legacy` sends legacy.
 */
export function buildPunditAskJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const preference = storedTakePreference();
  if (preference === "legacy") headers["x-pundit-take"] = "legacy";
  else if (preference === "v2") headers["x-pundit-take"] = "v2";
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
  } else if (isTakeLegacyQueryValue(takeParam)) {
    storage.setItem(SESSION_KEY, "legacy");
  }
}
