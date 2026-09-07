import { BoardView } from "@/desk/components/board-view";

export const metadata = { title: "Paper board" };

export default function BoardPage() {
  return (
    <div className="bg-bg text-fg min-h-[calc(100dvh-2.75rem)]">
      <BoardView />
    </div>
  );
}
