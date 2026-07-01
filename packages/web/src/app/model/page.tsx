"use client";

import { useEffect } from "react";

const MODEL_URL = process.env.NEXT_PUBLIC_MODEL_DATA_BASE_URL || "https://worldcup-model.vercel.app";

export default function ModelPage() {
  useEffect(() => {
    document.title = "Model | Pundit";
    return () => { document.title = "Pundit"; };
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          Model
        </span>
        <span className="text-[10px] text-muted-foreground">
          Reference only — Elo/Poisson simulation, not tradeable
        </span>
      </div>

      {/* Embedded worldcup-model site */}
      <iframe
        src={MODEL_URL}
        title="2026 FIFA World Cup Model"
        className="flex-1 border-0"
      />
    </div>
  );
}
