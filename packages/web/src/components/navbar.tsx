"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LeagueMark } from "@/desk/components/kit";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Desk" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/model", label: "Model" },
  { href: "/evaluation/club-season", label: "Ledger" },
] as const;

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <span className="flex size-7 items-center justify-center rounded-xs bg-accent font-display text-lg font-semibold text-accent-fg leading-none">
            P
          </span>
          <h1 className="font-display text-2xl uppercase tracking-wide text-fg leading-none">
            Pundit
          </h1>
        </Link>

        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-0.5 ml-3"
        >
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "px-3 h-8 inline-flex items-center rounded-sm text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
                  active ? "bg-panel text-fg" : "text-quiet hover:text-fg",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden sm:flex items-center gap-2.5 text-2xs uppercase tracking-wider text-quiet">
          <LeagueMark className="size-6" />
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-accent live-dot" />
            LIVE
          </span>
          <span className="text-border-strong">/</span>
          <span>ClubElo</span>
        </div>
      </div>
    </header>
  );
}

export function MobileDock() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Mobile"
      className="md:hidden sticky bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-4">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                className={cn(
                  "flex h-12 items-center justify-center text-2xs font-semibold uppercase tracking-wider",
                  active ? "text-accent" : "text-quiet",
                )}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
