import { Router, type Request, type Response, type NextFunction } from "express";
import { authorizeDossierRebuildRequest } from "../services/eval-internal-auth";
import {
  getMatchDossier,
  matchDossierEnabled,
  dossierCronStatus,
  listStoredDossierFixtureIds,
  triggerDossierSlateRebuild,
  getDossierSlateRebuildProgress,
} from "../services/match-dossier";
import {
  fixtureRebuildCooldownRetryAfterSec,
  noteFixtureRebuildTriggered,
  noteSlateRebuildTriggered,
  slateRebuildCooldownRetryAfterSec,
} from "../services/match-dossier/dossier-rebuild-rate-limit";
import { publicMatchDossierView } from "../services/match-dossier/types";

const router: Router = Router();

router.use((_req, res, next) => {
  if (!matchDossierEnabled()) {
    res.status(404).json({
      error: "Match dossier API is disabled.",
      code: "MATCH_DOSSIER_DISABLED",
      hint: "Set MATCH_DOSSIER_ENABLED=true in non-production to use this surface.",
    });
    return;
  }
  next();
});

function rebuildUnauthorized(res: Response): void {
  res.status(401).json({ error: "Unauthorized" });
}

function rebuildForbidden(res: Response): void {
  res.status(403).json({ error: "Forbidden" });
}

function rebuildRateLimited(res: Response, retryAfterSec: number): void {
  res.set("Retry-After", String(retryAfterSec));
  res.status(429).json({
    error: "rebuild_rate_limited",
    retryAfter: retryAfterSec,
  });
}

router.get("/status", async (req: Request, res: Response) => {
  if (req.query.rebuild === "true") {
    const auth = await authorizeDossierRebuildRequest(req);
    if (auth === "unauthorized") {
      rebuildUnauthorized(res);
      return;
    }
    if (auth === "forbidden") {
      rebuildForbidden(res);
      return;
    }
    const running = getDossierSlateRebuildProgress().state === "running";
    if (!running) {
      const retryAfter = slateRebuildCooldownRetryAfterSec();
      if (retryAfter != null) {
        rebuildRateLimited(res, retryAfter);
        return;
      }
    }
    const started = triggerDossierSlateRebuild();
    if (started) noteSlateRebuildTriggered();
    const payload = {
      ...dossierCronStatus(),
      storedCount: listStoredDossierFixtureIds().length,
    };
    res.status(202).set("Cache-Control", "no-store").json(payload);
    return;
  }
  const payload = {
    ...dossierCronStatus(),
    storedCount: listStoredDossierFixtureIds().length,
  };
  res.set("Cache-Control", "no-store").json(payload);
});

router.get("/:fixtureKey", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rebuild = req.query.rebuild === "true";
    if (rebuild) {
      const auth = await authorizeDossierRebuildRequest(req);
      if (auth === "unauthorized") {
        rebuildUnauthorized(res);
        return;
      }
      if (auth === "forbidden") {
        rebuildForbidden(res);
        return;
      }
      const retryAfter = fixtureRebuildCooldownRetryAfterSec(req.params.fixtureKey);
      if (retryAfter != null) {
        rebuildRateLimited(res, retryAfter);
        return;
      }
      noteFixtureRebuildTriggered(req.params.fixtureKey);
    }
    const result = await getMatchDossier(req.params.fixtureKey, { rebuild });
    if (!result) {
      res.status(404).json({
        error: "Fixture not found or dossier unavailable.",
        code: "DOSSIER_NOT_FOUND",
      });
      return;
    }
    res.set("Cache-Control", "no-store").json({
      ...publicMatchDossierView(result.dossier),
      _meta: { servedFrom: result.source },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
