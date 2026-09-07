import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getCachedClubRatings,
  loadPersistedClubRatings,
  refreshClubRatings,
} from "./club-ratings";
import { getRepoDataDir } from "./persistent-store";
import { selectedClubStrengthArtifactPath } from "./club-strength-artifact";

const originalDataDir = process.env.PUNDIT_DATA_DIR;
let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-ratings-artifact-"));
  process.env.PUNDIT_DATA_DIR = dataDir;
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
  else process.env.PUNDIT_DATA_DIR = originalDataDir;
});

describe("club ratings artifact recovery", () => {
  it("atomically installs current and last-good recovery copies", async () => {
    await refreshClubRatings();
    const current = path.join(dataDir, "cache", "club-strength-artifact.json");
    const lastGood = `${current}.last-good`;
    expect(fs.existsSync(current)).toBe(true);

    await refreshClubRatings();
    expect(fs.existsSync(lastGood)).toBe(true);
    expect(fs.readFileSync(lastGood)).toEqual(fs.readFileSync(current));
  });

  it("restores an intact persisted artifact", () => {
    const target = path.join(dataDir, "cache", "club-strength-artifact.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const selectorPath = selectedClubStrengthArtifactPath(getRepoDataDir());
    const selector = JSON.parse(fs.readFileSync(selectorPath, "utf8")) as { artifactPath: string };
    fs.copyFileSync(path.join(path.dirname(selectorPath), selector.artifactPath), target);
    expect(loadPersistedClubRatings()).toBe(true);
    expect(getCachedClubRatings().servingPersisted).toBe(true);
    expect(getCachedClubRatings().byProfile["uefa-clubs"].size).toBeGreaterThanOrEqual(100);
  });

  it("rejects corrupt persisted current and last-good artifacts", () => {
    const cacheDir = path.join(dataDir, "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "club-strength-artifact.json"), "{bad", "utf8");
    fs.writeFileSync(path.join(cacheDir, "club-strength-artifact.json.last-good"), "{}", "utf8");
    expect(loadPersistedClubRatings()).toBe(false);
  });
});
