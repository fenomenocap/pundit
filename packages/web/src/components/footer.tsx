"use client";

import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();
  // Chat is a full-viewport composition — keep the footer off that surface.
  if (pathname === "/") return null;

  return (
    <footer className="border-t border-border px-4 py-2.5">
      <div className="flex flex-col items-center justify-between gap-2 text-[10px] text-muted-foreground sm:flex-row">
        <span>Reference only &middot; not tradeable</span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/fenomenocap/pundit"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <span>Pundit v0.3</span>
        </div>
      </div>
    </footer>
  );
}
