import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDataDir, readJsonFile, resolveDataPath, writeJsonFileAtomic } from "./persistent-store";

const originalDataDir = process.env.PUNDIT_DATA_DIR;

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(resolveDataPath("evaluation/club-season.json")).toBe("/data/evaluation/club-season.json");
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

  it("uses a unique temp file per write, so two containers that are both PID 1 never share one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-store-"));
    const target = path.join(dir, "artifact.json");
    const spy = vi.spyOn(fs, "writeFileSync");
    writeJsonFileAtomic(target, { a: 1 });
    writeJsonFileAtomic(target, { a: 2 });
    const temps = spy.mock.calls.map(([file]) => String(file));
    expect(temps).toHaveLength(2);
    expect(new Set(temps).size).toBe(2);
    for (const temp of temps) {
      expect(temp.startsWith(`${target}.${process.pid}.`)).toBe(true);
      expect(temp).not.toBe(`${target}.${process.pid}.tmp`);
    }
    expect(fs.readdirSync(dir)).toEqual(["artifact.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("removes its temp file and keeps the previous artifact when the rename fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-store-"));
    const target = path.join(dir, "artifact.json");
    writeJsonFileAtomic(target, { a: 1 });
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("EXDEV");
    });
    expect(() => writeJsonFileAtomic(target, { a: 2 })).toThrow("EXDEV");
    expect(fs.readdirSync(dir)).toEqual(["artifact.json"]);
    expect(readJsonFile<{ a: number }>(target)?.a).toBe(1);
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
