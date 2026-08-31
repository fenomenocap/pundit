import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { AppError } from "../middleware";
import {
  answerQuestion,
  answerQuestionStream,
  ConversationTurn,
  FixtureContext,
  TeamContext,
} from "../services/ask";

const router: Router = Router();
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CONTENT_LENGTH = 4_000;
const MAX_HISTORY_TOTAL_LENGTH = 12_000;

export function parseHistory(raw: unknown): ConversationTurn[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new AppError(400, "The conversation context is invalid. Start a new chat and try again.");

  const history = raw.slice(-MAX_HISTORY_TURNS).map((turn) => {
    if (!turn || typeof turn !== "object") {
      throw new AppError(400, "The conversation context is invalid. Start a new chat and try again.");
    }

    const role = (turn as { role?: unknown }).role;
    const content = (turn as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      throw new AppError(400, "The conversation context is invalid. Start a new chat and try again.");
    }

    const trimmedContent = content.trim();
    if (!trimmedContent || trimmedContent.length > MAX_HISTORY_CONTENT_LENGTH) {
      throw new AppError(400, "The conversation context is invalid. Start a new chat and try again.");
    }

    return { role, content: trimmedContent } as ConversationTurn;
  });

  if (history.length % 2 !== 0 || history.some((turn, index) =>
    turn.role !== (index % 2 === 0 ? "user" : "assistant")
  )) {
    throw new AppError(400, "The conversation context is invalid. Start a new chat and try again.");
  }
  const totalLength = history.reduce((total, turn) => total + turn.content.length, 0);
  if (totalLength > MAX_HISTORY_TOTAL_LENGTH) {
    throw new AppError(400, "The conversation context is too long. Start a new chat and try again.");
  }
  return history;
}

export function parseTeamContext(raw: unknown): TeamContext | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length !== 2
    || raw.some((team) => typeof team !== "string" || !team.trim())) {
    throw new AppError(400, "The selected match context is invalid. Start a new chat and try again.");
  }
  return [raw[0].trim(), raw[1].trim()];
}

export function parseQuestion(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AppError(400, "Please enter a question.");
  }
  const question = raw.trim();
  if (question.length > 500) {
    throw new AppError(400, "Your question is too long. Please shorten it and try again.");
  }
  return question;
}

export function parseFixtureContext(raw: unknown): FixtureContext | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object"
    || typeof (raw as { fixtureId?: unknown }).fixtureId !== "string"
    || !(raw as { fixtureId: string }).fixtureId.trim()) {
    throw new AppError(400, "The selected match context is invalid. Start a new chat and try again.");
  }
  return { fixtureId: (raw as { fixtureId: string }).fixtureId.trim() };
}

export interface AskRateLimitConfig {
  scope: "deployment";
  perMinute: number;
  replicas: number;
  perInstance: number;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function resolveAskRateLimitConfig(
  env: Record<string, string | undefined> = process.env
): AskRateLimitConfig {
  const perMinute = positiveInteger(env.ASK_RATE_LIMIT_PER_MINUTE, 10, "ASK_RATE_LIMIT_PER_MINUTE");
  const replicas = positiveInteger(env.API_REPLICAS, 1, "API_REPLICAS");
  if (replicas > perMinute) {
    throw new Error("API_REPLICAS cannot exceed ASK_RATE_LIMIT_PER_MINUTE.");
  }
  return {
    scope: "deployment",
    perMinute,
    replicas,
    perInstance: Math.floor(perMinute / replicas),
  };
}

export const askRateLimitConfig = resolveAskRateLimitConfig();

// One process-wide bucket, not one bucket per source IP. Combined with the
// validated per-replica division, unrelated clients cannot each consume the
// full MiniMax budget. Exact cross-replica coordination would require a shared
// store; Railway's declared replica count is therefore part of readiness.
export function askRateLimitKey(): string {
  return "deployment";
}

export function createAskRateLimiter(config = askRateLimitConfig) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: config.perInstance,
    keyGenerator: askRateLimitKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, try again shortly." },
  });
}

router.use(createAskRateLimiter());

function sseSend(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trimmedQuestion = parseQuestion(req.body?.question);

    const history = parseHistory(req.body?.history);
    const teamContext = parseTeamContext(req.body?.teamContext);
    const fixtureContext = parseFixtureContext(req.body?.fixtureContext);
    const requestAbort = new AbortController();
    const deadline = setTimeout(() => requestAbort.abort(new Error("request deadline exceeded")), 90_000);
    const abortOnDisconnect = () => {
      if (!res.writableEnded) requestAbort.abort(new Error("client disconnected"));
    };
    req.once("aborted", abortOnDisconnect);
    res.once("close", abortOnDisconnect);

    if (req.body?.stream !== true) {
      try {
        const result = await answerQuestion(
          trimmedQuestion,
          history,
          teamContext,
          requestAbort.signal,
          fixtureContext
        );
        res.json(result);
      } finally {
        clearTimeout(deadline);
        req.off("aborted", abortOnDisconnect);
        res.off("close", abortOnDisconnect);
      }
      return;
    }

    // SSE streaming path. Headers are only committed once grounding resolves,
    // so validation/config errors before that still surface as normal JSON
    // errors with a real status code via next(err).
    // A web-search turn can think silently for minutes before the first text
    // delta; Railway's edge closes streams idle for ~60s, so send an SSE
    // comment as a heartbeat while the connection would otherwise be quiet.
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let clientGone = false;
    const stopHeartbeat = () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    };
    const onClose = () => {
      clientGone = true;
      requestAbort.abort(new Error("client disconnected"));
      stopHeartbeat();
    };
    req.on("close", onClose);
    res.on("close", onClose);
    try {
      const { answer, grounding, citations, verification, presentation } = await answerQuestionStream(
        trimmedQuestion,
        history,
        teamContext,
        {
          onGrounding: (initialGrounding) => {
            if (clientGone || res.writableEnded) return;
            res.status(200).set({
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            });
            res.flushHeaders();
            sseSend(res, "grounding", { grounding: initialGrounding });
            heartbeat = setInterval(() => {
              if (!res.writableEnded) res.write(": ping\n\n");
            }, 15_000);
          },
          // Whole-answer guards can invalidate an earlier sentence after a
          // later contradiction or multiline market leg arrives. Generation
          // is therefore buffered and released as one safe delta; `done`
          // remains authoritative and clients replace message content with it.
          onDelta: (text) => {
            if (clientGone || res.writableEnded) return;
            sseSend(res, "delta", { text });
          },
          shouldContinue: () => !clientGone && !res.writableEnded,
          signal: requestAbort.signal,
        },
        fixtureContext
      );
      stopHeartbeat();
      if (!clientGone && !res.writableEnded) {
        sseSend(res, "done", {
          answer,
          grounding,
          verification,
          presentation,
          ...(citations ? { citations } : {}),
        });
        res.end();
      }
    } catch (err) {
      stopHeartbeat();
      if (clientGone || res.writableEnded) return;
      if (!res.headersSent) throw err;
      const message = err instanceof AppError ? err.message : "Analysis generation failed.";
      const status = err instanceof AppError ? err.statusCode : 502;
      const code = err instanceof AppError ? err.code : undefined;
      sseSend(res, "error", {
        error: message,
        status,
        ...(code ? { code } : {}),
      });
      res.end();
    } finally {
      req.off("close", onClose);
      res.off("close", onClose);
      req.off("aborted", abortOnDisconnect);
      res.off("close", abortOnDisconnect);
      clearTimeout(deadline);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
