import { Request, Response, NextFunction } from "express";

// ─── Request Logging ────────────────────────────────────────────────────────

export function requestLogger(req: Request, _res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, path } = req;

  _res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`${method} ${path} ${_res.statusCode} ${duration}ms`);
  });

  next();
}

// ─── Admin Auth ─────────────────────────────────────────────────────────────
//
// Callers must set the header:
//   x-admin-key: <value of ADMIN_API_KEY env var>
//
// The key is a secret known only to the protocol operator. It is NOT a public
// Ethereum address — never put it in NEXT_PUBLIC_* or commit it to source.

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey) {
    res.status(503).json({ error: "ADMIN_API_KEY not configured on server" });
    return;
  }

  const providedKey = req.headers["x-admin-key"] as string | undefined;

  if (!providedKey || providedKey !== expectedKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

// ─── Error Handling ─────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(`Error: ${err.message}`);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}
