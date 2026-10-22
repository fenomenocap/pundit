import { FplBuilder } from "@/desk/components/fpl-builder";

export const metadata = { title: "FPL team builder" };

export default function DraftPage() {
  return (
    <div className="bg-bg text-fg min-h-[calc(100dvh-2.75rem)]">
      <FplBuilder />
    </div>
  );
}
