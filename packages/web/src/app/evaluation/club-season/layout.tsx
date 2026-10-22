import type { Metadata } from "next";

export const metadata: Metadata = { title: "Track record" };

export default function TrackRecordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
