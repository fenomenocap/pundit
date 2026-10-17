import Anthropic from "@anthropic-ai/sdk";
import { MODEL_EDGE_CLAIMS_ALLOWED } from "../config/backtest-gate";
import type { AskGrounding, EvidenceBundle, EvidenceSource } from "./ask";
import { getFixtures } from "./data-layer/getFixtures";
import { getMarketOdds } from "./data-layer/getMarketOdds";
import { getForm } from "./data-layer/getForm";
import { getStandings } from "./data-layer/getStandings";
import { getTeamNews, type TeamNewsHit } from "./data-layer/getTeamNews";
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
import { STAKE_REFUSAL_SENTENCE } from "./response-composer";
import {
  AGENT_MAX_CUMULATIVE_LLM_TOKENS,
  AGENT_MAX_OUTPUT_TOKENS_PER_STEP,
  AGENT_MAX_TOOL_STEPS,
  AGENT_TURN_HARD_MS,
  emptyChatAgentTurnMetrics,
  type ChatAgentTurnMetrics,
} from "./chat-agent-limits";

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
Open with your call (Back / Lean / Avoid / No bet) or a direct factual answer — never "I will explain" preambles.
For a priced fixture, the first line must state home, draw and away percentages from the seeded Fundamental block or get_model_forecast.
Every probability and fair price must come from tool output or the seeded Fundamental block — never guess.
Label Pundit Fundamental numbers separately from external market consensus; never blend them into one "model" figure.
When comparing to Kalshi, Polymarket or Stake, name the source you are quoting.
For manager or injury claims: cite with [[S1]]-style markers matching tool source ids, plus a markdown link [title](url) on the same sentence.
If a search tool returns no rows, say you could not verify that fact — do not invent squad or injury news.
When Fundamental disagrees with market consensus, say so plainly using the supplied gaps — never call it "edge" or "value"${MODEL_EDGE_CLAIMS_ALLOWED ? "" : " until the backtest gate passes"}.
Never say lock, guaranteed, or can't lose. On explicit betting calls only, mention small stakes and 18+ / gamble responsibly.
If asked to size a stake without a bankroll, refuse with exactly: "${STAKE_REFUSAL_SENTENCE}"
Do not leave empty **Section** headers. Finish every sentence; do not trail off mid-thought.
Refuse anything aimed at problem gambling. Vary phrasing; avoid repeating the same section headers every turn.`;

function agentReasoning(): { thinking?: { type: "enabled"; budget_tokens: number } } {
  if (process.env.PUNDIT_REASONING?.trim().toLowerCase() === "on") {
    if (resolveInference().provider === "openrouter") {
      return { thinking: { type: "enabled", budget_tokens: 1024 } };
    }
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
  return null;
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
      oddsSources: grounding.oddsSources ?? [],
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

function emptyBundle(): EvidenceBundle {
  return { queries: [], results: [], providerCalls: 0 };
}

function appendNewsHits(bundle: EvidenceBundle, hits: TeamNewsHit[], query: string): void {
  if (!query.trim()) return;
  if (!bundle.queries.includes(query)) bundle.queries.push(query);
  bundle.providerCalls = (bundle.providerCalls ?? 0) + 1;
  const offset = bundle.results.length;
  for (const [index, hit] of hits.entries()) {
    const row: EvidenceSource = {
      id: `S${offset + index + 1}`,
      title: hit.title,
      url: hit.link,
      date: hit.date || new Date().toISOString().slice(0, 10),
      snippet: hit.snippet,
      tier: hit.tier,
    };
    bundle.results.push(row);
  }
}

function normalizeAgentMarkers(text: string, bundle: EvidenceBundle): string {
  let normalized = text;
  for (const source of bundle.results) {
    const escapedUrl = source.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linkPattern = new RegExp(`\\[([^\\]]+)\\]\\(${escapedUrl}\\)`, "g");
    normalized = normalized.replace(linkPattern, `[[${source.id}]]`);
  }
  return normalized;
}

async function runAgentTool(
  name: string,
  input: Record<string, unknown>,
  grounding: AskGrounding,
  bundle: EvidenceBundle,
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
    case "get_team_news": {
      const question = String(input.question ?? "");
      const result = await getTeamNews({ question, grounding: fed }, signal);
      const hits = Array.isArray(result.data) ? result.data : [];
      appendNewsHits(bundle, hits, question);
      return { hits, sourceIds: bundle.results.map((row) => row.id) };
    }
    case "get_managers": {
      const club = String(input.club ?? (grounding?.kind === "match" ? grounding.home : ""));
      const result = await getManagers({ club, grounding: fed }, signal);
      const hits = Array.isArray(result.data) ? result.data : [];
      appendNewsHits(bundle, hits, `Who is the current manager of ${club}?`);
      return { hits, sourceIds: bundle.results.map((row) => row.id) };
    }
    case "get_player": {
      const player = String(input.player ?? "");
      const club = typeof input.club === "string" ? input.club : undefined;
      const question = club
        ? `${player} injury availability ${club}`
        : `${player} injury availability`;
      const result = await getPlayer({ player, club }, signal);
      const hits = Array.isArray(result.data) ? result.data : [];
      appendNewsHits(bundle, hits, question);
      return { hits, sourceIds: bundle.results.map((row) => row.id) };
    }
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

export interface ChatAgentRunResult {
  text: string;
  bundle: EvidenceBundle;
  metrics: ChatAgentTurnMetrics;
}

export interface RunChatAgentOptions {
  /** Wall-clock cap for the whole agent loop (hard stop). */
  hardBudgetMs?: number;
}

function usageTokens(response: Anthropic.Message): { input: number; output: number } {
  const usage = response.usage;
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
  };
}

/** Agent path for match, table, season, and general tiers using data-layer tools. */
export async function runChatAgent(
  question: string,
  grounding: AskGrounding,
  client: Pick<Anthropic, "messages">,
  signal?: AbortSignal,
  options: RunChatAgentOptions = {},
): Promise<ChatAgentRunResult> {
  const inference = resolveInference();
  const bundle = emptyBundle();
  const metrics = emptyChatAgentTurnMetrics();
  const turnStarted = Date.now();
  const hardBudgetMs = options.hardBudgetMs ?? AGENT_TURN_HARD_MS;
  const hardCap = new AbortController();
  const onParentAbort = () => hardCap.abort(signal?.reason);
  if (signal?.aborted) hardCap.abort(signal.reason);
  else signal?.addEventListener("abort", onParentAbort, { once: true });
  const hardTimer = setTimeout(() => {
    hardCap.abort(new Error("agent turn hard budget exceeded"));
  }, hardBudgetMs);
  const loopSignal = hardCap.signal;

  const seed = grounding?.kind === "match" ? `\n${matchSeedBlock(grounding)}\n` : "";
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `${groundingContextLine(grounding)}${seed}\nQuestion: ${question}`,
  }];

  let text = "";
  try {
    for (let step = 0; step < AGENT_MAX_TOOL_STEPS; step += 1) {
      if (metrics.cumulativeTokens >= AGENT_MAX_CUMULATIVE_LLM_TOKENS) break;
      const response = await client.messages.create({
        model: inference.model,
        max_tokens: AGENT_MAX_OUTPUT_TOKENS_PER_STEP,
        system: CHAT_AGENT_SYSTEM,
        tools: AGENT_TOOLS,
        messages,
        ...agentReasoning(),
      }, { signal: loopSignal });

      const stepUsage = usageTokens(response);
      metrics.inputTokens += stepUsage.input;
      metrics.outputTokens += stepUsage.output;
      metrics.cumulativeTokens += stepUsage.input + stepUsage.output;
      metrics.toolSteps = step + 1;

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      if (!toolUses.length) {
        text = extractText(response) || "";
        break;
      }
      if (metrics.cumulativeTokens >= AGENT_MAX_CUMULATIVE_LLM_TOKENS) break;

      messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
      const results = await Promise.all(toolUses.map(async (toolUse) => ({
        type: "tool_result" as const,
        tool_use_id: toolUse.id,
        content: JSON.stringify(await runAgentTool(
          toolUse.name,
          (toolUse.input ?? {}) as Record<string, unknown>,
          grounding,
          bundle,
          loopSignal,
        )),
      })));
      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    if (!text.trim() && !isAbortError(error, loopSignal)) throw error;
  } finally {
    clearTimeout(hardTimer);
    signal?.removeEventListener("abort", onParentAbort);
  }
  if (!text) {
    text = "No bet — the agent loop exhausted its tool budget before finishing.";
  }
  metrics.latencyMs = Date.now() - turnStarted;
  metrics.publisherFetches = bundle.providerCalls ?? 0;
  return {
    text: normalizeAgentMarkers(text, bundle),
    bundle,
    metrics,
  };
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && /abort|budget exceeded/i.test(error.message);
}

/** @deprecated Use runChatAgent */
export async function runChatAgentMatch(
  question: string,
  grounding: Extract<AskGrounding, { kind: "match" }>,
  client: Pick<Anthropic, "messages">,
  signal?: AbortSignal,
): Promise<string> {
  return (await runChatAgent(question, grounding, client, signal)).text;
}

export function chatAgentGroundingEligible(grounding: AskGrounding): boolean {
  if (grounding?.kind === "fixture") return false;
  return true;
}
