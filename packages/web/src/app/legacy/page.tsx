import { Suspense } from "react";
import { HomeChat } from "@/components/home-chat";

export default function LegacyChatPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex h-[calc(100vh-2.75rem)] max-w-2xl flex-col items-center justify-center px-4 text-sm text-muted-foreground">
          Loading chat…
        </div>
      }
    >
      <HomeChat />
    </Suspense>
  );
}
