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
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="flex h-11 items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-6 sm:gap-10">
          <Link
            href="/"
            className="shrink-0 font-heading text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
          >
            Pundit
          </Link>

          <nav
            aria-label="Main navigation"
            className="flex min-w-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-4 [&::-webkit-scrollbar]:hidden"
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
                    "shrink-0 px-2 py-1.5 text-sm transition-colors sm:px-0",
                    isActive
                      ? "text-foreground"
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
