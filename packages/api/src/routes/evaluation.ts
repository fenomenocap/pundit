import { Router, Request, Response, NextFunction } from "express";
import { loadWc2026EvaluationArtifact } from "../services/wc-evaluation";

const router: Router = Router();

router.get("/wc-2026", (_req: Request, res: Response, next: NextFunction) => {
  try {
    const artifact = loadWc2026EvaluationArtifact();
    res.json(artifact);
  } catch (err) {
    next(err);
  }
});

export default router;
