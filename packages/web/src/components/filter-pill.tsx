import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface FilterPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function FilterPill({ label, active, onClick }: FilterPillProps) {
  return (
    <Button
      type="button"
      variant="pill"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-3 py-1 font-semibold uppercase tracking-wide",
        active &&
          "border-primary/40 bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
      )}
    >
      {label}
    </Button>
  );
}

export function filterPillClass(active: boolean): string {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
    active
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:text-foreground"
  );
}