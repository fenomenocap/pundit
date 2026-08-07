import fs from "node:fs";
import path from "node:path";

// Railway rebuilds the container image on every deploy and restarts it freely,
// so anything written next to the source is lost without warning. State that is
// meant to accumulate -- the rolling calibration history, the last-good ClubElo
// ratings -- has to live on a mounted volume instead.
//
// PUNDIT_DATA_DIR points at that volume in production. Unset, this resolves to
// the in-repo data directory, which keeps local dev and tests working exactly as
// before and lets the repo-committed artifacts act as seed data.
const REPO_DATA_DIR = path.join(__dirname, "../../data");

export function getDataDir(): string {
  const configured = process.env.PUNDIT_DATA_DIR?.trim();
  return configured ? configured : REPO_DATA_DIR;
}

export function getRepoDataDir(): string {
  return REPO_DATA_DIR;
}

export function resolveDataPath(relativePath: string): string {
  return path.join(getDataDir(), relativePath);
}

export function resolveRepoDataPath(relativePath: string): string {
  return path.join(REPO_DATA_DIR, relativePath);
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`[Store] Unreadable JSON at ${filePath}: ${message}`);
    return null;
  }
}

/**
 * Writes via a temporary file and an atomic rename so a crash or a restart
 * mid-write cannot leave a half-serialised artifact behind. The previous
 * writeFileSync truncated in place, which risked permanently corrupting a
 * history that by design cannot be regenerated.
 */
export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}
