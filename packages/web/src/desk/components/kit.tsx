import { cn } from "@/lib/utils";
import type { TeamId } from "@/desk/lib/data/teams";
import { TEAMS } from "@/desk/lib/data/teams";

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
        <span className="truncate font-medium tracking-tight">{TEAMS[team].short}</span>
      ) : null}
    </span>
  );
}

export function LeagueMark({ className }: { className?: string }) {
  return (
    <img
      src="/crests/PL.svg"
      alt="Premier League"
      width={28}
      height={28}
      draggable={false}
      className={cn("size-7 object-cover object-[0_center] shrink-0", className)}
    />
  );
}
