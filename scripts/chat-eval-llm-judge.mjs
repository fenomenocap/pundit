/**
 * OpenRouter LLM judge for chat eval answers (persona, call, specificity, variety, citations).
 */

const PINNED_MODEL = "deepseek/deepseek-v4-flash";
const REJECTED_MODEL = /^(?:openrouter\/(?:auto|pareto)|~)|:online|,/i;

const SCORE_KEYS = [
  "personaStrength",
  "clearCall",
  "specificity",
  "variety",
  "citationCorrectness",
  "overall",
];

const JUDGE_SYSTEM = `You score one football analyst answer for a daily quality eval.
Return ONLY valid JSON with numeric scores from 0 to 1 (two decimal places max):
{
  "personaStrength": number,
  "clearCall": number,
  "specificity": number,
  "variety": number,
  "citationCorrectness": number,
  "overall": number,
  "note": string
}
personaStrength: sounds like a sharp pundit, not generic boilerplate.
clearCall: Back/Lean/Avoid/No bet or equivalent decisive stance when the question invites it.
specificity: concrete teams, numbers, or dated facts — not vague filler.
variety: phrasing is not a copy-paste template from other answers.
citationCorrectness: markdown links match claims; abstains when no source (score 1 if no news claims needed).
overall: weighted average emphasizing clearCall and citationCorrectness.`;

export function resolveJudgeModel(requested = process.env.OPENROUTER_MODEL?.trim() ?? "") {
  if (!requested || REJECTED_MODEL.test(requested)) return PINNED_MODEL;
  return requested;
}

function judgeReasoningOff() {
  if (process.env.PUNDIT_REASONING?.trim().toLowerCase() === "on") return {};
  return { thinking: { type: "disabled" } };
}

function stripFence(raw) {
  return String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Locate a JSON object in model text (bare, fenced, or wrapped in prose).
 */
export function extractJudgeJsonObject(raw) {
  const unfenced = stripFence(raw);
  const direct = tryParseJson(unfenced);
  if (direct !== undefined) return direct;
  const start = unfenced.search(/\{\s*"/);
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const nested = tryParseJson(unfenced.slice(start, end + 1));
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function asScoreNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Coerce string scores and derive overall when the model omitted it.
 */
export function normalizeJudgeScores(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const scores = {};
  for (const key of SCORE_KEYS) {
    if (key === "overall") continue;
    const value = asScoreNumber(raw[key]);
    if (value != null) scores[key] = value;
  }
  let overall = asScoreNumber(raw.overall);
  if (overall == null) {
    const parts = ["clearCall", "citationCorrectness", "personaStrength", "specificity", "variety"]
      .map((key) => scores[key])
      .filter((value) => typeof value === "number");
    if (parts.length) {
      overall = parts.reduce((sum, value) => sum + value, 0) / parts.length;
    }
  }
  if (overall == null) return null;
  scores.overall = overall;
  if (typeof raw.note === "string") scores.note = raw.note;
  return scores;
}

export function extractOpenRouterJudgeText(message) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const chunks = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") chunks.push(block.text);
      if (typeof block.content === "string") chunks.push(block.content);
    }
    if (chunks.length) return chunks.join("\n");
  }
  for (const field of ["reasoning", "reasoning_content"]) {
    const value = message[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function parseJudgeCompletionBody(body) {
  const message = body?.choices?.[0]?.message ?? {};
  const text = extractOpenRouterJudgeText(message);
  if (!text.trim()) return { ok: false, reason: "empty_judge_content" };
  const object = extractJudgeJsonObject(text);
  if (object === undefined) return { ok: false, reason: "invalid_judge_json" };
  const scores = normalizeJudgeScores(object);
  if (!scores) return { ok: false, reason: "invalid_judge_scores" };
  return { ok: true, scores };
}

export async function judgeAnswerTurn({ question, answer, citations = [] }, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      skipped: true,
      reason: "OPENROUTER_API_KEY unset",
      scores: null,
    };
  }
  const baseUrl = (options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api").replace(/\/$/, "");
  const model = options.model ?? resolveJudgeModel();
  const userPayload = JSON.stringify({
    question,
    answer,
    citationUrls: citations.map((row) => row.url ?? row.link).filter(Boolean),
  });
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userPayload },
      ],
      response_format: { type: "json_object" },
      ...judgeReasoningOff(),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    return { skipped: true, reason: `HTTP ${response.status}: ${text.slice(0, 200)}`, scores: null };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { skipped: true, reason: "invalid_openrouter_envelope", scores: null };
  }
  const parsed = parseJudgeCompletionBody(body);
  if (!parsed.ok) {
    return { skipped: true, reason: parsed.reason, scores: null };
  }
  return { skipped: false, scores: parsed.scores };
}

export function assertJudgeScoredWhenMockSucceeded(result, mockLabel) {
  if (result.judgedTurns > 0 && result.scoredTurns === 0) {
    const reasons = result.turns?.map((row) => row.reason).filter(Boolean) ?? [];
    throw new Error(
      `LLM judge scored 0/${result.judgedTurns} turns for mock ${mockLabel}; reasons: ${reasons.join(", ") || "unknown"}`,
    );
  }
}

export async function judgeEvalTurns(turns, options = {}) {
  const sample = turns.filter((turn) => turn.httpStatus === 200 && turn.answer?.trim());
  const maxTurns = options.maxTurns ?? 24;
  const selected = options.sampleAll ? sample : sample.slice(0, maxTurns);
  const results = [];
  for (const turn of selected) {
    const verdict = await judgeAnswerTurn({
      question: turn.question ?? "",
      answer: turn.answer,
      citations: turn.citations ?? [],
    }, options);
    results.push({
      scenarioId: turn.scenarioId ?? null,
      turn: turn.turn ?? null,
      question: turn.question ?? null,
      ...verdict,
    });
    if (options.paceMs) await new Promise((resolve) => setTimeout(resolve, options.paceMs));
  }
  const scored = results.filter((row) => row.scores && typeof row.scores.overall === "number");
  const average = (key) => {
    const values = scored.map((row) => row.scores[key]).filter((value) => typeof value === "number");
    if (!values.length) return null;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
  };
  return {
    judgedTurns: results.length,
    scoredTurns: scored.length,
    averages: {
      personaStrength: average("personaStrength"),
      clearCall: average("clearCall"),
      specificity: average("specificity"),
      variety: average("variety"),
      citationCorrectness: average("citationCorrectness"),
      overall: average("overall"),
    },
    turns: results,
  };
}
