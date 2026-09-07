"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  FIXTURES,
  OPEN_FIXTURES,
  applyLiveSlate,
  type Fixture,
} from "./data/fixtures";

export type ChatRole = "user" | "pundit";

export type ChatMsg = {
  id: string;
  role: ChatRole;
  text: string;
  fixtureId?: string;
  at: number;
};

type State = {
  selectedId: string;
  scores: Record<string, [number, number]>;
  messages: ChatMsg[];
  queuedAsk: string | null;
  slateEpoch: number;
  liveSource: "live" | "static" | "pending";
  selectFixture: (id: string) => void;
  simulate: (id: string) => [number, number] | null;
  pushChat: (msg: ChatMsg) => void;
  resetChat: () => void;
  queueAsk: (text: string) => void;
  clearQueuedAsk: () => void;
  hydrateSlate: (open: Fixture[], settled: Fixture[], source: "live" | "static") => void;
};

const ftScores = Object.fromEntries(
  FIXTURES.filter((f) => f.status === "ft" && f.score).map((f) => [f.id, f.score as [number, number]]),
);

export const useDesk = create<State>()(
  persist(
    (set, get) => ({
      selectedId: OPEN_FIXTURES[2]?.id ?? OPEN_FIXTURES[0]?.id ?? "",
      scores: ftScores,
      messages: [],
      queuedAsk: null,
      slateEpoch: 0,
      liveSource: "pending",

      selectFixture: (id) => set({ selectedId: id }),
      simulate: () => null,
      pushChat: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      resetChat: () => set({ messages: [] }),
      queueAsk: (text) => set({ queuedAsk: text }),
      clearQueuedAsk: () => set({ queuedAsk: null }),

      hydrateSlate: (open, settled, source) => {
        applyLiveSlate(open, settled);
        const scores: Record<string, [number, number]> = { ...get().scores };
        for (const f of settled) {
          if (f.score) scores[f.id] = f.score;
        }
        const still = open.some((f) => f.id === get().selectedId);
        const banker =
          open.find((f) => f.home === "LIV" && f.away === "FUL") ??
          open.find((f) => f.home === "MUN" && f.away === "MCI") ??
          open[0];
        set({
          scores,
          selectedId: still ? get().selectedId : banker?.id ?? get().selectedId,
          liveSource: source,
          slateEpoch: get().slateEpoch + 1,
        });
      },
    }),
    {
      name: "pundit-desk",
      partialize: (s) => ({
        selectedId: s.selectedId,
        messages: s.messages,
      }),
    },
  ),
);
