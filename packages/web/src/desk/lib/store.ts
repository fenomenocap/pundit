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
import { PLAYERS_BY_ADP, getPlayer, type Pos } from "./data/players";
import { poisson } from "./format";
import type { AskGrounding } from "@/lib/api";
import type { VaultId } from "./data/vaults";
import { reconcileHydratedPaperState, resolveHydratedSelection } from "./slate-selection";
import { applyScores } from "./paper-settlement";

const STARTING = 10_000;
const USER_SEAT = 3;
const TEAMS_N = 8;
const ROUNDS = 11;
const CPU_MS = 700;
const USER_MS = 20_000;

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

export type DraftTeam = {
  id: number;
  name: string;
  picks: string[];
};

export type ChatRole = "user" | "pundit";

export type ChatMsg = {
  id: string;
  role: ChatRole;
  text: string;
  fixtureId?: string;
  grounding?: AskGrounding;
  at: number;
};

const CPU_NAMES = [
  "False Nine",
  "High Line",
  "Gegenpress",
  "You",
  "Low Block",
  "Channel Run",
  "Rest Defence",
  "Second Ball",
];

function snakeSeat(pickIndex: number) {
  const round = Math.floor(pickIndex / TEAMS_N);
  const pos = pickIndex % TEAMS_N;
  return round % 2 === 0 ? pos : TEAMS_N - 1 - pos;
}

function needs(picks: string[]): Record<Pos, number> {
  const counts: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of picks) {
    const p = getPlayer(id);
    if (p) counts[p.pos] += 1;
  }
  return counts;
}

function legal(picks: string[], pos: Pos) {
  const c = needs(picks);
  const remaining = ROUNDS - picks.length;
  const next = { ...c, [pos]: c[pos] + 1 };
  if (next.GK > 1) return false;
  const minLeft =
    (next.GK < 1 ? 1 : 0) +
    Math.max(0, 3 - next.DEF) +
    Math.max(0, 3 - next.MID) +
    Math.max(0, 1 - next.FWD);
  return minLeft <= remaining - 1;
}

function cpuPick(taken: Set<string>, myPicks: string[]) {
  for (const p of PLAYERS_BY_ADP) {
    if (taken.has(p.id)) continue;
    if (legal(myPicks, p.pos)) return p.id;
  }
  return PLAYERS_BY_ADP.find((p) => !taken.has(p.id))?.id ?? PLAYERS_BY_ADP[0].id;
}

export type DraftPhase = "idle" | "live" | "done";

type State = {
  cash: number;
  tickets: Ticket[];
  slip: SlipLeg[];
  slipStake: number;
  selectedId: string;
  scores: Record<string, [number, number]>;
  vaultAlloc: Record<VaultId, number>;
  draftPhase: DraftPhase;
  draftPick: number;
  draftTeams: DraftTeam[];
  draftTimerEnds: number;
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
  startDraft: () => void;
  makePick: (playerId: string) => void;
  resetDraft: () => void;
  tickDraft: () => void;
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
      draftPhase: "idle",
      draftPick: 0,
      draftTeams: CPU_NAMES.map((name, id) => ({ id, name, picks: [] as string[] })),
      draftTimerEnds: 0,
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
        const score: [number, number] = [poisson(f.xg[0]), poisson(f.xg[1])];
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
            if (!scores[f.id] && f.xg) scores[f.id] = [poisson(f.xg[0]), poisson(f.xg[1])];
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
        if (amount < 10) return "Minimum 10 credits.";
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

      startDraft: () =>
        set({
          draftPhase: "live",
          draftPick: 0,
          draftTeams: CPU_NAMES.map((name, id) => ({ id, name, picks: [] })),
          draftTimerEnds: Date.now() + (snakeSeat(0) === USER_SEAT ? USER_MS : CPU_MS),
        }),

      makePick: (playerId) => {
        const s = get();
        if (s.draftPhase !== "live") return;
        const total = TEAMS_N * ROUNDS;
        if (s.draftPick >= total) return;
        const seat = snakeSeat(s.draftPick);
        const taken = new Set(s.draftTeams.flatMap((t) => t.picks));
        if (taken.has(playerId)) return;
        const team = s.draftTeams[seat];
        const player = getPlayer(playerId);
        if (!player || !legal(team.picks, player.pos)) return;
        const teams = s.draftTeams.map((t) =>
          t.id === seat ? { ...t, picks: [...t.picks, playerId] } : t,
        );
        const next = s.draftPick + 1;
        const done = next >= total;
        set({
          draftTeams: teams,
          draftPick: next,
          draftPhase: done ? "done" : "live",
          draftTimerEnds: done
            ? 0
            : Date.now() + (snakeSeat(next) === USER_SEAT ? USER_MS : CPU_MS),
        });
      },

      resetDraft: () =>
        set({
          draftPhase: "idle",
          draftPick: 0,
          draftTeams: CPU_NAMES.map((name, id) => ({ id, name, picks: [] })),
          draftTimerEnds: 0,
        }),

      tickDraft: () => {
        const s = get();
        if (s.draftPhase !== "live") return;
        if (Date.now() < s.draftTimerEnds) return;
        const seat = snakeSeat(s.draftPick);
        const taken = new Set(s.draftTeams.flatMap((t) => t.picks));
        get().makePick(cpuPick(taken, s.draftTeams[seat].picks));
      },

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

export { USER_SEAT, TEAMS_N, ROUNDS, snakeSeat, needs, legal };

export function rosterScore(picks: string[]) {
  const players = picks.map((id) => getPlayer(id)).filter(Boolean);
  const cats = [0, 0, 0, 0, 0, 0];
  for (const p of players) p!.heat.forEach((h, i) => (cats[i] += h));
  const avg = cats.map((c) => (players.length ? c / players.length : 0));
  const mean = avg.reduce((a, b) => a + b, 0) / 6;
  const value = players.reduce((a, p, i) => {
    const pickNo = i + 1;
    return a + (p!.adp - pickNo * (88 / 11));
  }, 0);
  const grade =
    mean >= 70 ? "ALL-PRO" : mean >= 60 ? "STARTER" : mean >= 50 ? "ROTATION" : "DEVELOPMENT";
  return { avg, mean, value, grade };
}

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
