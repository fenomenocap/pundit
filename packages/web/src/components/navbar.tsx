"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LeagueMark } from "@/desk/components/kit";
import { fmtMoney } from "@/desk/lib/format";
import { loadSlate } from "@/desk/lib/slate";
import { useDesk } from "@/desk/lib/store";
import { getDocsUrl } from "@/lib/site-links";
import { cn } from "@/lib/utils";

const PRIMARY = [
  { href: "/", label: "Desk" },
  { href: "/board", label: "Paper" },
  { href: "/draft", label: "Draft" },
  { href: "/vault", label: "Vaults" },
] as const;

const SECONDARY = [
  { href: "/fixtures", label: "Fixtures" },
  { href: "/model", label: "Model" },
  { href: "/evaluation/club-season", label: "Ledger" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const cash = useDesk((s) => s.cash);
  const hydrate = useDesk((s) => s.hydrateSlate);
  const lab = pathname !== "/" && PRIMARY.some((n) => n.href !== "/" && pathname.startsWith(n.href));

  useEffect(() => {
    let cancelled = false;
    void loadSlate().then((slate) => {
      if (cancelled) return;
      hydrate(slate.open, slate.settled, slate.source);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

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
          className="hidden xl:flex items-center gap-0.5 ml-3 shrink-0"
        >
          {PRIMARY.map((n) => {
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
          <span className="mx-2 h-4 w-px bg-border" aria-hidden />
          {SECONDARY.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "px-2.5 h-8 inline-flex items-center rounded-sm text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
                  active ? "text-fg" : "text-subtle hover:text-quiet",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <a
            href={getDocsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-subtle transition-colors duration-150 hover:text-fg",
              lab && "hidden sm:inline-flex",
            )}
          >
            How it works
          </a>
          <div className="hidden sm:flex items-center gap-2.5 text-2xs uppercase tracking-wider text-quiet">
            <LeagueMark className="size-6" />
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-accent live-dot" />
              LIVE
            </span>
            <span className="text-border-strong">/</span>
            <span>Club season</span>
          </div>
          {lab ? (
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="eyebrow">Paper</span>
              <span className="font-display text-lg leading-none text-fg">{fmtMoney(cash)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function MobileDock() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);
  return (
    <nav
      aria-label="Mobile"
      className="xl:hidden sticky bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      {moreOpen ? (
        <ul id="mobile-more-navigation" className="grid grid-cols-2 sm:grid-cols-4 border-b border-border">
          {SECONDARY.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={() => setMoreOpen(false)}
                aria-current={pathname.startsWith(n.href) ? "page" : undefined}
                className="flex h-12 items-center justify-center text-xs font-semibold uppercase tracking-wider text-fg"
              >
                {n.label}
              </Link>
            </li>
          ))}
          <li>
            <a
              href={getDocsUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center text-xs font-semibold uppercase tracking-wider text-fg"
            >
              How it works
            </a>
          </li>
        </ul>
      ) : null}
      <ul className="grid grid-cols-5">
        {PRIMARY.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={() => setMoreOpen(false)}
                aria-current={active ? "page" : undefined}
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
        <li>
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="mobile-more-navigation"
            onClick={() => setMoreOpen((open) => !open)}
            className={cn(
              "flex h-12 w-full items-center justify-center text-2xs font-semibold uppercase tracking-wider",
              moreOpen || SECONDARY.some((n) => pathname.startsWith(n.href)) ? "text-accent" : "text-quiet",
            )}
          >
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
