import { VaultView } from "@/desk/components/vault-view";

export const metadata = { title: "Vaults" };

export default function VaultPage() {
  return (
    <div className="bg-bg text-fg min-h-[calc(100dvh-2.75rem)]">
      <VaultView />
    </div>
  );
}
