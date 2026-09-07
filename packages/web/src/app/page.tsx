import { Suspense } from "react";
import { Desk } from "@/desk/components/desk";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100dvh-2.75rem)] items-center justify-center bg-bg text-sm text-quiet">
          Loading desk…
        </div>
      }
    >
      <div className="bg-bg text-fg min-h-[calc(100dvh-2.75rem)]">
        <Desk />
      </div>
    </Suspense>
  );
}
