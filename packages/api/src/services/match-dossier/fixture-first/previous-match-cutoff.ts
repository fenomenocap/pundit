import type { FootballMatch } from "../../football-data";

function parseKickoffUtc(match: FootballMatch): number | null {
  const t = Date.parse(match.utcDate);
  return Number.isFinite(t) ? t : null;
}

/** Latest completed kickoff for `club` strictly before `beforeKickoffUtc`. */
export function previousMatchKickoffUtc(
  club: string,
  beforeKickoffUtc: string,
  schedule: readonly FootballMatch[],
): string | null {
  const beforeMs = Date.parse(beforeKickoffUtc);
  if (!Number.isFinite(beforeMs)) return null;
  let best: { utc: string; ms: number } | null = null;
  for (const row of schedule) {
    if (row.status !== "FINISHED" && row.status !== "POSTPONED") continue;
    const kick = parseKickoffUtc(row);
    if (kick == null || kick >= beforeMs) continue;
    const involved = row.homeTeam === club || row.awayTeam === club;
    if (!involved) continue;
    if (!best || kick > best.ms) best = { utc: row.utcDate, ms: kick };
  }
  return best?.utc ?? null;
}

/** Source timestamp must be strictly after the player's club previous match and before kickoff. */
export function passesFixtureFirstFreshness(params: {
  sourceTimestampIso: string | null;
  kickoffUtc: string;
  clubPreviousKickoffUtc: string | null;
}): boolean {
  const { sourceTimestampIso, kickoffUtc, clubPreviousKickoffUtc } = params;
  if (!sourceTimestampIso) return false;
  const sourceMs = Date.parse(sourceTimestampIso);
  const kickoffMs = Date.parse(kickoffUtc);
  if (!Number.isFinite(sourceMs) || !Number.isFinite(kickoffMs)) return false;
  if (sourceMs >= kickoffMs) return false;
  if (!clubPreviousKickoffUtc) return true;
  const prevMs = Date.parse(clubPreviousKickoffUtc);
  if (Number.isFinite(prevMs) && sourceMs <= prevMs) return false;
  return true;
}
