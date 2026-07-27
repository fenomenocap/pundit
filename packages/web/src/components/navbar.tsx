"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Chat" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/model", label: "Model" },
  { href: "/evaluation/wc-2026", label: "WC Backtest" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[hsl(228,50%,4%)]">
      <div className="flex h-11 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-heading text-base font-bold tracking-tight text-cyan-400">
              P
            </span>
            <span className="hidden font-heading text-sm font-semibold text-white sm:inline">
              Pundit
            </span>
          </Link>

          <nav className="flex items-center">
            {navLinks.map((link) => {
              const isActive =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
                    isActive
                      ? "text-white"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
