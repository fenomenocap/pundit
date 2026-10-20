import type { Request } from "express";
import {
  authorizeChatEvalGithubOidcBearer,
  validateDossierRebuildOidcClaims,
  type OidcVerifier,
} from "./eval-github-oidc";

export const CHAT_EVAL_REMOTE_JUDGE_MAX_TURNS = 24;
export const CHAT_EVAL_REMOTE_JUDGE_MAX_ANSWER_CHARS = 12_000;
export const CHAT_EVAL_REMOTE_JUDGE_MAX_BODY_BYTES = 600_000;
export const CHAT_EVAL_JUDGE_REQUEST_TIMEOUT_MS = 120_000;

export function chatEvalJudgeOpenRouterAvailable(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function readBearerToken(req: Request): string | null {
  const auth = req.headers.authorization?.trim();
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export async function authorizeChatEvalJudgeRequest(
  req: Request,
  verify?: OidcVerifier,
): Promise<"unavailable" | "unauthorized" | "forbidden" | "authorized"> {
  if (!chatEvalJudgeOpenRouterAvailable()) return "unavailable";
  const auth = await authorizeChatEvalGithubOidcBearer(readBearerToken(req), verify);
  if (auth === "missing" || auth === "invalid") return "unauthorized";
  if (auth === "forbidden") return "forbidden";
  return "authorized";
}

export async function authorizeDossierRebuildRequest(
  req: Request,
  verify?: OidcVerifier,
): Promise<"unauthorized" | "forbidden" | "authorized"> {
  const auth = await authorizeChatEvalGithubOidcBearer(
    readBearerToken(req),
    verify,
    validateDossierRebuildOidcClaims,
  );
  if (auth === "missing" || auth === "invalid") return "unauthorized";
  if (auth === "forbidden") return "forbidden";
  return "authorized";
}

export function getChatEvalRemoteJudgeReadiness(): {
  available: boolean;
  openRouterConfigured: boolean;
  auth: "github_actions_oidc";
} {
  return {
    available: chatEvalJudgeOpenRouterAvailable(),
    openRouterConfigured: chatEvalJudgeOpenRouterAvailable(),
    auth: "github_actions_oidc",
  };
}
