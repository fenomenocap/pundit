import type { ForecastFixture } from "@/desk/lib/data/fixtures";
import { modelProbFor } from "@/desk/lib/data/fixtures";
import { formatDeskMarketLine } from "@/desk/lib/market-quote";

export function MarketQuoteLine({
  fixture,
  className,
}: {
  fixture: ForecastFixture;
  className?: string;
}) {
  if (!fixture.marketQuote) return null;
  const line = formatDeskMarketLine(
    fixture.marketQuote,
    fixture.modelPick,
    modelProbFor(fixture, fixture.modelPick),
  );
  if (!line) return null;
  return (
    <span className={className} data-testid="desk-market-quote">
      {line}
    </span>
  );
}
