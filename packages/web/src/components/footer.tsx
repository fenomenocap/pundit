const ENGINE_ADDRESS = process.env.NEXT_PUBLIC_ENGINE_ADDRESS;

export function Footer() {
  return (
    <footer className="border-t border-border px-4 py-2.5">
      <div className="flex flex-col items-center justify-between gap-2 text-[10px] text-muted-foreground sm:flex-row">
        <span>Built on Base &middot; Testnet, not real money</span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/fenomenocap/football-prediction-market"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          {ENGINE_ADDRESS && (
            <a
              href={`https://sepolia.basescan.org/address/${ENGINE_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Contract
            </a>
          )}
          <span>Pundit v0.2</span>
        </div>
      </div>
    </footer>
  );
}
