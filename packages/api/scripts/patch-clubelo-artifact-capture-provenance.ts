import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalClubName } from "../src/lib/team-names";
import type { ClubStrengthArtifact, ClubStrengthCaptureRecord } from "../src/services/club-strength-artifact";
import {
  clubStrengthPayloadSha256,
  validateClubStrengthArtifact,
} from "../src/services/club-strength-artifact";
import {
  EPL_CLUB_PAGE_SLUGS,
  parseClubEloClubPageHtml,
  rankingDateFromClubEloRankingHtml,
} from "../src/services/clubelo-capture-parsers";

const CLUBELO_SITE = "https://clubelo.com";
const USER_AGENT = "Mozilla/5.0 (compatible; pundit-release-capture/1.0)";

function pageSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

async function captureRankingPage(): Promise<{ record: ClubStrengthCaptureRecord; rankingDate: string | null }> {
  const url = `${CLUBELO_SITE}/Ranking`;
  const fetchedAt = new Date().toISOString();
  const response = await fetchText(url);
  if (!response.ok) {
    throw new Error(`ClubElo ranking page ${response.status} for ${url}`);
  }
  return {
    record: {
      url,
      fetchedAt,
      method: "clubelo-ranking-html",
      pageSha256: pageSha256(response.text),
      httpStatus: response.status,
    },
    rankingDate: rankingDateFromClubEloRankingHtml(response.text),
  };
}

async function captureClubPages(
  engClubs: Record<string, number>,
): Promise<{ clubPages: ClubStrengthCaptureRecord[]; maxGap: number }> {
  const clubPages: ClubStrengthCaptureRecord[] = [];
  let maxGap = 0;
  for (let index = 0; index < EPL_CLUB_PAGE_SLUGS.length; index += 1) {
    const entry = EPL_CLUB_PAGE_SLUGS[index]!;
    if (index > 0) await sleep(1000);
    const url = `${CLUBELO_SITE}/${entry.slug}`;
    const fetchedAt = new Date().toISOString();
    const response = await fetchText(url);
    if (!response.ok) {
      throw new Error(`ClubElo club page ${response.status} for ${url}`);
    }
    const parsed = parseClubEloClubPageHtml(response.text);
    if (parsed.elo == null || !Number.isFinite(parsed.elo)) {
      throw new Error(`ClubElo club page missing Elo for ${url}`);
    }
    const name = canonicalClubName(entry.name);
    const payloadElo = engClubs[name];
    if (payloadElo != null) {
      maxGap = Math.max(maxGap, Math.abs(Math.round(parsed.elo) - payloadElo));
    }
    clubPages.push({
      url,
      fetchedAt,
      method: "clubelo-club-page-html",
      pageSha256: pageSha256(response.text),
      httpStatus: response.status,
    });
  }
  return { clubPages, maxGap };
}

async function main(): Promise<void> {
  const artifactPath = process.argv[2];
  if (!artifactPath) {
    throw new Error("Usage: patch-clubelo-artifact-capture-provenance.ts <artifact.json>");
  }
  const resolved = path.resolve(artifactPath);
  const beforeSha = createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
  const artifact = JSON.parse(fs.readFileSync(resolved, "utf8")) as ClubStrengthArtifact;
  const payloadShaBefore = clubStrengthPayloadSha256(artifact.payload);
  if (artifact.payloadSha256 !== payloadShaBefore) {
    throw new Error("Artifact payloadSha256 does not match payload before patch.");
  }

  const { record: rankingPage, rankingDate } = await captureRankingPage();
  await sleep(1000);
  const { clubPages, maxGap } = await captureClubPages(artifact.payload.byProfile["eng-clubs"]);
  artifact.source.capture = {
    rankingPage,
    clubPages,
    note:
      `Shipped eng-clubs values are the ClubElo published ranking page integers (ranking date ${rankingDate ?? "unknown"}). `
      + `Twenty 2026-27 Premier League club pages were re-fetched live with 1s spacing; each record carries its own fetchedAt, httpStatus, and pageSha256. `
      + `Cross-check vs those club pages: max absolute gap ${maxGap} Elo (within 1 Elo: ${maxGap <= 1 ? "yes" : "no"}).`,
  };

  const payloadShaAfter = clubStrengthPayloadSha256(artifact.payload);
  if (payloadShaAfter !== payloadShaBefore) {
    throw new Error("Payload hash changed during provenance-only patch.");
  }
  validateClubStrengthArtifact(artifact, new Date("2026-10-20T12:00:00.000Z"));

  const tempPath = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, resolved);

  console.log(JSON.stringify({
    artifactPath: resolved,
    payloadSha256: artifact.payloadSha256,
    payloadShaUnchanged: payloadShaAfter === payloadShaBefore,
    fileSha256Before: beforeSha,
    fileSha256After: createHash("sha256").update(fs.readFileSync(resolved)).digest("hex"),
    clubPages: clubPages.length,
    maxEplCrossCheckGap: maxGap,
    rankingDate,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
