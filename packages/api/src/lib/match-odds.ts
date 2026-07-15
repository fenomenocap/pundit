import { normalizeTeamName } from "./team-names";

export interface MatchOdds {
  pHome: number;
  pDraw: number;
  pAway: number;
}

export interface StoredMatchOdds extends MatchOdds {
  home: string;
  away: string;
}

export function normalizedTeamPairKey(teamA: string, teamB: string): string {
  return [normalizeTeamName(teamA), normalizeTeamName(teamB)].sort().join("::");
}

export function normalizeThreeWay(
  pHome: number,
  pDraw: number,
  pAway: number
): MatchOdds | null {
  const values = [pHome, pDraw, pAway];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const total = pHome + pDraw + pAway;
  if (total <= 0) return null;
  return {
    pHome: pHome / total,
    pDraw: pDraw / total,
    pAway: pAway / total,
  };
}

export function orientMatchOdds(
  odds: StoredMatchOdds,
  home: string,
  away: string
): MatchOdds | null {
  const requestedHome = normalizeTeamName(home);
  const requestedAway = normalizeTeamName(away);
  const storedHome = normalizeTeamName(odds.home);
  const storedAway = normalizeTeamName(odds.away);

  if (requestedHome === storedHome && requestedAway === storedAway) {
    return { pHome: odds.pHome, pDraw: odds.pDraw, pAway: odds.pAway };
  }
  if (requestedHome === storedAway && requestedAway === storedHome) {
    return { pHome: odds.pAway, pDraw: odds.pDraw, pAway: odds.pHome };
  }
  return null;
}
