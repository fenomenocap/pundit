import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "../middleware";
import {
  getTeamNameAliases,
  normalizeTeamName,
  normalizeTeamText,
} from "../lib/team-names";
import { getCachedModelData, ModelFixture } from "./model-data";

export interface Grounding {
  date: string;
  stage: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export type TeamContext = [string, string];

const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 600;

const SYSTEM_PROMPT = `You are a World Cup match-analysis assistant. You are given precomputed
probabilities from a Dixon-Coles Poisson model (calibrated on live Elo ratings) for
a specific matchup. Treat these numbers as ground truth for the statistical
analysis. Do not invent or contradict them. All World Cup 2026 matches are at
neutral venues (no home-field advantage) -- "home"/"away" labels below are
positional only, not venue-based.
The data may also include stake_p_home/stake_p_draw/stake_p_away -- no-vig implied
probabilities from Stake's live 1X2 odds for this match. When present, compare the
model's win probability against them and note the edge (model minus market,
positive means the model favours that outcome more than the market does). When
absent (null), say plainly that no market price is available for this match rather
than guessing one.
You have a web_search tool -- use it when current injury, squad, or form news
would materially change the read on this matchup. Do not fabricate injury/squad
news or any fact not backed by the provided data or a search result -- if search
turns up nothing useful, say so plainly rather than guessing.
Respond in 2-4 short paragraphs, plain language, no markdown tables. State the
headline win/draw/win and O/U 2.5 numbers naturally, mention 1-2 most likely
scorelines, and give a one-line read on what would need to be true for the
underdog.`;

export function resolveTeams(question: string, fixtures: ModelFixture[]): [string, string] {
  const normalizedQuestion = normalizeTeamText(question);
  const teamPositions = new Map<string, number>();
  const teams = new Set<string>();

  for (const fixture of fixtures) {
    teams.add(fixture.home);
    teams.add(fixture.away);
  }

  const searchTerms = new Map<string, string>();
  for (const team of teams) {
    const canonical = normalizeTeamName(team);
    searchTerms.set(normalizeTeamText(team), team);
    searchTerms.set(canonical, team);

    for (const [alias, aliasCanonical] of getTeamNameAliases()) {
      if (normalizeTeamName(aliasCanonical) === canonical) {
        searchTerms.set(normalizeTeamText(alias), team);
      }
    }
  }

  const termsByLength = [...searchTerms.entries()].sort(
    ([termA], [termB]) => termB.length - termA.length
  );

  for (const [term, team] of termsByLength) {
    const position = normalizedQuestion.indexOf(term);
    if (position === -1) continue;
    const previous = teamPositions.get(team);
    if (previous === undefined || position < previous) teamPositions.set(team, position);
  }

  const orderedTeams = [...teamPositions.entries()]
    .sort(([, positionA], [, positionB]) => positionA - positionB)
    .map(([team]) => team);

  if (orderedTeams.length > 2) {
    throw new AppError(
      400,
      "Please name exactly one matchup with two teams, e.g. 'France vs Morocco'."
    );
  }

  if (orderedTeams.length < 2) {
    throw new AppError(
      400,
      "Could not identify two teams in your question. Try naming both teams, e.g. 'France vs Morocco'."
    );
  }

  return [orderedTeams[0], orderedTeams[1]];
}

export function findFixture(teamA: string, teamB: string, fixtures: ModelFixture[]): ModelFixture | undefined {
  const pair = new Set([teamA, teamB]);
  return fixtures.find((fixture) => new Set([fixture.home, fixture.away]).size === pair.size
    && fixture.home !== fixture.away
    && pair.has(fixture.home)
    && pair.has(fixture.away));
}

function buildGrounding(fixture: ModelFixture): Grounding {
  return {
    date: fixture.date,
    stage: fixture.stage,
    home: fixture.home,
    away: fixture.away,
    pHome: fixture.pHome,
    pDraw: fixture.pDraw,
    pAway: fixture.pAway,
    stakePHome: fixture.stakePHome,
    stakePDraw: fixture.stakePDraw,
    stakePAway: fixture.stakePAway,
  };
}

export async function answerQuestion(
  question: string,
  history: ConversationTurn[] = [],
  teamContext?: TeamContext
): Promise<{ answer: string; grounding: Grounding }> {
  const { fixtures } = getCachedModelData();
  let teams: TeamContext;
  try {
    teams = resolveTeams(question, fixtures);
  } catch (err) {
    const isMissingTeams = err instanceof AppError
      && err.statusCode === 400
      && err.message.startsWith("Could not identify two teams");
    if (!isMissingTeams || history.length === 0 || !teamContext) throw err;
    teams = teamContext;
  }

  const [teamA, teamB] = teams;
  const fixture = findFixture(teamA, teamB, fixtures);

  if (!fixture) {
    throw new AppError(
      404,
      `No fixture or model data available yet for ${teamA} vs ${teamB} (e.g. an undetermined knockout matchup). Try again closer to kickoff.`
    );
  }

  const grounding = buildGrounding(fixture);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AppError(502, "ANTHROPIC_API_KEY is not configured.");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages: [
        ...history,
        {
          role: "user",
          content: `Model data: ${JSON.stringify(grounding)}\nUser question: ${question}`,
        },
      ],
    });
    const answer = response.content.reduce(
      (text, block) => block.type === "text" ? text + block.text : text,
      ""
    );
    return { answer, grounding };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(502, `Analysis generation failed: ${message}`);
  }
}
