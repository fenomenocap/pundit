import { describe, expect, it } from "vitest";
import {
  buildClubStrengthArtifact,
  buildClubStrengthArtifactSelector,
  CLUB_STRENGTH_MAX_AGE_MS,
  CLUB_STRENGTH_MAX_AGE_DAYS,
  validateClubStrengthArtifact,
  readSelectedClubStrengthArtifact,
} from "./club-strength-artifact";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function validArtifact(snapshotAt = "2026-08-12T00:00:00.000Z") {
  const uefa = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`Club ${index}`, 1500 + index])
  );
  const england = Object.fromEntries(Object.entries(uefa).slice(0, 20));
  return buildClubStrengthArtifact({
    snapshotAt,
    byProfile: { world: {}, "eng-clubs": england, "uefa-clubs": uefa },
  });
}

describe("club strength artifact", () => {
  it("validates a content-addressed fresh artifact", () => {
    const validated = validateClubStrengthArtifact(
      validArtifact(),
      new Date("2026-08-13T00:00:00.000Z")
    );
    expect(validated.ageDays).toBe(1);
    expect(validated.artifact.artifactId).toBe(`clubelo@1:${validated.artifact.payloadSha256}`);
  });

  it("fails closed when payload content no longer matches the hash", () => {
    const artifact = validArtifact();
    artifact.payload.byProfile["uefa-clubs"]["Club 1"] = 1999;
    expect(() => validateClubStrengthArtifact(
      artifact,
      new Date("2026-08-13T00:00:00.000Z")
    )).toThrow("hash does not match");
  });

  it("uses exact elapsed time at the 30-day freshness boundary", () => {
    const snapshot = new Date("2026-08-12T00:00:00.000Z");
    const artifact = validArtifact(snapshot.toISOString());
    const boundary = snapshot.getTime() + CLUB_STRENGTH_MAX_AGE_MS;

    expect(validateClubStrengthArtifact(artifact, new Date(boundary - 1)).ageDays)
      .toBe(CLUB_STRENGTH_MAX_AGE_DAYS - 1);
    expect(validateClubStrengthArtifact(artifact, new Date(boundary)).ageDays)
      .toBe(CLUB_STRENGTH_MAX_AGE_DAYS);
    expect(() => validateClubStrengthArtifact(artifact, new Date(boundary + 1)))
      .toThrow("exceeds the exact 30-day freshness limit");
  });

  it("rejects implausibly incomplete coverage", () => {
    const artifact = validArtifact();
    artifact.payload.byProfile["uefa-clubs"] = {};
    const rebuilt = buildClubStrengthArtifact(artifact.payload);
    expect(() => validateClubStrengthArtifact(
      rebuilt,
      new Date("2026-08-13T00:00:00.000Z")
    )).toThrow("low coverage");
  });

  it("rejects finite but implausible rating values", () => {
    const artifact = validArtifact();
    artifact.payload.byProfile["uefa-clubs"]["Club 1"] = 30_000;
    const rebuilt = buildClubStrengthArtifact(artifact.payload);
    expect(() => validateClubStrengthArtifact(
      rebuilt,
      new Date("2026-08-13T00:00:00.000Z")
    )).toThrow("invalid row");
  });

  it("requires explicit source rights provenance", () => {
    const artifact = validArtifact();
    artifact.source.rightsStatus = "unknown" as never;
    expect(() => validateClubStrengthArtifact(
      artifact,
      new Date("2026-08-13T00:00:00.000Z")
    )).toThrow("source provenance is inconsistent");
  });

  it("rejects a manifest that does not describe its payload", () => {
    const artifact = validArtifact();
    artifact.manifest.profileCounts["uefa-clubs"] += 1;
    expect(() => validateClubStrengthArtifact(
      artifact,
      new Date("2026-08-13T00:00:00.000Z")
    )).toThrow("manifest is inconsistent");
  });

  it("rejects a selector whose target is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-selector-"));
    const artifact = validArtifact();
    fs.writeFileSync(
      path.join(dir, "production.json"),
      JSON.stringify(buildClubStrengthArtifactSelector(artifact))
    );
    expect(() => readSelectedClubStrengthArtifact(
      path.join(dir, "production.json"),
      new Date("2026-08-13T00:00:00Z")
    )).toThrow("Could not read");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects selector tampering", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-selector-"));
    const artifact = validArtifact();
    const selector = buildClubStrengthArtifactSelector(artifact);
    selector.artifactId = `clubelo@1:${"0".repeat(64)}`;
    fs.writeFileSync(path.join(dir, "production.json"), JSON.stringify(selector));
    expect(() => readSelectedClubStrengthArtifact(
      path.join(dir, "production.json"),
      new Date("2026-08-13T00:00:00Z")
    )).toThrow("selector is invalid");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
