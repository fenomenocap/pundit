import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { AppError } from "../middleware";
import { answerQuestion } from "../services/ask";

const router: Router = Router();

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

    const result = await answerQuestion(question.trim());
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
