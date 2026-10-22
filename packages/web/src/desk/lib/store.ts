"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  FIXTURES,
  OPEN_FIXTURES,
  hasCapturedForecast,
  applyLiveSlate,
  getFixture,
  modelProbFor,
  type Fixture,
  type MarketKey,
} from "./data/fixtures";
import { samplePaperScore } from "./grid";
import type { AskGrounding, AskPresentation } from "@/lib/api";
import { VAULTS, type VaultId } from "./data/vaults";
import { reconcileHydratedPaperState, resolveHydratedSelection } from "./slate-selection";
import { applyScores } from "./paper-settlement";

const STARTING = 10_000;
export type SlipLeg = {
  fixtureId: string;
  market: MarketKey;
  price: number;
};

export type Ticket = {
  id: string;
  legs: SlipLeg[];
  stake: number;
  price: number;
  status: "open" | "won" | "lost";
  pnl: number;
  placedAt: number;
};

export type ChatRole = "user" | "pundit";

export type ChatMsg = {
  id: string;
  role: ChatRole;
  text: string;
  fixtureId?: string;
  grounding?: AskGrounding;
  presentation?: AskPresentation;
  sourceLabel?: "ESPN result";
  at: number;
};

type State = {
  cash: number;
  tickets: Ticket[];
  slip: SlipLeg[];
  slipStake: number;
  selectedId: string;
  scores: Record<string, [number, number]>;
  vaultAlloc: Record<VaultId, number>;
  messages: ChatMsg[];
  queuedAsk: string | null;
  slateEpoch: number;
  liveSource: "live" | "no-fixtures" | "static" | "unavailable" | "pending";
  addLeg: (leg: SlipLeg) => void;
  removeLeg: (fixtureId: string, market: MarketKey) => void;
  setStake: (n: number) => void;
  clearSlip: () => void;
  placeSlip: () => string | null;
  selectFixture: (id: string) => void;
  simulate: (id: string) => [number, number] | null;
  simulateAll: () => void;
  resetBook: () => void;
  allocate: (id: VaultId, amount: number) => string | null;
  withdrawVault: (id: VaultId) => void;
  pushChat: (msg: ChatMsg) => void;
  removeChat: (id: string) => void;
  resetChat: () => void;
  queueAsk: (text: string) => void;
  clearQueuedAsk: () => void;
  hydrateSlate: (open: Fixture[], settled: Fixture[], source: "live" | "no-fixtures" | "static" | "unavailable") => void;
};

const ftScores = Object.fromEntries(
  FIXTURES.filter((f) => f.status === "ft" && f.score).map((f) => [f.id, f.score as [number, number]]),
);

export const useDesk = create<State>()(
  persist(
    (set, get) => ({
      cash: STARTING,
      tickets: [],
      slip: [],
      slipStake: 100,
      selectedId: "",
      scores: ftScores,
      vaultAlloc: { alpha: 0, neutral: 0, yield: 0 },
      messages: [],
      queuedAsk: null,
      slateEpoch: 0,
      liveSource: "pending",

      addLeg: (leg) =>
        set((s) => {
          if (s.slip.some((l) => l.fixtureId === leg.fixtureId && l.market === leg.market)) {
            return {
              slip: s.slip.filter((l) => !(l.fixtureId === leg.fixtureId && l.market === leg.market)),
            };
          }
          return {
            slip: [...s.slip.filter((l) => l.fixtureId !== leg.fixtureId), leg],
            selectedId: leg.fixtureId,
          };
        }),

      removeLeg: (fixtureId, market) =>
        set((s) => ({
          slip: s.slip.filter((l) => !(l.fixtureId === fixtureId && l.market === market)),
        })),

      setStake: (n) => set({ slipStake: Math.max(10, Math.min(n, get().cash)) }),

      clearSlip: () => set({ slip: [] }),

      placeSlip: () => {
        const s = get();
        if (s.slip.length === 0) return "Add a selection first.";
        if (s.slipStake > s.cash) return "Not enough credit.";
        if (s.slipStake < 10) return "Minimum stake is 10.";
        const price = s.slip.reduce((a, l) => a * l.price, 1);
        const ticket: Ticket = {
          id: `t-${Date.now()}`,
          legs: s.slip,
          stake: s.slipStake,
          price,
          status: "open",
          pnl: 0,
          placedAt: Date.now(),
        };
        set({ tickets: [ticket, ...s.tickets], cash: s.cash - s.slipStake, slip: [] });
        return null;
      },

      selectFixture: (id) => set({ selectedId: id }),

      simulate: (id) => {
        const f = getFixture(id);
        if (!f || f.status === "ft" || !f.xg) return get().scores[id] ?? null;
        if (get().scores[id]) return get().scores[id];
        const score: [number, number] = samplePaperScore(f);
        set((s) => {
          const scores = { ...s.scores, [id]: score };
          const applied = applyScores(s.tickets, scores, s.cash);
          return { scores, tickets: applied.tickets, cash: applied.cash };
        });
        return score;
      },

      simulateAll: () => {
        set((st) => {
          const scores = { ...st.scores };
          for (const f of OPEN_FIXTURES) {
            if (!scores[f.id] && f.xg) scores[f.id] = samplePaperScore(f);
          }
          const applied = applyScores(st.tickets, scores, st.cash);
          return { scores, tickets: applied.tickets, cash: applied.cash };
        });
      },

      resetBook: () =>
        set({
          cash: STARTING,
          tickets: [],
          slip: [],
          slipStake: 100,
          scores: ftScores,
          vaultAlloc: { alpha: 0, neutral: 0, yield: 0 },
        }),

      allocate: (id, amount) => {
        const s = get();
        if (!Number.isFinite(amount)) return "Enter a finite credit amount.";
        const minimum = VAULTS.find((vault) => vault.id === id)!.min;
        if (amount < minimum) return `Minimum ${minimum} credits.`;
        if (amount > s.cash) return "Not enough credit.";
        set({
          cash: s.cash - amount,
          vaultAlloc: { ...s.vaultAlloc, [id]: s.vaultAlloc[id] + amount },
        });
        return null;
      },

      withdrawVault: (id) =>
        set((s) => ({
          cash: s.cash + s.vaultAlloc[id],
          vaultAlloc: { ...s.vaultAlloc, [id]: 0 },
        })),

      pushChat: (msg) =>
        set((s) => ({
          messages: [...s.messages, msg].slice(-40),
        })),

      removeChat: (id) =>
        set((s) => ({
          messages: s.messages.filter((msg) => msg.id !== id),
        })),

      resetChat: () => set({ messages: [], selectedId: "", queuedAsk: null }),

      queueAsk: (text) => set({ queuedAsk: text }),
      clearQueuedAsk: () => set({ queuedAsk: null }),

      hydrateSlate: (open, settled, source) => {
        applyLiveSlate(open, settled);
        const current = get();
        if (source === "unavailable") {
          set({
            selectedId: "",
            slip: [],
            liveSource: source,
            slateEpoch: current.slateEpoch + 1,
          });
          return;
        }
        const reconciled = reconcileHydratedPaperState(
          current.slip,
          current.tickets,
          current.scores,
          open,
          settled,
        );
        const scores: Record<string, [number, number]> = { ...reconciled.scores };
        const refundedStake = reconciled.removedTickets
          .filter((ticket) => ticket.status === "open")
          .reduce((sum, ticket) => sum + ticket.stake, 0);
        for (const f of settled) {
          if (f.score) scores[f.id] = f.score;
        }
        const applied = applyScores(
          reconciled.tickets,
          scores,
          current.cash + refundedStake,
        );
        set({
          scores,
          slip: reconciled.slip,
          tickets: applied.tickets,
          cash: applied.cash,
          // Never preserve a persisted fixture that is absent from the live
          // priced slate. Finished results stay on the rail for paper, but they
          // must not leak back into chat as an active forecast pin.
          selectedId: resolveHydratedSelection(current.selectedId, open),
          liveSource: source,
          slateEpoch: current.slateEpoch + 1,
        });
      },
    }),
    {
      name: "pundit-desk-v2",
      partialize: (s) => ({
        cash: s.cash,
        tickets: s.tickets,
        selectedId: s.selectedId,
        scores: s.scores,
        vaultAlloc: s.vaultAlloc,
        messages: s.messages,
      }),
    },
  ),
);

export function bestEdge(fixtureId: string) {
  const f = getFixture(fixtureId);
  if (!f?.odds || !hasCapturedForecast(f)) return null;
  const keys: MarketKey[] = ["home", "draw", "away", "over25", "under25", "bttsY", "bttsN"];
  let best: { key: MarketKey; edge: number; price: number } | null = null;
  for (const key of keys) {
    const price = f.odds[key];
    if (price === null) continue;
    const e = modelProbFor(f, key) - 1 / price;
    if (!best || e > best.edge) best = { key, edge: e, price };
  }
  return best;
}
