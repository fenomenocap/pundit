"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EMPTY_SQUAD, type Squad } from "./fpl-squad";

type FplState = {
  squad: Squad;
  setSquad: (s: Squad) => void;
  reset: () => void;
};

/** The squad is saved in this browser only. No FPL login, no import. */
export const useFplSquad = create<FplState>()(
  persist(
    (set) => ({
      squad: EMPTY_SQUAD,
      setSquad: (squad) => set({ squad }),
      reset: () => set({ squad: EMPTY_SQUAD }),
    }),
    { name: "pundit-fpl-squad-v1" },
  ),
);
