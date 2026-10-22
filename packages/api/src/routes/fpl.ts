import { Router, type Request, type Response, type NextFunction } from "express";
import { getFplBootstrap } from "../services/fpl-bootstrap";

const router: Router = Router();

// Public FPL player data for the web team builder. No key. Good responses may
// be cached for up to an hour downstream; errors are never cached.
router.get("/bootstrap", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getFplBootstrap();
    if (!result.ok) {
      res.status(result.status).set("Cache-Control", "no-store").json({ error: result.error });
      return;
    }
    res
      .set("Cache-Control", result.cache === "stale" ? "no-store" : "public, max-age=3600")
      .set("X-Pundit-Cache", result.cache)
      .json({ ...result.payload, stale: result.cache === "stale" });
  } catch (err) {
    next(err);
  }
});

export default router;
