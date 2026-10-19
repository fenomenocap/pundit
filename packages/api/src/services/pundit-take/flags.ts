import { AsyncLocalStorage } from "node:async_hooks";
import type { MatchDossier } from "../match-dossier/types";
import type { PunditTakeDelivery } from "./types";

export type PunditTakeMode = "legacy" | "v2";

interface TakeRequestScope {
  mode: PunditTakeMode;
  delivery: PunditTakeDelivery | null;
  dossier: MatchDossier | null;
  prefetchedDelivery: PunditTakeDelivery | null;
}

const takeRequestScope = new AsyncLocalStorage<TakeRequestScope>();

export function configuredPunditTakeV2(): boolean {
  return process.env.PUNDIT_TAKE_V2?.trim().toLowerCase() === "true";
}

/** Parse `x-pundit-take` without applying eval guard policy. */
export function parsePunditTakeHeaderValue(
  raw: string | string[] | undefined,
): PunditTakeMode | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (value === "v2") return "v2";
  if (value === "legacy" || value === "v1") return "legacy";
  return null;
}

export function isPunditTakeEvalOverrideGuardActive(searchReplayActive: boolean): boolean {
  if (searchReplayActive) return true;
  const configured = process.env.CHAT_ENGINE?.trim().toLowerCase();
  if (!configured) return true;
  return configured === "legacy" || configured === "agent";
}

export function resolvePunditTakeOverride(
  raw: string | string[] | undefined,
  evalGuardActive: boolean,
): PunditTakeMode | null {
  if (!evalGuardActive && !configuredPunditTakeV2()) return null;
  if (!evalGuardActive) return parsePunditTakeHeaderValue(raw);
  return parsePunditTakeHeaderValue(raw);
}

export function effectivePunditTakeMode(headerOverride: PunditTakeMode | null): PunditTakeMode {
  if (headerOverride === "v2") return "v2";
  if (headerOverride === "legacy") return "legacy";
  if (configuredPunditTakeV2()) return "v2";
  return "legacy";
}

export function punditTakeV2Active(): boolean {
  const scoped = takeRequestScope.getStore();
  if (scoped) return scoped.mode === "v2";
  return configuredPunditTakeV2();
}

export function stashPunditTakeDelivery(delivery: PunditTakeDelivery): void {
  const scoped = takeRequestScope.getStore();
  if (scoped) scoped.delivery = delivery;
}

export function consumePunditTakeDelivery(): PunditTakeDelivery | null {
  const scoped = takeRequestScope.getStore();
  return scoped?.delivery ?? null;
}

/** Optional hot-path dossier injection (stored snapshot only; no builder import). */
export function stashTakeDossier(dossier: MatchDossier | null): void {
  const scoped = takeRequestScope.getStore();
  if (scoped) scoped.dossier = dossier;
}

export function consumeTakeDossier(): MatchDossier | null {
  const scoped = takeRequestScope.getStore();
  return scoped?.dossier ?? null;
}

export function stashPrefetchedTakeDelivery(delivery: PunditTakeDelivery | null): void {
  const scoped = takeRequestScope.getStore();
  if (scoped) scoped.prefetchedDelivery = delivery;
}

export function consumePrefetchedTakeDelivery(): PunditTakeDelivery | null {
  const scoped = takeRequestScope.getStore();
  const delivery = scoped?.prefetchedDelivery ?? null;
  if (scoped) scoped.prefetchedDelivery = null;
  return delivery;
}

export function withPunditTakeRequestScope<T>(
  headerOverride: PunditTakeMode | null,
  fn: () => T,
): T {
  const effective = effectivePunditTakeMode(headerOverride);
  if (effective !== "v2") return fn();
  return takeRequestScope.run({
    mode: "v2",
    delivery: null,
    dossier: null,
    prefetchedDelivery: null,
  }, fn);
}
