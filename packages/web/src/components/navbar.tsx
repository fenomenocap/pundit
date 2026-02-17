"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/arena", label: "Arena" },
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

        <ConnectButton.Custom>
          {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
            const connected = mounted && account && chain;
            return (
              <div
                {...(!mounted && {
                  "aria-hidden": true,
                  style: { opacity: 0, pointerEvents: "none", userSelect: "none" },
                })}
              >
                {!connected ? (
                  <button
                    onClick={openConnectModal}
                    className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-black transition-colors hover:bg-cyan-400"
                  >
                    Connect
                  </button>
                ) : chain?.unsupported ? (
                  <button
                    onClick={openChainModal}
                    className="rounded-md bg-red-500/20 px-3 py-1.5 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/30"
                  >
                    Wrong Network
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={openChainModal}
                      className="flex items-center rounded-md bg-secondary px-2 py-1.5 text-[11px] transition-colors hover:bg-secondary/80"
                    >
                      {chain?.hasIcon && chain.iconUrl && (
                        <img src={chain.iconUrl} alt="" className="mr-1 h-3.5 w-3.5 rounded-full" />
                      )}
                    </button>
                    <button
                      onClick={openAccountModal}
                      className="rounded-md bg-secondary px-2.5 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-secondary/80"
                    >
                      {account.displayName}
                    </button>
                  </div>
                )}
              </div>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </header>
  );
}
