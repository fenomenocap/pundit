import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { AppError, errorHandler } from "./middleware";

describe("errorHandler", () => {
  it("includes a machine-readable code for structured application errors", () => {
    const json = vi.fn();
    const response = {
      status: vi.fn(),
      json,
    };
    response.status.mockReturnValue(response);

    errorHandler(
      new AppError(
        503,
        "Pundit's match model is temporarily unavailable.",
        "MODEL_UNAVAILABLE"
      ),
      {} as Request,
      response as unknown as Response,
      vi.fn() as NextFunction
    );

    expect(response.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: "Pundit's match model is temporarily unavailable.",
      code: "MODEL_UNAVAILABLE",
    });
  });

  it("preserves the existing error shape when no code is supplied", () => {
    const json = vi.fn();
    const response = {
      status: vi.fn(),
      json,
    };
    response.status.mockReturnValue(response);

    errorHandler(
      new AppError(400, "Bad request."),
      {} as Request,
      response as unknown as Response,
      vi.fn() as NextFunction
    );

    expect(json).toHaveBeenCalledWith({ error: "Bad request." });
  });
});
