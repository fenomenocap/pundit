/**
 * Remote judge mode: score eval turns via Railway POST /internal/eval/judge (no GitHub OpenRouter key).
 */

import { judgeEvalTurns, skippedNoKeyJudge } from "./chat-eval-judge-core.mjs";

export function resolveJudgeMode(explicit) {
  const raw = explicit ?? process.env.CHAT_EVAL_JUDGE_MODE?.trim().toLowerCase() ?? "local";
  if (raw === "remote" || raw === "local" || raw === "off") return raw;
  throw new Error(`CHAT_EVAL_JUDGE_MODE must be local, remote, or off (got ${raw})`);
}

function defaultJudgeUrl(apiUrl) {
  const configured = process.env.CHAT_EVAL_JUDGE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const base = (apiUrl ?? process.env.API_URL ?? "https://thepundit.up.railway.app").replace(/\/$/, "");
  return `${base}/internal/eval/judge`;
}

export async function judgeEvalTurnsRemote(turns, options = {}) {
  const sample = turns.filter((turn) => turn.httpStatus === 200 && turn.answer?.trim());
  const maxTurns = options.maxTurns ?? 24;
  const selected = options.sampleAll ? sample : sample.slice(0, maxTurns);
  const token = options.internalToken ?? process.env.CHAT_EVAL_INTERNAL_TOKEN?.trim();
  const judgeUrl = defaultJudgeUrl(options.apiUrl);
  if (!token) {
    return skippedNoKeyJudge(turns, {
      ...options,
      skipReason: "CHAT_EVAL_INTERNAL_TOKEN unset",
    });
  }
  const payloadTurns = selected.map((turn) => ({
    scenarioId: turn.scenarioId ?? null,
    turn: turn.turn ?? null,
    question: turn.question ?? "",
    answer: turn.answer ?? "",
    citations: (turn.citations ?? []).map((row) => ({
      url: row.url ?? row.link ?? undefined,
    })),
  }));
  let response;
  try {
    response = await fetch(judgeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ turns: payloadTurns, maxTurns }),
    });
  } catch (error) {
    return skippedNoKeyJudge(turns, {
      ...options,
      skipReason: `remote judge fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const text = await response.text();
  if (!response.ok) {
    const snippet = text.slice(0, 200).replace(/\s+/g, " ");
    return skippedNoKeyJudge(turns, {
      ...options,
      skipReason: `remote judge HTTP ${response.status}: ${snippet}`,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    return skippedNoKeyJudge(turns, {
      ...options,
      skipReason: "remote judge returned invalid JSON",
    });
  }
}

export async function resolveJudgeEvalTurns(turns, options = {}) {
  const mode = resolveJudgeMode(options.judgeMode);
  if (mode === "off") {
    return skippedNoKeyJudge(turns, { ...options, skipReason: "judge mode off" });
  }
  if (mode === "remote") {
    return judgeEvalTurnsRemote(turns, options);
  }
  return judgeEvalTurns(turns, options);
}
