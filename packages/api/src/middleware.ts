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

function getAdminAddresses(): Set<string> {
  const raw = process.env.ADMIN_ADDRESSES || "";
  return new Set(
    raw
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const address = req.headers["x-admin-address"] as string | undefined;
  if (!address) {
    res.status(401).json({ error: "Missing x-admin-address header" });
    return;
  }

  const admins = getAdminAddresses();
  if (admins.size === 0) {
    res.status(503).json({ error: "ADMIN_ADDRESSES not configured" });
    return;
  }

  if (!admins.has(address.toLowerCase())) {
    res.status(403).json({ error: "Not authorized" });
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
