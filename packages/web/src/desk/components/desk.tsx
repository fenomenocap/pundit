"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { gw3Record } from "@/desk/lib/data/fixtures";
import { fmtPct } from "@/desk/lib/format";
import { loadSlate } from "@/desk/lib/slate";
import { useDesk } from "@/desk/lib/store";
import { AgentPane } from "@/desk/components/agent-pane";
import { MatchIntel } from "@/desk/components/match-intel";
import { SlateChips, SlateRail } from "@/desk/components/slate-rail";
import { Ticker } from "@/desk/components/ticker";
import { useLiveSlate } from "@/desk/components/use-live-slate";

export function Desk() {
  const rec = gw3Record();
  const { source } = useLiveSlate();
  const select = useDesk((s) => s.selectFixture);
  const queueAsk = useDesk((s) => s.queueAsk);
  const params = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    void loadSlate()
      .then((slate) => {
        if (cancelled) return;
        useDesk.getState().hydrateSlate(slate.open, slate.settled, slate.source);
      })
      .catch((error) => {
        console.warn("[desk] live slate hydrate failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const fixture = params.get("fixture");
    const q = params.get("q");
    if (fixture) select(fixture);
    if (q) queueAsk(q);
  }, [params, select, queueAsk]);

  return (
    <div className="flex flex-col min-h-0">
      <Ticker />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-surface px-3 sm:px-4 py-2 text-xs">
        <span className="eyebrow">{source === "live" ? "Live model" : "GW3 model"}</span>
        <span className="font-display text-base tabular-nums leading-none">
          {rec.hits}/{rec.n} <span className="text-quiet">1X2</span> {fmtPct(rec.pct)}
        </span>
        <span className="hidden sm:inline text-quiet">
          Analysis only — not betting advice.
        </span>
      </div>
      <SlateChips />
      <div className="grid lg:grid-cols-[minmax(240px,300px)_minmax(0,1.2fr)_minmax(280px,340px)] min-h-0">
        <SlateRail />
        <AgentPane />
        <MatchIntel />
      </div>
    </div>
  );
}
