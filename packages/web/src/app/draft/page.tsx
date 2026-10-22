import { FplBuilder } from "@/desk/components/fpl-builder";
import { DeskPage, DeskPageHeader, DeskSection } from "@/components/desk-page";
import { FPL_BUILDER_ENABLED } from "@/lib/features";

export const metadata = { title: "FPL team builder" };

export default function DraftPage() {
  if (!FPL_BUILDER_ENABLED) {
    return (
      <DeskPage>
        <DeskPageHeader eyebrow="Fantasy Premier League" title="FPL team builder" subtitle="Coming soon." />
        <DeskSection title="Not available yet">
          <p data-testid="fpl-builder-off" className="text-sm text-quiet">
            The team builder is not switched on yet. No player data is shown here.
          </p>
        </DeskSection>
      </DeskPage>
    );
  }
  return (
    <div className="bg-bg text-fg min-h-[calc(100dvh-2.75rem)]">
      <FplBuilder />
    </div>
  );
}
