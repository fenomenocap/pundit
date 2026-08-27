import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDataDir, readJsonFile, resolveDataPath, writeJsonFileAtomic } from "./persistent-store";

const originalDataDir = process.env.PUNDIT_DATA_DIR;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
  else process.env.PUNDIT_DATA_DIR = originalDataDir;
});

describe("persistent store", () => {
  it("falls back to the in-repo data dir when PUNDIT_DATA_DIR is unset", () => {
    delete process.env.PUNDIT_DATA_DIR;
    expect(getDataDir().endsWith(path.join("packages", "api", "data"))).toBe(true);
  });

  it("resolves paths under the configured volume", () => {
    process.env.PUNDIT_DATA_DIR = "/data";
    expect(resolveDataPath("evaluation/club-season.json")).toBe(path.join("/data", "evaluation", "club-season.json"));
  });

  it("round-trips JSON through nested directories that do not exist yet", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-store-"));
    const target = path.join(dir, "nested", "deep", "artifact.json");
    writeJsonFileAtomic(target, { fixtures: [1, 2, 3] });
    expect(readJsonFile<{ fixtures: number[] }>(target)?.fixtures).toEqual([1, 2, 3]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves no temp file behind, so the artifact is never half-written", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-store-"));
    const target = path.join(dir, "artifact.json");
    writeJsonFileAtomic(target, { a: 1 });
    writeJsonFileAtomic(target, { a: 2 });
    expect(fs.readdirSync(dir)).toEqual(["artifact.json"]);
    expect(readJsonFile<{ a: number }>(target)?.a).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null rather than throwing on a missing or corrupt file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-store-"));
    expect(readJsonFile(path.join(dir, "absent.json"))).toBeNull();
    const corrupt = path.join(dir, "corrupt.json");
    fs.writeFileSync(corrupt, "{ not json", "utf8");
    expect(readJsonFile(corrupt)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
