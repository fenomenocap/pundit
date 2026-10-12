import { getEnabledCompetitions } from "../config/competitions";
import { FOOTBALL_REFRESH_NORMAL_MS } from "../config/freshness-policy";
import { getTeamNameAliases, normalizeTeamName, normalizeTeamText } from "../lib/team-names";
import { getCachedMatches, getCachedSeasonSchedule, premierLeagueSeasonWindow, SEASON_SCHEDULE_MAX_AGE_MS, type FootballMatch, type SeasonScheduleCache } from "./football-data";

type ResultCache = ReturnType<typeof getCachedMatches>;
export type StructuredResultAnswer = {
  answer: string;
  citations: { id: string; title: string; url: string; date: string }[];
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A narrow result lookup: no causal explanation, aggregate, or implied club. */
export function ownedLatestResult(
  question: string,
  cache: ResultCache = getCachedMatches(),
  now = Date.now(),
  season: SeasonScheduleCache = getCachedSeasonSchedule()
): StructuredResultAnswer | null {
  const age = cache.lastUpdated ? now - cache.lastUpdated.getTime() : Infinity;
  if (cache.error || !Number.isFinite(age) || age < 0 || age > FOOTBALL_REFRESH_NORMAL_MS + 60_000) return null;
  const folded = normalizeTeamText(question).replace(/^what['’]s\b/, "what is").replace(/['’]s\b/g, "").replace(/[?!.]+$/g, "").trim();
  const asksWhy = / and why(?: did they (?:win|lose|draw))?$/.test(folded) || /^why did /.test(folded);
  const q = folded.replace(/ and why(?: did they (?:win|lose|draw))?$/, "").replace(/^why did /, "did ");
  const competitions = getEnabledCompetitions();
  const seasonAge = season.lastUpdated ? now - season.lastUpdated.getTime() : Infinity;
  const seasonFresh = season.competitionId === "eng.1" && !season.error && !season.servingLastGood
    && season.seasonId === premierLeagueSeasonWindow(new Date(now)).seasonId
    && Number.isFinite(seasonAge) && seasonAge >= 0 && seasonAge < SEASON_SCHEDULE_MAX_AGE_MS;
  const matches = [...cache.recent, ...cache.upcoming, ...(seasonFresh ? season.fixtures : [])];
  const clubs = [...new Set(matches.flatMap((match) => [match.homeTeam, match.awayTeam]))];
  let requested: { club: string; competitionId: string | null } | null = null;
  for (const club of clubs) {
    const canonical = normalizeTeamName(club);
    const names = [club, ...getTeamNameAliases().filter(([, team]) => normalizeTeamName(team) === canonical).map(([alias]) => alias)];
    for (const name of names) {
      const escaped = escapeRegex(normalizeTeamText(name));
      for (const competition of [null, ...competitions]) {
        const label = competition?.id === "eng.1" ? "(?:premier league|epl)"
          : competition ? escapeRegex(normalizeTeamText(competition.name)) : "";
        const fact = `(?:latest|last|most recent) (?:completed )?${label ? `(?:${label} )?` : ""}(?:result|score|match result)`;
        const scope = label ? `(?: in (?:the )?${label})?` : "";
        const game = `(?:latest|last|most recent) (?:completed )?${label ? `(?:${label} )?` : ""}(?:game|match|fixture)`;
        const pattern = `^(?:what (?:is|was) (?:the )?${escaped} ${fact}|what (?:is|was) (?:the )?${fact} (?:of|for) ${escaped}|did ${escaped} (?:win|lose|draw) (?:their|the) ${game})${scope}(?: (?:today|now|currently))?$`;
        if (!new RegExp(pattern).test(q)) continue;
        if (competition && !new RegExp(`\\b${label}\\b`).test(q)) continue;
        if (requested && normalizeTeamName(requested.club) !== canonical) return null;
        requested = { club, competitionId: competition?.id ?? null };
      }
    }
  }
  if (!requested) return null;
  const scope = competitions.filter((competition) => !requested!.competitionId || competition.id === requested!.competitionId);
  // A failed competition refresh could hide a newer result. Last-good rows do
  // not establish "latest", even when another competition refreshed normally.
  if (scope.some((competition) => !cache.byCompetition[competition.id]
    || cache.competitionErrors[competition.id] || cache.byCompetition[competition.id]?.error)) return null;
  const belongsToClub = (match: FootballMatch) => [match.homeTeam, match.awayTeam].some((team) => normalizeTeamName(team) === normalizeTeamName(requested!.club));
  const finished = matches.filter((match) => scope.some((competition) => competition.id === match.competitionId)
    && belongsToClub(match) && match.status === "FINISHED");
  if (finished.some((match) => !/^\d{4}-\d{2}-\d{2}T/.test(match.utcDate)
    || !Number.isFinite(Date.parse(match.utcDate)) || Date.parse(match.utcDate) > now)) return null;
  const eligible = finished;
  eligible.sort((a, b) => Date.parse(b.utcDate) - Date.parse(a.utcDate));
  const latest = eligible[0];
  if (!latest || !Number.isSafeInteger(latest.id) || latest.id <= 0
    || !Number.isInteger(latest.score?.home) || !Number.isInteger(latest.score?.away)
    || latest.score!.home! < 0 || latest.score!.away! < 0) return null;
  if (eligible.some((match) => match.id !== latest.id && Date.parse(match.utcDate) === Date.parse(latest.utcDate))) return null;
  // Do not hide a newer malformed finished row or an inconsistent duplicate.
  if (eligible.some((match) => match.id === latest.id && (match.homeTeam !== latest.homeTeam
    || match.competitionId !== latest.competitionId || match.awayTeam !== latest.awayTeam || match.utcDate !== latest.utcDate
    || match.score?.home !== latest.score?.home || match.score?.away !== latest.score?.away))) return null;
  const competition = scope.find((item) => item.id === latest.competitionId)!;
  const date = latest.utcDate.slice(0, 10);
  const url = `https://www.espn.com/soccer/match/_/gameId/${latest.id}`;
  const home = latest.score!.home!;
  const away = latest.score!.away!;
  const outcome = home === away ? "a draw" : `${home > away ? latest.homeTeam : latest.awayTeam} won`;
  const qualifier = requested.competitionId
    ? `The latest completed ${competition.name} result I have for ${requested.club}`
    : `The latest completed result I have for ${requested.club} in my covered competitions`;
  const coverage = requested.competitionId ? "" : " I cover the Premier League and Champions League qualifiers here; another cup match may be more recent.";
  return {
    answer: `${qualifier} is **${latest.homeTeam} ${home}–${away} ${latest.awayTeam}** (${competition.name}, ${date}): ${outcome}. [ESPN match record, ${date}](${url}).${coverage}${asksWhy ? " The score establishes the outcome; I would need a verified match report to explain why it happened." : ""}`,
    citations: [{ id: "S1", title: `${latest.homeTeam} ${home}–${away} ${latest.awayTeam} — ESPN`, url, date }],
  };
}
