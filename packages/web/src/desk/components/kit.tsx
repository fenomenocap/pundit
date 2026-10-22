import { cn } from "@/lib/utils";
import type { TeamId } from "@/desk/lib/data/teams";
import { TEAMS, teamIdFromName } from "@/desk/lib/data/teams";
import { getTeamColor, getTeamMonogram } from "@/lib/team-logos";

const PX = { sm: 16, md: 20, lg: 32 } as const;
const BOX = { sm: "size-4", md: "size-5", lg: "size-8" } as const;

export function KitPip({
  team,
  size = "md",
  className,
}: {
  team: TeamId;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = PX[size];
  return (
    <img
      src={`/crests/${team}.png`}
      alt=""
      title={TEAMS[team].name}
      width={px}
      height={px}
      decoding="async"
      draggable={false}
      className={cn("shrink-0 object-contain", BOX[size], className)}
    />
  );
}

/**
 * Crest for a club named by any source (ESPN, FPL, the ledger). Premier League
 * clubs use the same crest asset as the desk; any other club falls back to a
 * neutral three-letter monogram.
 */
export function ClubCrest({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const id = teamIdFromName(name);
  if (id) return <KitPip team={id} size={size} className={className} />;
  const monogram = getTeamMonogram(name);
  return (
    <span
      data-testid="club-monogram"
      className={cn("flex shrink-0 items-center justify-center rounded-xs text-[8px] font-bold text-white", BOX[size], className)}
      style={{ backgroundColor: getTeamColor(name) }}
      title={name}
      aria-hidden
    >
      {monogram ?? "·"}
    </span>
  );
}

export function TeamMark({
  team,
  withName = true,
  size = "md",
}: {
  team: TeamId;
  withName?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <KitPip team={team} size={size} />
      {withName ? (
        <span className="truncate font-medium tracking-tight">{TEAMS[team].name}</span>
      ) : null}
    </span>
  );
}

export function LeagueMark({ className }: { className?: string }) {
  return (
    <img
      src="/crests/PL.svg"
      alt="Premier League"
      width={66}
      height={28}
      draggable={false}
      className={cn("h-7 w-[66px] object-contain shrink-0", className)}
    />
  );
}
