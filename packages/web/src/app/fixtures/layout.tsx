import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fixtures",
};

export default function FixturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
