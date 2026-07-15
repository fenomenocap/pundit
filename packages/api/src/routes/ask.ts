import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { AppError } from "../middleware";
import {
  answerQuestion,
  ConversationTurn,
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
    throw new AppError(400, "History must contain complete user/assistant exchanges.");
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

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, try again shortly." },
  })
);

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
    const result = await answerQuestion(trimmedQuestion, history, teamContext);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
