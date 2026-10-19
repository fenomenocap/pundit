import { Router, type Request, type Response, type NextFunction } from "express";
import { getMatchDossier, matchDossierEnabled, dossierCronStatus, listStoredDossierFixtureIds } from "../services/match-dossier";
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

router.get("/status", (_req: Request, res: Response) => {
  res.set("Cache-Control", "no-store").json({
    ...dossierCronStatus(),
    storedCount: listStoredDossierFixtureIds().length,
  });
});

router.get("/:fixtureKey", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rebuild = req.query.rebuild === "true";
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
