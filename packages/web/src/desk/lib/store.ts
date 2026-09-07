"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  FIXTURES,
  OPEN_FIXTURES,
  applyLiveSlate,
  getFixture,
  modelProbFor,
  settlesWon,
  type Fixture,
  type MarketKey,
} from "./data/fixtures";
import { PLAYERS_BY_ADP, getPlayer, type Pos } from "./data/players";
import { poisson } from "./format";
import type { VaultId } from "./data/vaults";

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

function applyScores(
  tickets: Ticket[],
  scores: Record<string, [number, number]>,
  cash: number,
) {
  const nextTickets = tickets.map((t) => {
    if (t.status !== "open") return t;
    const resolved = t.legs.map((leg) => {
      const sc = scores[leg.fixtureId];
      if (!sc) return "open";
      return settlesWon(sc, leg.market) ? "won" : "lost";
    });
    if (resolved.some((r) => r === "open")) return t;
    const won = resolved.every((r) => r === "won");
    return {
      ...t,
      status: won ? ("won" as const) : ("lost" as const),
      pnl: won ? t.stake * t.price - t.stake : -t.stake,
    };
  });
  let credit = 0;
  for (const t of nextTickets) {
    const old = tickets.find((o) => o.id === t.id);
    if (old?.status === "open" && t.status === "won") credit += t.stake * t.price;
  }
  return { tickets: nextTickets, cash: cash + credit };
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
  liveSource: "live" | "static" | "pending";
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
      cash: STARTING,
      tickets: [],
      slip: [],
      slipStake: 100,
      selectedId: OPEN_FIXTURES[2]?.id ?? OPEN_FIXTURES[0]?.id ?? "",
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
        if (!f || f.status === "ft") return get().scores[id] ?? null;
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
            if (!scores[f.id]) scores[f.id] = [poisson(f.xg[0]), poisson(f.xg[1])];
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
  if (!f) return null;
  const keys: MarketKey[] = ["home", "draw", "away", "over25", "under25", "bttsY", "bttsN"];
  let best: { key: MarketKey; edge: number; price: number } | null = null;
  for (const key of keys) {
    const e = modelProbFor(f, key) - 1 / f.odds[key];
    if (!best || e > best.edge) best = { key, edge: e, price: f.odds[key] };
  }
  return best;
}
