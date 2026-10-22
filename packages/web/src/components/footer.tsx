"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Disclaimer } from "@/components/disclaimer";
import { getDocsUrl, getGithubUrl } from "@/lib/site-links";

export function Footer() {
  const pathname = usePathname();
  const docsUrl = getDocsUrl();
  // Chat is a full-viewport composition — keep the footer off that surface.
  if (pathname === "/" || pathname === "/board" || pathname === "/draft" || pathname === "/vault") return null;

  return (
    <footer className="border-t border-border bg-surface px-4 py-2.5">
      <div className="flex flex-col items-center justify-between gap-2 text-xs text-quiet sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="font-display text-base uppercase tracking-wide text-fg">Pundit</span>
          <span className="hidden h-3 w-px bg-border sm:inline-block" aria-hidden="true" />
          <Disclaimer />
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-subtle sm:inline">
            Resources
          </span>
          {docsUrl && (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-fg"
            >
              How it works
            </a>
          )}
          <Link
            href="/evaluation/club-season"
            className="transition-colors hover:text-fg"
          >
            Track record
          </Link>
          <Link
            href="/evaluation/wc-2026"
            className="transition-colors hover:text-fg"
          >
            World Cup backtest
          </Link>
          <a
            href={getGithubUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-fg"
          >
            GitHub
          </a>
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-subtle sm:inline">
            v0.3
          </span>
        </div>
      </div>
    </footer>
  );
}