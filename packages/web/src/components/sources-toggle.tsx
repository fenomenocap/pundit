import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Collapsed by default. Data-source names, method names and caveats live here,
 * never inline in visible prose.
 */
export function SourcesToggle({
  children,
  className,
  label = "Sources",
  testId = "sources-toggle",
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  testId?: string;
}) {
  return (
    <details data-testid={testId} className={cn("group text-2xs leading-5 text-quiet", className)}>
      <summary className="cursor-pointer select-none list-none uppercase tracking-wider text-subtle hover:text-fg [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>›</span> {label}
      </summary>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </details>
  );
}
