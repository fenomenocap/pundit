"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-heading text-sm font-bold text-white">
            SP
          </div>
          <span className="font-heading text-lg font-bold tracking-tight text-white">
            Sports Predict
          </span>
        </Link>

        {/* Nav Links */}
        <nav className="hidden items-center gap-1 sm:flex">
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
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Connect Button */}
        <ConnectButton
          chainStatus="icon"
          showBalance={true}
          accountStatus={{
            smallScreen: "avatar",
            largeScreen: "full",
          }}
        />
      </div>
    </header>
  );
}
