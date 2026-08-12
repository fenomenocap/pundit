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
  if (!Array.isArray(raw)) throw new AppError(400, "'history' must be an array.");

  const history = raw.slice(-MAX_HISTORY_TURNS).map((turn) => {
    if (!turn || typeof turn !== "object") {
      throw new AppError(400, "Each history turn must contain a role and content.");
    }

    const role = (turn as { role?: unknown }).role;
    const content = (turn as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      throw new AppError(400, "History roles must be 'user' or 'assistant' with text content.");
    }

    const trimmedContent = content.trim();
    if (!trimmedContent || trimmedContent.length > MAX_HISTORY_CONTENT_LENGTH) {
      throw new AppError(400, "History content must be between 1 and 4000 characters.");
    }

    return { role, content: trimmedContent } as ConversationTurn;
  });

  if (history.length % 2 !== 0 || history.some((turn, index) =>
    turn.role !== (index % 2 === 0 ? "user" : "assistant")
  )) {
    throw new AppError(400, "Conversation must contain complete user/assistant exchanges.");
  }
  const totalLength = history.reduce((total, turn) => total + turn.content.length, 0);
  if (totalLength > MAX_HISTORY_TOTAL_LENGTH) {
    throw new AppError(400, "History must be 12000 characters or fewer in total.");
  }
  return history;
}

function parseTeamContext(raw: unknown): TeamContext | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length !== 2
    || raw.some((team) => typeof team !== "string" || !team.trim())) {
    throw new AppError(400, "'teamContext' must contain exactly two team names.");
  }
  return [raw[0].trim(), raw[1].trim()];
}

export function parseFixtureContext(raw: unknown): FixtureContext | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object"
    || typeof (raw as { fixtureId?: unknown }).fixtureId !== "string"
    || !(raw as { fixtureId: string }).fixtureId.trim()) {
    throw new AppError(400, "'fixtureContext' must contain a fixtureId.");
  }
  return { fixtureId: (raw as { fixtureId: string }).fixtureId.trim() };
}

// The limit users actually get, across the whole deployment.
const ASK_LIMIT_PER_MINUTE = Number(process.env.ASK_RATE_LIMIT_PER_MINUTE ?? 10);

/**
 * express-rate-limit keeps its counters in process memory, so each replica
 * enforces the limit independently and the real ceiling is limit x replicas.
 * Railway currently runs a single replica, which is why the default is 1 and
 * nothing needs setting for the configured limit to be the real one. Raise it
 * only if the replica count is raised, or the deployment-wide budget silently
 * multiplies.
 *
 * A shared store would make this exact regardless of replica count, but that
 * means Redis, which this project deliberately does not run.
 *
 * Note what this does *not* fix: the in-memory counter increments
 * asynchronously, so a burst of simultaneous requests can all read the same
 * remaining count and slip through together. Sequential traffic is limited
 * exactly -- request 11 of 10 is refused -- while a hard concurrent burst
 * overshoots. That is a property of the store, not of the budget arithmetic.
 */
const API_REPLICAS = Math.max(1, Number(process.env.API_REPLICAS ?? 1));
const PER_INSTANCE_LIMIT = Math.max(1, Math.floor(ASK_LIMIT_PER_MINUTE / API_REPLICAS));

export const askRateLimitConfig = {
  perMinute: ASK_LIMIT_PER_MINUTE,
  replicas: API_REPLICAS,
  perInstance: PER_INSTANCE_LIMIT,
};

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: PER_INSTANCE_LIMIT,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, try again shortly." },
  })
);

function sseSend(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const question = req.body?.question;
    if (typeof question !== "string" || !question.trim()) {
      throw new AppError(400, "Missing 'question' in request body.");
    }

    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length > 500) {
      throw new AppError(400, "Question must be 500 characters or fewer.");
    }

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
      const { answer, grounding, citations, verification } = await answerQuestionStream(
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
          // Deltas carry guard-checked text as it settles, so a client can
          // append them as they arrive. `done` still carries the authoritative
          // answer and clients should replace the message content with it: on
          // the rare turn where a guard rewrites text that had already been
          // released, the server stops emitting deltas and only `done` is
          // complete.
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
