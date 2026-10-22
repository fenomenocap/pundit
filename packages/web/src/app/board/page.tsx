import { BetSlipView } from "@/desk/components/bet-slip-view";

export const metadata = { title: "Bet slip" };

export default function BoardPage() {
  return (
    <div className="bg-bg text-fg min-h-[calc(100dvh-2.75rem)]">
      <BetSlipView />
    </div>
  );
}
