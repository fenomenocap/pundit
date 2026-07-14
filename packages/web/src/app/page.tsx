import Link from "next/link";

// Placeholder homepage after the chat-first pivot (trading/onchain markets
// removed — see archive/onchain-trading-v1 tag for the prior version). The
// real chat interface (calling worldcup-model's /api/ask) is separate,
// follow-on work — this just keeps "/" from being broken in the meantime.
export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
      <h1 className="font-heading text-3xl font-bold text-white sm:text-4xl">
        Pundit
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Elo/Poisson-modelled World Cup win probabilities and live fixture odds.
        The conversational match-analysis agent lands here next.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <Link
          href="/fixtures"
          className="rounded-md bg-cyan-500 px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-cyan-400"
        >
          View Fixtures
        </Link>
        <Link
          href="/model"
          className="rounded-md bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Model Reference
        </Link>
      </div>
    </div>
  );
}
