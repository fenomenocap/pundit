"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Chat" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/model", label: "Predictions" },
  { href: "/evaluation/wc-2026", label: "2026 FIFA World Cup" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[hsl(228,50%,4%)]">
      <div className="flex h-11 items-center justify-between px-4">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="font-heading text-base font-bold tracking-tight text-primary">
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
                    "shrink-0 px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
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
