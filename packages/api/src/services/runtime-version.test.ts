import { describe, expect, it } from "vitest";
import { getRuntimeVersion } from "./runtime-version";

describe("getRuntimeVersion", () => {
  it("prefers the platform commit SHA over a stale configured build SHA", () => {
    expect(getRuntimeVersion({
      BUILD_SHA: " build-123 ",
      RAILWAY_GIT_COMMIT_SHA: "railway-456",
    })).toEqual({ sha: "railway-456", deploymentId: null });
  });

  it("uses Railway's commit SHA in production", () => {
    expect(getRuntimeVersion({
      RAILWAY_GIT_COMMIT_SHA: "railway-456",
    })).toEqual({ sha: "railway-456", deploymentId: null });
  });

  it("reports Railway's deployment UUID when present", () => {
    expect(getRuntimeVersion({
      RAILWAY_GIT_COMMIT_SHA: "railway-456",
      RAILWAY_DEPLOYMENT_ID: " 12368317-9ad4-47fe-a495-63a893e9a3da ",
    })).toEqual({
      sha: "railway-456",
      deploymentId: "12368317-9ad4-47fe-a495-63a893e9a3da",
    });
  });

  it("fails observably when no build identity is available", () => {
    expect(getRuntimeVersion({})).toEqual({ sha: "unknown", deploymentId: null });
  });
});
