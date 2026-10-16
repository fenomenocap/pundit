import Anthropic from "@anthropic-ai/sdk";
import { MODEL_EDGE_CLAIMS_ALLOWED } from "../config/backtest-gate";
import type { Grounding } from "./ask";
import { getModelForecast } from "./data-layer/getModelForecast";
import { getMarketOdds } from "./data-layer/getMarketOdds";
import { getForm } from "./data-layer/getForm";
import { getStandings } from "./data-layer/getStandings";
import { getTeamNews } from "./data-layer/getTeamNews";
import { getManagers } from "./data-layer/getManagers";
import { getPlayer } from "./data-layer/getPlayer";
import { getModelForecastByKey } from "./data-layer/getModelForecast";
import { getCachedModelData, getModelFixtureKey } from "./model-data";
import { resolveInference } from "./inference-config";

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_model_forecast",
    description: "Pundit Fundamental 1X2, totals, BTTS and scorelines for the selected fixture.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_market_odds",
    description: "External no-vig 1X2 sources and volume-weighted market consensus.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_form",
    description: "Recent league form for both clubs in the fixture competition.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_standings",
    description: "Current competition table rows from ESPN.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
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
Every probability and fair price must come from a tool result. Every news claim needs a URL from search tools.
When our model disagrees with market consensus, say so plainly and explain using the supplied gaps — never call it "edge" or "value"${MODEL_EDGE_CLAIMS_ALLOWED ? "" : " until the backtest gate passes"}.
Never say lock, guaranteed, or can't lose. Mention small stakes and 18+ / gamble responsibly on any betting call.
Refuse anything aimed at problem gambling.`;

function agentReasoning(): { thinking?: { type: "enabled" } } {
  if (process.env.PUNDIT_REASONING?.trim().toLowerCase() === "off") return {};
  if (resolveInference().provider === "openrouter") {
    return { thinking: { type: "enabled" as const } };
  }
  return {};
}

async function runAgentTool(
  name: string,
  input: Record<string, unknown>,
  fixture: Grounding,
  signal?: AbortSignal,
): Promise<unknown> {
  const cached = getCachedModelData().fixtures.find(
    (row) => getModelFixtureKey(row) === fixture.fixtureId,
  );
  const modelRow = getModelForecastByKey(fixture.fixtureId);
  switch (name) {
    case "get_model_forecast":
      return modelRow?.data ?? { error: "model_fixture_not_found" };
    case "get_market_odds":
      if (!cached) return { error: "model_fixture_not_found" };
      return getMarketOdds(cached).data;
    case "get_form":
      return getForm({ competitionId: fixture.competitionId }).data;
    case "get_standings":
      return getStandings({ competitionId: fixture.competitionId }).data;
    case "get_team_news":
      return (await getTeamNews({
        question: String(input.question ?? ""),
        grounding: { kind: "match", home: fixture.home, away: fixture.away, freshness: fixture.freshness },
      }, signal)).data;
    case "get_managers":
      return (await getManagers({
        club: String(input.club ?? fixture.home),
        grounding: { kind: "match", home: fixture.home, away: fixture.away, freshness: fixture.freshness },
      }, signal)).data;
    case "get_player":
      return (await getPlayer({
        player: String(input.player ?? ""),
        club: typeof input.club === "string" ? input.club : undefined,
        grounding: { kind: "match", home: fixture.home, away: fixture.away, freshness: fixture.freshness },
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

export async function runChatAgentMatch(
  question: string,
  grounding: Grounding,
  client: Anthropic,
  signal?: AbortSignal,
): Promise<string> {
  const inference = resolveInference();
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `Fixture: ${grounding.home} vs ${grounding.away} (${grounding.competition}).\nQuestion: ${question}`,
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
