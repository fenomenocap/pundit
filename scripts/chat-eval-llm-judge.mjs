/**
 * OpenRouter LLM judge for chat eval answers (persona, call, specificity, variety, citations).
 */

const PINNED_MODEL = "deepseek/deepseek-v4-flash";

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
  const model = options.model ?? (process.env.OPENROUTER_MODEL?.trim() || PINNED_MODEL);
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
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    return { skipped: true, reason: `HTTP ${response.status}: ${text.slice(0, 200)}`, scores: null };
  }
  let parsed;
  try {
    const body = JSON.parse(text);
    const content = body.choices?.[0]?.message?.content ?? "";
    parsed = JSON.parse(content);
  } catch {
    return { skipped: true, reason: "invalid_judge_json", scores: null };
  }
  return { skipped: false, scores: parsed };
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
