import Anthropic from "@anthropic-ai/sdk";
import { MODEL_EDGE_CLAIMS_ALLOWED } from "../config/backtest-gate";
import type { AskGrounding } from "./ask";
import { getFixtures } from "./data-layer/getFixtures";
import { getMarketOdds } from "./data-layer/getMarketOdds";
import { getForm } from "./data-layer/getForm";
import { getStandings } from "./data-layer/getStandings";
import { getTeamNews } from "./data-layer/getTeamNews";
import { getManagers } from "./data-layer/getManagers";
import { getPlayer } from "./data-layer/getPlayer";
import { getModelForecast, getModelForecastByKey } from "./data-layer/getModelForecast";
import {
  findModelFixtureByPublicRef,
  getModelFixtureKey,
  type ModelFixtureLookupHint,
} from "./model-data";
import { resolveInference } from "./inference-config";
import type { FederatedGrounding } from "./federated-evidence";

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_fixtures",
    description: "Upcoming and recent fixtures from ESPN (optional competitionId filter).",
    input_schema: {
      type: "object",
      properties: { competitionId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_model_forecast",
    description: "Pundit Fundamental 1X2, totals, BTTS and scorelines for a priced fixture.",
    input_schema: {
      type: "object",
      properties: { fixtureId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_market_odds",
    description: "External no-vig 1X2 sources and volume-weighted market consensus for a fixture.",
    input_schema: {
      type: "object",
      properties: { fixtureId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_form",
    description: "Recent league form for clubs in a competition.",
    input_schema: {
      type: "object",
      properties: { competitionId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_standings",
    description: "Current competition table rows from ESPN.",
    input_schema: {
      type: "object",
      properties: { competitionId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_team_news",
    description: "Federated web search for dated team news. Pass a focused question string.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    name: "get_managers",
    description: "Current manager lookup for a club via federated search.",
    input_schema: {
      type: "object",
      properties: { club: { type: "string" } },
      required: ["club"],
    },
  },
  {
    name: "get_player",
    description: "Player availability / injury news via federated search.",
    input_schema: {
      type: "object",
      properties: { player: { type: "string" }, club: { type: "string" } },
      required: ["player"],
    },
  },
];

export const CHAT_AGENT_SYSTEM = `You are The Gaffer's Analyst on Pundit — sharp, opinionated, dry banter allowed.
Make one clear call per answer: Back / Lean / Avoid / No bet. Confidence follows the numbers.
Every probability and fair price must come from tool output or the seeded Fundamental block — never guess.
Label Pundit Fundamental numbers separately from external market consensus; never blend them into one "model" figure.
Every injury, manager, or news claim needs a markdown link [title](url) copied from search tool output.
If a search tool returns no rows, say you could not verify that fact — do not invent squad or injury news.
When Fundamental disagrees with market consensus, say so plainly using the supplied gaps — never call it "edge" or "value"${MODEL_EDGE_CLAIMS_ALLOWED ? "" : " until the backtest gate passes"}.
Never say lock, guaranteed, or can't lose. On explicit betting calls only, mention small stakes and 18+ / gamble responsibly.
Refuse anything aimed at problem gambling. Vary phrasing; avoid repeating the same section headers every turn.`;

function agentReasoning(): { thinking?: { type: "enabled"; budget_tokens: number } } {
  if (process.env.PUNDIT_REASONING?.trim().toLowerCase() === "off") return {};
  if (resolveInference().provider === "openrouter") {
    return { thinking: { type: "enabled", budget_tokens: 2048 } };
  }
  return {};
}

function defaultCompetitionId(grounding: AskGrounding): string | undefined {
  if (grounding?.kind === "match") return grounding.competitionId;
  if (grounding?.kind === "competition") return grounding.competitionId;
  if (grounding?.kind === "season") return grounding.competitionId;
  return "eng.1";
}

function defaultFixtureId(grounding: AskGrounding): string | undefined {
  return grounding?.kind === "match" ? grounding.fixtureId : undefined;
}

function fixtureLookupHint(grounding: AskGrounding): ModelFixtureLookupHint | undefined {
  if (grounding?.kind !== "match") return undefined;
  return {
    competitionId: grounding.competitionId,
    date: grounding.date,
    home: grounding.home,
    away: grounding.away,
  };
}

function resolveCachedFixture(
  fixtureId: string | undefined,
  grounding: AskGrounding,
) {
  const hint = fixtureLookupHint(grounding);
  if (fixtureId) return findModelFixtureByPublicRef(fixtureId, hint);
  if (hint?.home && hint?.away) return findModelFixtureByPublicRef("", hint);
  return undefined;
}

function matchSeedBlock(grounding: Extract<AskGrounding, { kind: "match" }>): string {
  const fixture = resolveCachedFixture(grounding.fixtureId, grounding);
  const modelKey = fixture ? getModelFixtureKey(fixture) : null;
  const fundamental = {
    pHome: grounding.pHome,
    pDraw: grounding.pDraw,
    pAway: grounding.pAway,
    pOver2_5: grounding.pOver2_5,
    pUnder2_5: grounding.pUnder2_5,
    pBttsYes: grounding.pBttsYes,
    pBttsNo: grounding.pBttsNo,
    topScores: grounding.topScores?.slice(0, 5) ?? [],
  };
  return [
    "Seeded data (use for Fundamental quotes; pass fixtureId below to tools when needed):",
    JSON.stringify({
      fixtureRefs: {
        espn: grounding.fixtureId,
        modelKey,
      },
      fundamental,
      externalMarketConsensus: grounding.externalMarketConsensus ?? null,
    }),
  ].join("\n");
}

function federatedGrounding(grounding: AskGrounding): FederatedGrounding {
  if (grounding?.kind === "match") {
    return {
      kind: "match",
      home: grounding.home,
      away: grounding.away,
      freshness: grounding.freshness,
    };
  }
  return null;
}

async function runAgentTool(
  name: string,
  input: Record<string, unknown>,
  grounding: AskGrounding,
  signal?: AbortSignal,
): Promise<unknown> {
  const fixtureId = typeof input.fixtureId === "string" && input.fixtureId.trim()
    ? input.fixtureId.trim()
    : defaultFixtureId(grounding);
  const competitionId = typeof input.competitionId === "string" && input.competitionId.trim()
    ? input.competitionId.trim()
    : defaultCompetitionId(grounding);
  const hint = fixtureLookupHint(grounding);
  const cached = resolveCachedFixture(fixtureId, grounding);
  const modelRow = cached
    ? getModelForecast({ fixture: cached })
    : fixtureId
      ? getModelForecastByKey(fixtureId, hint)
      : null;
  const fed = federatedGrounding(grounding);

  switch (name) {
    case "get_fixtures":
      return getFixtures({ competitionId: typeof input.competitionId === "string" ? input.competitionId : competitionId }).data;
    case "get_model_forecast":
      return modelRow?.data ?? (fixtureId ? { error: "model_fixture_not_found", fixtureId } : { error: "fixture_id_required" });
    case "get_market_odds":
      if (!cached) return { error: "model_fixture_not_found", fixtureId };
      return getMarketOdds(cached).data;
    case "get_form":
      return getForm({ competitionId: competitionId ?? "eng.1" }).data;
    case "get_standings":
      return getStandings({ competitionId: competitionId ?? "eng.1" }).data;
    case "get_team_news":
      return (await getTeamNews({
        question: String(input.question ?? ""),
        grounding: fed,
      }, signal)).data;
    case "get_managers":
      return (await getManagers({
        club: String(input.club ?? (grounding?.kind === "match" ? grounding.home : "")),
        grounding: fed,
      }, signal)).data;
    case "get_player":
      return (await getPlayer({
        player: String(input.player ?? ""),
        club: typeof input.club === "string" ? input.club : undefined,
        grounding: fed,
      }, signal)).data;
    default:
      return { error: "unknown_tool" };
  }
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function groundingContextLine(grounding: AskGrounding): string {
  if (grounding?.kind === "match") {
    return `Fixture: ${grounding.home} vs ${grounding.away} (${grounding.competition}, fixtureId=${grounding.fixtureId}).`;
  }
  if (grounding?.kind === "competition") {
    return `Competition table: ${grounding.competition} (${grounding.competitionId}).`;
  }
  if (grounding?.kind === "season") {
    return `Season outlook: ${grounding.competition} (${grounding.competitionId}).`;
  }
  if (grounding?.kind === "fixture") {
    return `Recognized fixture (non-priced): ${grounding.fixture.homeTeam.name} vs ${grounding.fixture.awayTeam.name}.`;
  }
  return "General football analysis (no priced fixture selected).";
}

/** Agent path for match, table, season, and general tiers using data-layer tools. */
export async function runChatAgent(
  question: string,
  grounding: AskGrounding,
  client: Pick<Anthropic, "messages">,
  signal?: AbortSignal,
): Promise<string> {
  const inference = resolveInference();
  const seed = grounding?.kind === "match" ? `\n${matchSeedBlock(grounding)}\n` : "";
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `${groundingContextLine(grounding)}${seed}\nQuestion: ${question}`,
  }];

  for (let step = 0; step < 8; step += 1) {
    const response = await client.messages.create({
      model: inference.model,
      max_tokens: 1200,
      system: CHAT_AGENT_SYSTEM,
      tools: AGENT_TOOLS,
      messages,
      ...agentReasoning(),
    }, { signal });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUses.length) return extractText(response) || "No bet — I couldn't assemble a grounded read.";

    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    const results = await Promise.all(toolUses.map(async (toolUse) => ({
      type: "tool_result" as const,
      tool_use_id: toolUse.id,
      content: JSON.stringify(await runAgentTool(
        toolUse.name,
        (toolUse.input ?? {}) as Record<string, unknown>,
        grounding,
        signal,
      )),
    })));
    messages.push({ role: "user", content: results });
  }
  return "No bet — the agent loop exhausted its tool budget before finishing.";
}

/** @deprecated Use runChatAgent */
export async function runChatAgentMatch(
  question: string,
  grounding: Extract<AskGrounding, { kind: "match" }>,
  client: Pick<Anthropic, "messages">,
  signal?: AbortSignal,
): Promise<string> {
  return runChatAgent(question, grounding, client, signal);
}

export function chatAgentGroundingEligible(grounding: AskGrounding): boolean {
  if (grounding?.kind === "fixture") return false;
  return true;
}
