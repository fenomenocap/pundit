/**
 * Remote judge mode: score eval turns via Railway POST /internal/eval/judge (GitHub OIDC, no repo secrets).
 */

import {
  judgeEvalTurns,
  skippedNoKeyJudge,
  skippedUnavailableJudge,
} from "./chat-eval-judge-core.mjs";

export function resolveJudgeMode(explicit) {
  const raw = explicit ?? process.env.CHAT_EVAL_JUDGE_MODE?.trim().toLowerCase() ?? "remote";
  if (raw === "remote" || raw === "local" || raw === "off") return raw;
  throw new Error(`CHAT_EVAL_JUDGE_MODE must be local, remote, or off (got ${raw})`);
}

function defaultJudgeUrl(apiUrl) {
  const configured = process.env.CHAT_EVAL_JUDGE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const base = (apiUrl ?? process.env.API_URL ?? "https://thepundit.up.railway.app").replace(/\/$/, "");
  return `${base}/internal/eval/judge`;
}

export function remoteJudgeBearerToken(options = {}) {
  return options.oidcToken
    ?? process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN?.trim()
    ?? null;
}

export function remoteJudgeConfigured(options = {}) {
  return Boolean(remoteJudgeBearerToken(options));
}

export async function judgeEvalTurnsRemote(turns, options = {}) {
  const sample = turns.filter((turn) => turn.httpStatus === 200 && turn.answer?.trim());
  const maxTurns = options.maxTurns ?? 24;
  const selected = options.sampleAll ? sample : sample.slice(0, maxTurns);
  const token = remoteJudgeBearerToken(options);
  const judgeUrl = defaultJudgeUrl(options.apiUrl);
  if (!token) {
    return skippedUnavailableJudge(turns, {
      ...options,
      skipReason: "CHAT_EVAL_GITHUB_OIDC_TOKEN unset",
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
    return skippedUnavailableJudge(turns, {
      ...options,
      skipReason: `remote judge fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const text = await response.text();
  if (response.status === 503) {
    let reason = "judge_unavailable";
    try {
      const body = JSON.parse(text);
      if (body?.error === "judge_unavailable") reason = "judge_unavailable";
    } catch {
      // keep default
    }
    return skippedUnavailableJudge(turns, { ...options, skipReason: reason });
  }
  if (!response.ok) {
    const snippet = text.slice(0, 200).replace(/\s+/g, " ");
    return skippedUnavailableJudge(turns, {
      ...options,
      skipReason: `remote judge HTTP ${response.status}: ${snippet}`,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    return skippedUnavailableJudge(turns, {
      ...options,
      skipReason: "remote judge returned invalid JSON",
    });
  }
}

export async function resolveJudgeEvalTurns(turns, options = {}) {
  const mode = resolveJudgeMode(options.judgeMode);
  if (mode === "off") {
    return skippedUnavailableJudge(turns, { ...options, skipReason: "judge mode off" });
  }
  if (mode === "remote") {
    return judgeEvalTurnsRemote(turns, options);
  }
  return judgeEvalTurns(turns, options);
}
