import { Router, Request, Response, NextFunction } from "express";
import { COMPETITIONS, getEnabledCompetitions } from "../config/competitions";
import { getActiveFixtures } from "../services/active-fixtures";
import { getClubFormSnapshot } from "../services/club-form";
import { getCachedMatches, getCachedMatchesForCompetition } from "../services/football-data";

const router: Router = Router();

function serializeMatch(match: ReturnType<typeof getCachedMatches>["upcoming"][number]) {
  return {
    id: match.id,
    competitionId: match.competitionId,
    competition: match.competition,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    utcDate: match.utcDate,
    status: match.status,
    stage: match.stage,
    matchday: match.matchday,
    group: match.group,
    score: match.score,
  };
}

function resolveCompetitionId(req: Request): string | null {
  const raw = req.query.competition;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw.trim();
}

function matchesForRequest(req: Request): {
  upcoming: ReturnType<typeof serializeMatch>[];
  recent: ReturnType<typeof serializeMatch>[];
  standings: ReturnType<typeof getCachedMatches>["standings"];
  lastUpdated: string | null;
  error: string | null;
} {
  const cached = getCachedMatches();
  const competitionId = resolveCompetitionId(req);
  if (!competitionId) {
    return {
      upcoming: cached.upcoming.map(serializeMatch),
      recent: cached.recent.map(serializeMatch),
      standings: cached.standings,
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    };
  }

  const scoped = getCachedMatchesForCompetition(competitionId);
  return {
    upcoming: scoped.upcoming.map(serializeMatch),
    recent: scoped.recent.map(serializeMatch),
    standings: scoped.standings,
    lastUpdated: cached.lastUpdated?.toISOString() ?? null,
    error: scoped.error ?? cached.competitionErrors[competitionId] ?? cached.error,
  };
}

router.get("/competitions", (_req: Request, res: Response) => {
  res.json({
    competitions: COMPETITIONS.map((competition) => ({
      id: competition.id,
      name: competition.name,
      type: competition.type,
      enabled: competition.enabled,
      priority: competition.priority,
    })),
    enabled: getEnabledCompetitions().map((competition) => competition.id),
    lastUpdated: getCachedMatches().lastUpdated?.toISOString() ?? null,
  });
});

router.get("/active", (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getCachedMatches();
    res.json({
      fixtures: getActiveFixtures(),
      lastUpdated: cached.lastUpdated?.toISOString() ?? null,
      error: cached.error,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/upcoming", (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = matchesForRequest(req);
    res.json({
      matches: payload.upcoming,
      lastUpdated: payload.lastUpdated,
      error: payload.error,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/recent", (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = matchesForRequest(req);
    const competitionId = resolveCompetitionId(req) ?? "eng.1";
    res.json({
      matches: payload.recent,
      lastUpdated: payload.lastUpdated,
      error: payload.error,
      // ESPN-derived last-N form and league scorers from the same cached
      // scoreboard / season schedule this route already serves.
      clubForm: getClubFormSnapshot(competitionId),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/standings", (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = matchesForRequest(req);
    res.json({
      standings: payload.standings,
      lastUpdated: payload.lastUpdated,
      error: payload.error,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
