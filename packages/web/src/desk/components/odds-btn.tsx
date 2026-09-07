import type { MarketKey } from "@/desk/lib/data/fixtures";
import { fmtEdge, fmtOdds } from "@/desk/lib/format";
import { cn } from "@/lib/utils";

export function OddsBtn({
  label,
  price,
  edge,
  active,
  dim,
  onClick,
}: {
  label: string;
  price: number;
  edge?: number;
  active?: boolean;
  dim?: boolean;
  onClick?: () => void;
  market?: MarketKey;
}) {
  const hot = (edge ?? 0) > 0.02;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 flex-col items-center justify-center rounded-sm border px-2 py-1.5 transition-colors duration-150",
        active
          ? "border-accent bg-accent/15 text-fg"
          : "border-border bg-elevated hover:border-border-strong hover:bg-panel",
        dim && !active && "opacity-50",
      )}
    >
      <span className="text-[10px] uppercase tracking-wider text-quiet">{label}</span>
      <span className="font-mono text-sm tabular-nums leading-tight">{fmtOdds(price)}</span>
      {edge !== undefined ? (
        <span
          className={cn(
            "font-mono text-[10px] tabular-nums",
            hot ? "text-up" : edge < -0.02 ? "text-quiet" : "text-subtle",
          )}
        >
          {fmtEdge(edge)}
        </span>
      ) : null}
    </button>
  );
}
