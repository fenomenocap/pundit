"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Chat", mobileLabel: "Chat" },
  { href: "/fixtures", label: "Fixtures", mobileLabel: "Fixtures" },
  { href: "/model", label: "Predictions", mobileLabel: "Model" },
  { href: "/evaluation/wc-2026", label: "2026 FIFA World Cup", mobileLabel: "WC26" },
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
              className="flex h-6 w-6 items-center justify-center rounded border border-primary/30 bg-primary/10 font-display text-base text-primary"
            >
              P
            </span>
            <span className="font-heading text-sm font-semibold text-white">
              Pundit
            </span>
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