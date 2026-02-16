"use client";

import dynamic from "next/dynamic";

const Providers = dynamic(
  () => import("./providers").then((m) => ({ default: m.Providers })),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-[hsl(220,20%,4%)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
      </div>
    ),
  }
);

export function DynamicProviders({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
