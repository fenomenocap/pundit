import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  lastUpdated?: string | null;
  loading?: boolean;
  badge?: ReactNode;
  className?: string;
  sticky?: boolean;
  rightSlot?: ReactNode;
  eyebrow?: string;
}

export function PageHeader({
  title,
  subtitle,
  lastUpdated,
  loading,
  badge,
  className,
  sticky = false,
  rightSlot,
  eyebrow,
}: PageHeaderProps) {
  const header = (
    <div
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        {badge}
        <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        {rightSlot}
        <span className="font-mono text-xs text-muted-foreground">
          {lastUpdated
            ? `Updated ${new Date(lastUpdated).toLocaleString()}`
            : loading
              ? "Loading…"
              : "Update time unavailable"}
        </span>
      </div>
    </div>
  );

  if (!sticky) return header;

  return (
    <div className="sticky top-11 z-30 -mx-4 border-b border-card-rim bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/65 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {header}
    </div>
  );
}