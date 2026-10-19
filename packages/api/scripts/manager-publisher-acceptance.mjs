#!/usr/bin/env node
/**
 * Local acceptance: structural manager extraction for captured publisher fixtures.
 * Run: pnpm --filter @sports-predict/api manager-publisher:acceptance
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "data/manager-publisher-fixtures");
const now = Date.parse("2026-10-19T05:00:00Z");

const {
  describeManagerStructuralRoleMatch,
  extractManagerIdentityCandidates,
  sourceOwnedManagerDraft,
} = await import(path.join(root, "src/services/ask.ts"));

const clubs = new Map();
for (const name of readdirSync(fixtureDir).filter((f) => f.endsWith(".json"))) {
  const row = JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));
  if (!clubs.has(row.club)) clubs.set(row.club, row);
}

let failed = false;
for (const row of clubs.values()) {
  const source = {
    id: "S1",
    title: `${row.club} manager`,
    url: row.url,
    date: row.publishedDate,
    snippet: "",
    tier: "news",
  };
  const officialSite = row.url.includes("tottenhamhotspur.com");
  const page = {
    ...source,
    authority: officialSite ? "official" : "reputable",
    finalUrl: row.url,
    text: row.text,
    retrievedAt: row.publishedDate,
  };
  const bundle = { queries: [], providerCalls: 0, results: [source] };
  const match = describeManagerStructuralRoleMatch(row.club, row.expectedManager, row.text, { officialSite });
  const extraction = extractManagerIdentityCandidates({ club: row.club }, bundle, [page], now);
  const draft = sourceOwnedManagerDraft({ club: row.club, wantsReason: false }, bundle, [page], now);
  const ok = Boolean(match) && extraction.facts.some((f) => f.name === row.expectedManager) && draft?.includes(row.expectedManager);
  if (!ok) failed = true;
  console.log(JSON.stringify({
    club: row.club,
    manager: row.expectedManager,
    citation: row.url,
    matchedSentence: match ?? null,
    ok,
  }, null, 2));
}

if (failed) process.exitCode = 1;
