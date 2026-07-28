import { cn } from "@/lib/utils";

export function filterPillClass(active: boolean): string {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
    active
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:text-foreground"
  );
}

interface FilterPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function FilterPill({ label, active, onClick }: FilterPillProps) {
  return (
    <button type="button" onClick={onClick} className={filterPillClass(active)}>
      {label}
    </button>
  );
}
