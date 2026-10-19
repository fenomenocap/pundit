import fs from "node:fs";
import path from "node:path";
import { readJsonFile, resolveDataPath, writeJsonFileAtomic } from "../persistent-store";
import type { MatchDossier } from "./types";
import { MATCH_DOSSIER_SCHEMA_VERSION } from "./types";

const DOSSIER_DIR = "match-dossiers";

function dossierRoot(): string {
  return resolveDataPath(DOSSIER_DIR);
}

export function dossierFixtureKey(fixtureId: string): string {
  return fixtureId.replace(/[^a-zA-Z0-9:_-]+/g, "_");
}

export function latestDossierPath(fixtureId: string): string {
  return path.join(dossierRoot(), dossierFixtureKey(fixtureId), "latest.json");
}

export function writeMatchDossier(dossier: MatchDossier): void {
  if (dossier.schemaVersion !== MATCH_DOSSIER_SCHEMA_VERSION) {
    throw new Error(`Unsupported dossier schema ${dossier.schemaVersion}`);
  }
  writeJsonFileAtomic(latestDossierPath(dossier.fixture.fixtureId), dossier);
}

export function readMatchDossier(fixtureId: string): MatchDossier | null {
  const parsed = readJsonFile<MatchDossier>(latestDossierPath(fixtureId));
  if (!parsed || parsed.schemaVersion !== MATCH_DOSSIER_SCHEMA_VERSION) return null;
  if (parsed.fixture.fixtureId !== fixtureId) return null;
  return parsed;
}

export function listStoredDossierFixtureIds(): string[] {
  const root = dossierRoot();
  if (!fs.existsSync(root)) return [];
  const ids: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const latest = path.join(root, entry.name, "latest.json");
    if (fs.existsSync(latest)) ids.push(entry.name);
  }
  return ids.sort();
}

/** Decode stored directory name back to canonical fixture id (best effort). */
export function fixtureIdFromStorageDir(dirName: string): string {
  return dirName;
}
