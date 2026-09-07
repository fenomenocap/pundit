import { DraftView } from "@/desk/components/draft-view";

export const metadata = { title: "Draftroom" };

export default function DraftPage() {
  return (
    <div className="bg-bg text-fg min-h-[calc(100dvh-2.75rem)]">
      <DraftView />
    </div>
  );
}
