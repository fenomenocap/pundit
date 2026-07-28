import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  lastUpdated?: string | null;
  loading?: boolean;
  badge?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  lastUpdated,
  loading,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div>
        {badge}
        <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <span className="font-mono text-xs text-muted-foreground">
        {lastUpdated
          ? `Updated ${new Date(lastUpdated).toLocaleString()}`
          : loading
            ? "Loading…"
            : "Update time unavailable"}
      </span>
    </div>
  );
}
