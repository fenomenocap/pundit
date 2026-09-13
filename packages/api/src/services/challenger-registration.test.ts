import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DIXON_COLES_MLE_NOT_ACTIVATED,
  appendDixonColesMleChallenger,
  loadValidatedDixonColesMleArtifact,
} from "./challenger-registration";
import {
  FITTED_DIXON_COLES_CONTRIBUTOR_ID,
  FITTED_DIXON_COLES_METHOD_ID,
  writeFittedDixonColesArtifact,
  type FittedDixonColesArtifact,
} from "./dixon-coles-mle";
import {
  DIXON_COLES_MLE_ARTIFACT_SHA256,
  REGISTERED_CHALLENGERS,
  REGISTERED_DIXON_COLES_MLE,
} from "./model-contributors";

function validArtifact(): FittedDixonColesArtifact {
  return {
    schemaVersion: 1,
    contributor: {
      id: FITTED_DIXON_COLES_CONTRIBUTOR_ID,
      methodId: FITTED_DIXON_COLES_METHOD_ID,
      status: "challenger",
    },
    params: {
      intercept: 0.22,
      homeAdvantage: 0.28,
      rho: -0.1,
      timeDecayXi: 0.0065,
      attack: { Hull: -0.4, "Man United": 0.4 },
      defence: { Hull: 0.3, "Man United": -0.3 },
      clubEloPriorStrength: 8,
    },
    training: {
      clubHistoryDatasetSha256: "a".repeat(64),
      preKickoffEloDatasetSha256: "b".repeat(64),
      splitManifest: [],
      rowCount: 10,
      clubCount: 2,
      fitScope: "all-joined-pl-rows",
      excludedFixtureCount: 0,
      plFixtureCoverage: { covered: 10, n: 10 },
      converged: true,
      iterations: 12,
      logLikelihood: -20.5,
    },
  };
}

function tempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pundit-challenger-reg-"));
}

describe("fail-closed dixon-coles-mle registration", () => {
  it("does not append without a fitted artifact", () => {
    const dataDir = tempDataDir();
    const result = appendDixonColesMleChallenger(REGISTERED_CHALLENGERS, dataDir);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("missing-fitted-artifact");
    expect(result.contributor).toBeNull();
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(result.challengers).toEqual(REGISTERED_CHALLENGERS);
    expect(loadValidatedDixonColesMleArtifact(dataDir).ok).toBe(false);
  });

  it("rejects a hash mismatch without appending", () => {
    const dataDir = tempDataDir();
    const written = writeFittedDixonColesArtifact(dataDir, validArtifact());
    const latestPath = path.join(dataDir, "research/dixon-coles-mle/latest.json");
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf8")) as {
      artifactPath: string;
      artifactSha256: string;
    };
    fs.writeFileSync(path.join(dataDir, "research/dixon-coles-mle", written.artifactPath), `${JSON.stringify(validArtifact())}\n`);
    fs.writeFileSync(latestPath, JSON.stringify({
      ...latest,
      artifactSha256: written.artifactSha256,
    }));
    const result = appendDixonColesMleChallenger([], dataDir);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("artifact-hash-mismatch");
    expect(result.challengers).toEqual([]);
  });

  it("rejects a malformed latest pointer and does not invent a challenger", () => {
    const dataDir = tempDataDir();
    const dir = path.join(dataDir, "research/dixon-coles-mle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({
      artifactPath: "../secret.json",
      artifactSha256: "c".repeat(64),
    }));
    const result = appendDixonColesMleChallenger([], dataDir);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("invalid-latest-pointer");
    expect(result.challengers).toEqual([]);
  });

  it("appends a challenger only when latest.json exists and validates", () => {
    const dataDir = tempDataDir();
    const written = writeFittedDixonColesArtifact(dataDir, validArtifact());
    const result = appendDixonColesMleChallenger([], dataDir);
    expect(result.status).toBe("registered");
    expect(result.reason).toBe("artifact-valid");
    expect(result.artifactSha256).toBe(written.artifactSha256);
    expect(result.challengers).toHaveLength(1);
    expect(result.contributor?.id).toBe(FITTED_DIXON_COLES_CONTRIBUTOR_ID);
    expect(result.contributor?.methodId).toBe(FITTED_DIXON_COLES_METHOD_ID);
    expect(result.contributor?.status).toBe("challenger");
    expect(result.contributor?.version).toBe(written.artifactSha256);
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
  });

  it("treats registration as not activation", () => {
    const dataDir = tempDataDir();
    writeFittedDixonColesArtifact(dataDir, validArtifact());
    const result = appendDixonColesMleChallenger(REGISTERED_CHALLENGERS, dataDir);
    expect(result.status).toBe("registered");
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]).toBe(REGISTERED_DIXON_COLES_MLE);
    expect(REGISTERED_CHALLENGERS[0]?.version).toBe(DIXON_COLES_MLE_ARTIFACT_SHA256);
    expect(() => result.contributor?.forecast({
      homeStrength: 1633,
      awayStrength: 1884,
      homeAdvantageElo: 42,
    })).toThrow(DIXON_COLES_MLE_NOT_ACTIVATED);

    const modelData = fs.readFileSync(path.join(__dirname, "model-data.ts"), "utf8");
    const contributors = fs.readFileSync(path.join(__dirname, "model-contributors.ts"), "utf8");
    const index = fs.readFileSync(path.join(__dirname, "../index.ts"), "utf8");
    expect(modelData).toMatch(/ELO_CHAMPION\.forecast/);
    expect(modelData).not.toMatch(/REGISTERED_CHALLENGERS/);
    expect(modelData).not.toMatch(/dixon-coles-mle/);
    expect(modelData).not.toMatch(/challenger-registration/);
    expect(contributors).toMatch(/REGISTERED_DIXON_COLES_MLE/);
    expect(contributors).not.toMatch(/challenger-registration/);
    expect(index).not.toMatch(/challenger-registration/);
    expect(index).not.toMatch(/dixon-coles-mle/);
  });
});
