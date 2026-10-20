"use client";

import { useEffect } from "react";
import { syncPunditTakeV2OptInFromUrl } from "@/lib/pundit-take-v2-opt-in";

/** Runs once on load so in-app navigation keeps ?take=v2 or ?take=legacy for the tab session. */
export function PunditTakeV2OptInBootstrap() {
  useEffect(() => {
    syncPunditTakeV2OptInFromUrl();
  }, []);
  return null;
}
