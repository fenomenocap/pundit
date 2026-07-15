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
