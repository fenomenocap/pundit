import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const CHAT_EVAL_REMOTE_JUDGE_MAX_TURNS = 24;
export const CHAT_EVAL_REMOTE_JUDGE_MAX_ANSWER_CHARS = 12_000;
export const CHAT_EVAL_REMOTE_JUDGE_MAX_BODY_BYTES = 600_000;

export function chatEvalRemoteJudgeEnabled(): boolean {
  return process.env.CHAT_EVAL_REMOTE_JUDGE_ENABLED?.trim().toLowerCase() === "true";
}

export function chatEvalInternalTokenConfigured(): boolean {
  return Boolean(process.env.CHAT_EVAL_INTERNAL_TOKEN?.trim());
}

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readChatEvalInternalToken(req: Request): string | null {
  const auth = req.headers.authorization?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    return token || null;
  }
  const header = req.headers["x-pundit-chat-eval-token"];
  const token = (Array.isArray(header) ? header[0] : header)?.trim();
  return token || null;
}

export function authorizeChatEvalInternalRequest(req: Request): "disabled" | "unauthorized" | "authorized" {
  if (!chatEvalRemoteJudgeEnabled()) return "disabled";
  const expected = process.env.CHAT_EVAL_INTERNAL_TOKEN?.trim();
  if (!expected) return "disabled";
  const provided = readChatEvalInternalToken(req);
  if (!provided || !tokensMatch(provided, expected)) return "unauthorized";
  return "authorized";
}

export function getChatEvalRemoteJudgeReadiness(): {
  enabled: boolean;
  tokenConfigured: boolean;
  openRouterConfigured: boolean;
} {
  return {
    enabled: chatEvalRemoteJudgeEnabled(),
    tokenConfigured: chatEvalInternalTokenConfigured(),
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  };
}
