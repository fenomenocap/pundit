"use client";

import Link from "next/link";

export default function ArenaPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        {/* Coming soon hero */}
        <div className="relative mb-8 flex h-24 w-24 items-center justify-center">
          <div className="absolute inset-0 animate-pulse rounded-full bg-cyan-500/10" />
          <div className="absolute inset-2 rounded-full border-2 border-dashed border-cyan-500/30 animate-spin" style={{ animationDuration: "8s" }} />
          <span className="relative text-4xl">&#9889;</span>
        </div>

        <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl">
          The Arena
        </h1>
        <p className="mt-3 max-w-md text-center text-sm text-muted-foreground leading-relaxed">
          A new way to bet on sports is coming. Head-to-head challenges, parlay builders,
          and more &mdash; all onchain.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <div className="rounded-lg border border-border bg-card px-5 py-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
            <div className="mt-1 text-sm font-semibold text-cyan-400">In Development</div>
          </div>
          <div className="rounded-lg border border-border bg-card px-5 py-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA</div>
            <div className="mt-1 text-sm font-semibold text-foreground">TBD</div>
          </div>
        </div>

        <Link
          href="/"
          className="mt-8 rounded-md bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to Markets
        </Link>
      </div>
    </div>
  );
}
