"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchMarkets, fetchPolymarketMarkets, fetchUpcomingMatches, fetchRecentMatches, fetchStandings, fetchModelProbabilities, MOCK_PARTICIPANTS } from "@/lib/mock-data";
import { computeEliminatedTeams, isTeamEliminated } from "@/lib/team-status";
import { MarketCard, MarketCardSkeleton, MarketsEmptyState } from "@/components/market-card";
import { PolymarketTicker } from "@/components/polymarket-ticker";
import { OutrightsBoard } from "@/components/outrights-board";
import { formatStage } from "@/lib/stage-label";
import { getTeamFlag, getTeamColor } from "@/lib/team-logos";
import type { PolymarketMarket, MatchResponse, StandingResponse, ModelTeamProbability } from "@/lib/api";
import type { MarketResponse } from "@/lib/api";

// ─── Hook: fetch Polymarket WC markets (mock or live depending on USE_MOCK) ──
function usePolymarketData() {
  const [markets, setMarkets] = useState<PolymarketMarket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPolymarketMarkets()
      .then((data) => { if (!cancelled) setMarkets(data); })
      .catch(() => { if (!cancelled) setMarkets([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { markets, loading };
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timerRef.current);
  }, [value, delay]);
  return debounced;
}

const CATEGORIES = [
  { key: "ALL",       label: "All" },
  { key: "WORLD_CUP", label: "🏆 World Cup" },
] as const;

function useNextMatch() {
  const [match, setMatch] = useState<MatchResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUpcomingMatches().then((matches) => {
      if (!cancelled) setMatch(matches[0] ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  return match;
}

function useRecentMatches() {
  const [matches, setMatches] = useState<MatchResponse[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchRecentMatches().then((data) => {
      if (!cancelled) setMatches(data);
    });
    return () => { cancelled = true; };
  }, []);

  return matches;
}

function useStandings() {
  const [standings, setStandings] = useState<StandingResponse[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchStandings().then((data) => {
      if (!cancelled) setStandings(data);
    });
    return () => { cancelled = true; };
  }, []);

  return standings;
}

function useModelProbabilities() {
  const [teams, setTeams] = useState<ModelTeamProbability[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchModelProbabilities().then((data) => {
      if (!cancelled) setTeams(data);
    });
    return () => { cancelled = true; };
  }, []);

  return teams;
}

function useCountdownTo(targetISO: string | null) {
  const target = targetISO ? new Date(targetISO).getTime() : null;
  const [timeLeft, setTimeLeft] = useState(() => (target ? target - Date.now() : null));

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setTimeLeft(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (timeLeft === null || timeLeft <= 0) return null;
  return {
    days:  Math.floor(timeLeft / 86_400_000),
    hours: Math.floor((timeLeft % 86_400_000) / 3_600_000),
    mins:  Math.floor((timeLeft % 3_600_000) / 60_000),
    secs:  Math.floor((timeLeft % 60_000) / 1000),
  };
}

function TeamBlock({ name }: { name: string }) {
  const flag = getTeamFlag(name);
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center sm:flex-1">
      {flag && <span className="text-4xl sm:text-6xl">{flag}</span>}
      <span className="font-heading truncate max-w-full px-1 text-sm font-bold text-white sm:text-xl">
        {name}
      </span>
    </div>
  );
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<MarketResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("WORLD_CUP");
  const [search, setSearch] = useState("");
  const { markets: polymarkets, loading: polyLoading } = usePolymarketData();

  useEffect(() => {
    setLoading(true);
    fetchMarkets({ category: category === "ALL" ? undefined : category, sort: "closing_soon", limit: 100 })
      .then((res) => setMarkets(res.markets))
      .finally(() => setLoading(false));
  }, [category]);

  const debouncedSearch = useDebounce(search, 250);
  const filtered = useMemo(() => {
    const now = Date.now();
    const active = markets.filter((m) => new Date(m.resolutionTimestamp).getTime() > now);
    if (!debouncedSearch.trim()) return active;
    const q = debouncedSearch.toLowerCase();
    return active.filter((m) => m.question.toLowerCase().includes(q));
  }, [markets, debouncedSearch]);

  const matchups = useMemo(() => filtered.filter((m) => m.teamB), [filtered]);

  const nextMatch = useNextMatch();
  const recentMatches = useRecentMatches();
  const standings = useStandings();
  const modelProbabilities = useModelProbabilities();

  const eliminatedTeams = useMemo(
    () => computeEliminatedTeams(standings, recentMatches),
    [standings, recentMatches]
  );
  const outrights = useMemo(() => {
    const alive = filtered.filter((m) => !m.teamB && !(m.teamA && isTeamEliminated(m.teamA, eliminatedTeams)));
    // Defensive dedupe: seed data currently contains duplicate outright
    // markets per team (same question seeded twice) — keep the one with
    // the most volume until the underlying duplicate rows are cleaned up.
    const byTeam = new Map<string, MarketResponse>();
    for (const m of alive) {
      const key = m.teamA ?? m.id;
      const existing = byTeam.get(key);
      if (!existing || BigInt(m.totalVolume) > BigInt(existing.totalVolume)) {
        byTeam.set(key, m);
      }
    }
    return Array.from(byTeam.values());
  }, [filtered, eliminatedTeams]);
  const countdown = useCountdownTo(nextMatch?.utcDate ?? null);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Hero: next match matchup banner */}
      {nextMatch && (
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-border">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(115deg, ${getTeamColor(nextMatch.homeTeam)}3d 0%, transparent 42%, transparent 58%, ${getTeamColor(nextMatch.awayTeam)}3d 100%)`,
            }}
          />
          <div className="relative px-5 py-7 sm:px-10 sm:py-9">
            <div className="mb-5 flex items-center justify-center gap-2">
              <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                {formatStage(nextMatch.stage)}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Next Match
              </span>
            </div>

            <div className="flex items-center justify-center gap-3 sm:gap-10">
              <TeamBlock name={nextMatch.homeTeam} />

              <div className="flex shrink-0 flex-col items-center gap-2">
                <span className="font-heading text-xl font-black italic text-muted-foreground/40 sm:text-2xl">
                  VS
                </span>
                {countdown ? (
                  <div className="flex items-center gap-2 sm:gap-3">
                    {[
                      { value: countdown.days,  label: "d"  },
                      { value: countdown.hours, label: "h" },
                      { value: countdown.mins,  label: "m"  },
                      { value: countdown.secs,  label: "s"  },
                    ].map(({ value, label }) => (
                      <div key={label} className="flex flex-col items-center">
                        <span className="font-heading text-xl font-black tabular-nums text-white sm:text-2xl">
                          {String(value).padStart(2, "0")}
                        </span>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-cyan-400/70">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400 animate-pulse">
                    Kicking off
                  </span>
                )}
              </div>

              <TeamBlock name={nextMatch.awayTeam} />
            </div>
          </div>
        </div>
      )}

      {!nextMatch && (
        <div className="mb-8">
          <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl">Pundit</h1>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-lg">
            Your edge in sports prediction markets. Bet on real outcomes, trade with limit orders, and beat the crowd.
          </p>
        </div>
      )}

      {/* Recent results strip */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Results
          </h3>
          <a href="/fixtures" className="text-[10px] font-medium text-cyan-400 hover:text-cyan-300">
            Full bracket &rarr;
          </a>
        </div>
        {recentMatches.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">No recent results yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recentMatches.slice(0, 6).map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-md p-2 transition-colors hover:bg-secondary/30"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-400 uppercase shrink-0">
                    {formatStage(m.stage)}
                  </span>
                  <p className="truncate text-xs font-medium text-foreground">
                    {m.homeTeam} vs {m.awayTeam}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
                  {m.score ? `${m.score.home} - ${m.score.away}` : "FT"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Live Polymarket reference ticker ── */}
      {!polyLoading && <PolymarketTicker markets={polymarkets} />}

      {/* Category tabs + search */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                category === cat.key
                  ? "bg-cyan-500/15 text-cyan-400"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets..."
            className="h-8 w-56 rounded-lg border border-border bg-card px-3 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Matchup + outright markets */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <MarketsEmptyState />
      ) : (
        <>
          {matchups.length > 0 && (
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {matchups.map((m) => (
                <MarketCard
                  key={m.id}
                  market={m}
                  participants={MOCK_PARTICIPANTS[m.id] ?? 0}
                />
              ))}
            </div>
          )}
          <OutrightsBoard markets={outrights} title="Tournament Winner" modelProbabilities={modelProbabilities} />
        </>
      )}
    </div>
  );
}
