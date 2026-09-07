"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Desk", mobileLabel: "Desk" },
  { href: "/fixtures", label: "Fixtures", mobileLabel: "Fixtures" },
  { href: "/model", label: "Model", mobileLabel: "Model" },
  { href: "/evaluation/club-season", label: "Ledger", mobileLabel: "Ledger" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-11 items-center justify-between px-4">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-sm bg-accent font-display text-lg font-semibold text-accent-fg leading-none"
            >
              P
            </span>
            <h1 className="font-display text-xl uppercase tracking-wide text-fg leading-none">
              Pundit
            </h1>
          </Link>

          <nav
            aria-label="Main navigation"
            className="flex min-w-0 items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {navLinks.map((link) => {
              const isActive =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors sm:px-3",
                    isActive
                      ? "bg-secondary/60 text-white"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="sm:hidden">{link.mobileLabel}</span>
                  <span className="hidden sm:inline">{link.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}