import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onRetry, className }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground",
        className
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        {onRetry && (
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
