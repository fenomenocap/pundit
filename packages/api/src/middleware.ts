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
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

// express.json() reports unparseable bodies as a SyntaxError carrying
// type: "entity.parse.failed" — a client error, not a server fault.
function isBodyParseError(err: Error): boolean {
  return (err as { type?: unknown }).type === "entity.parse.failed";
}

// A body over express.json()'s 32kb limit is also the client's doing. It was
// reaching the generic branch and answering 500, which reads as "the server
// broke" and invites a retry of a request that can never succeed. The route's
// own 500-character question guard never sees these: body-parser rejects the
// payload before any handler runs.
function isBodyTooLargeError(err: Error): boolean {
  return (err as { type?: unknown }).type === "entity.too.large";
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(`Error: ${err.message}`);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  if (isBodyParseError(err)) {
    res.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }

  if (isBodyTooLargeError(err)) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}
