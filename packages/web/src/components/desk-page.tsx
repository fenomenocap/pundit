import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Formal page frame in the Desk tokens, shared by the secondary pages. */
export function DeskPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-bg text-fg min-h-[calc(100dvh-2.75rem)]", className)}>{children}</div>;
}

export function DeskPageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="border-b border-border bg-surface px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="mt-1 font-display text-3xl uppercase tracking-wide leading-none text-fg">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-quiet">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </header>
  );
}

export function DeskSection({
  title,
  aside,
  children,
  id,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={cn("rounded-md border border-border bg-surface", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <h2 className="eyebrow text-quiet">{title}</h2>
        {aside ? <div className="text-2xs text-subtle tabular-nums">{aside}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function DeskStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 font-display text-3xl tabular-nums leading-none text-fg">{value}</div>
      {note ? <p className="mt-1.5 text-2xs leading-4 text-quiet">{note}</p> : null}
    </div>
  );
}
