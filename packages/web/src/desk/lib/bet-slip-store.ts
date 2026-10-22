"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MarketKey } from "./data/fixtures";
import { toggleSelection, reconcileSelections } from "./bet-slip";

export type BetSelection = { fixtureId: string; market: MarketKey; price: number };
export type SlipMode = "singles" | "accumulator";

type SlipState = {
  selections: BetSelection[];
  stakeText: string;
  mode: SlipMode;
  toggle: (s: BetSelection) => void;
  remove: (fixtureId: string, market: MarketKey) => void;
  clear: () => void;
  setStakeText: (v: string) => void;
  setMode: (m: SlipMode) => void;
  reconcile: (priceFor: (fixtureId: string, market: string) => number | null) => void;
};

/** Bet slip calculator state. Saved in this browser only; nothing is placed anywhere. */
export const useBetSlip = create<SlipState>()(
  persist(
    (set) => ({
      selections: [],
      stakeText: "10",
      mode: "singles",
      toggle: (s) => set((st) => ({ selections: toggleSelection(st.selections, s) })),
      remove: (fixtureId, market) =>
        set((st) => ({ selections: st.selections.filter((s) => !(s.fixtureId === fixtureId && s.market === market)) })),
      clear: () => set({ selections: [] }),
      setStakeText: (v) => set({ stakeText: v }),
      setMode: (m) => set({ mode: m }),
      reconcile: (priceFor) => set((st) => ({ selections: reconcileSelections(st.selections, priceFor) })),
    }),
    { name: "pundit-bet-slip-v1", partialize: (s) => ({ selections: s.selections, stakeText: s.stakeText, mode: s.mode }) },
  ),
);
