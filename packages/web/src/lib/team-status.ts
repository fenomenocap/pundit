import type { MatchResponse, StandingResponse } from "./api";

// Our seeded market team names (packages/contracts/scripts/seed-wc.ts) don't
// always match ESPN's naming exactly — reconcile the known differences here
// rather than relying on exact string equality.
const TEAM_ALIASES: Record<string, string> = {
  "bosnia and herzegovina": "bosnia-herzegovina",
  "the democratic republic of congo": "congo dr",
  usa: "united states",
};

export function normalizeTeamName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // strip diacritics (Curaçao -> Curacao, Türkiye -> Turkiye)
    .toLowerCase()
    .trim();
  return TEAM_ALIASES[base] ?? base;
}

// A team is out of the tournament if it didn't advance from the group stage,
// or if it lost a completed knockout-stage match. Used to keep "will TEAM win
// it all" outright markets limited to teams that can still mathematically win.
export function computeEliminatedTeams(
  standings: StandingResponse[],
  matches: MatchResponse[]
): Set<string> {
  const eliminated = new Set<string>();

  for (const s of standings) {
    if (!s.advanced) eliminated.add(normalizeTeamName(s.team));
  }

  for (const m of matches) {
    if (m.status !== "FINISHED" || m.stage === "group-stage") continue;
    const home = m.score?.home;
    const away = m.score?.away;
    if (home === null || home === undefined || away === null || away === undefined) continue;
    if (home < away) eliminated.add(normalizeTeamName(m.homeTeam));
    else if (away < home) eliminated.add(normalizeTeamName(m.awayTeam));
  }

  return eliminated;
}

export function isTeamEliminated(team: string, eliminated: Set<string>): boolean {
  return eliminated.has(normalizeTeamName(team));
}
