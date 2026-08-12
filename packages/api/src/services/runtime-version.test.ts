import { describe, expect, it } from "vitest";
import { getRuntimeVersion } from "./runtime-version";

describe("getRuntimeVersion", () => {
  it("prefers an explicitly injected build SHA", () => {
    expect(getRuntimeVersion({
      BUILD_SHA: " build-123 ",
      RAILWAY_GIT_COMMIT_SHA: "railway-456",
    })).toEqual({ sha: "build-123" });
  });

  it("uses Railway's commit SHA in production", () => {
    expect(getRuntimeVersion({
      RAILWAY_GIT_COMMIT_SHA: "railway-456",
    })).toEqual({ sha: "railway-456" });
  });

  it("fails observably when no build identity is available", () => {
    expect(getRuntimeVersion({})).toEqual({ sha: "unknown" });
  });
});
