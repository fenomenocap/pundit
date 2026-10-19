import { Router, type Request, type Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import express from "express";
import { AppError } from "../middleware";
import {
  authorizeChatEvalJudgeRequest,
  CHAT_EVAL_JUDGE_REQUEST_TIMEOUT_MS,
  CHAT_EVAL_REMOTE_JUDGE_MAX_ANSWER_CHARS,
  CHAT_EVAL_REMOTE_JUDGE_MAX_BODY_BYTES,
  CHAT_EVAL_REMOTE_JUDGE_MAX_TURNS,
} from "../services/eval-internal-auth";
import { getChatEvalJudgeCore } from "../services/chat-eval-judge-bridge";

const router: Router = Router();

router.use(express.json({ limit: CHAT_EVAL_REMOTE_JUDGE_MAX_BODY_BYTES }));

router.use(rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many judge requests, try again shortly." },
}));

type JudgeTurnInput = {
  scenarioId?: string | null;
  turn?: number | null;
  question?: string;
  answer?: string;
  citations?: Array<{ url?: string; link?: string }>;
};

function sanitizeTurns(raw: unknown): JudgeTurnInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, CHAT_EVAL_REMOTE_JUDGE_MAX_TURNS).map((row) => {
    if (!row || typeof row !== "object") return { question: "", answer: "", citations: [] };
    const record = row as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question : "";
    const answer = typeof record.answer === "string"
      ? record.answer.slice(0, CHAT_EVAL_REMOTE_JUDGE_MAX_ANSWER_CHARS)
      : "";
    const citations = Array.isArray(record.citations)
      ? record.citations.slice(0, 32).map((citation) => {
        if (!citation || typeof citation !== "object") return {};
        const c = citation as Record<string, unknown>;
        return {
          url: typeof c.url === "string" ? c.url.slice(0, 2048) : undefined,
          link: typeof c.link === "string" ? c.link.slice(0, 2048) : undefined,
        };
      })
      : [];
    return {
      scenarioId: typeof record.scenarioId === "string" ? record.scenarioId.slice(0, 120) : null,
      turn: typeof record.turn === "number" && Number.isFinite(record.turn) ? record.turn : null,
      question,
      answer,
      citations,
    };
  });
}

function withRequestTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("judge_request_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

router.post("/judge", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = await authorizeChatEvalJudgeRequest(req);
    if (auth === "unavailable") {
      res.status(503).json({ error: "judge_unavailable" });
      return;
    }
    if (auth === "unauthorized") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (auth === "forbidden") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const body = req.body as { turns?: unknown; maxTurns?: unknown; paceMs?: unknown };
    const turns = sanitizeTurns(body?.turns);
    if (!turns.length) {
      throw new AppError(400, "turns required");
    }
    const maxTurnsRaw = body?.maxTurns;
    const maxTurns = typeof maxTurnsRaw === "number" && Number.isFinite(maxTurnsRaw)
      ? Math.min(Math.max(1, Math.floor(maxTurnsRaw)), CHAT_EVAL_REMOTE_JUDGE_MAX_TURNS)
      : CHAT_EVAL_REMOTE_JUDGE_MAX_TURNS;
    const paceMsRaw = body?.paceMs;
    const paceMs = typeof paceMsRaw === "number" && Number.isFinite(paceMsRaw)
      ? Math.min(Math.max(0, Math.floor(paceMsRaw)), 2000)
      : 250;
    const core = getChatEvalJudgeCore();
    const result = await withRequestTimeout(
      core.judgeEvalTurnPayloads(turns, { maxTurns, paceMs }),
      CHAT_EVAL_JUDGE_REQUEST_TIMEOUT_MS,
    );
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "judge_request_timeout") {
      res.status(504).json({ error: "judge_timeout" });
      return;
    }
    next(error);
  }
});

export default router;
