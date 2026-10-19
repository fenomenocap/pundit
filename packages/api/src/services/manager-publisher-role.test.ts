import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeManagerStructuralRoleMatch,
  extractManagerIdentityCandidates,
  sourceOwnedManagerDraft,
} from "./ask";

const fixtureDir = path.resolve(__dirname, "../../data/manager-publisher-fixtures");
const now = Date.parse("2026-10-19T05:00:00Z");

type Fixture = {
  club: string;
  expectedManager: string;
  url: string;
  publishedDate: string;
  text: string;
};

const fixtures = readdirSync(fixtureDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Fixture);

describe("manager publisher normalization", () => {
  it("extracts identity when hydrated HTML uses NBSP and curly apostrophes", () => {
    const text = "Tottenham\u00a0Hotspur head coach Roberto\u00a0De\u00a0Zerbi is holding his press conference ahead of Coventry.";
    const source = {
      id: "S1",
      title: "Presser",
      url: "https://www.football.london/tottenham-hotspur-fc/news/live",
      date: "2026-10-18T10:18:54Z",
      snippet: "",
      tier: "news" as const,
    };
    const page = {
      ...source,
      authority: "reputable" as const,
      finalUrl: source.url,
      text,
      retrievedAt: source.date,
    };
    const bundle = { queries: [], providerCalls: 0, results: [source] };
    const extraction = extractManagerIdentityCandidates({ club: "Tottenham" }, bundle, [page], now);
    expect(extraction.facts.map((fact) => fact.name)).toContain("Roberto De Zerbi");
  });
});

describe("manager publisher fixtures (Oct 2026 live text)", () => {
  it.each(fixtures.map((row) => [row.club, row.expectedManager, row.url, row]))(
    "%s names %s from %s",
    (_club, expectedManager, _url, row) => {
      const source = {
        id: "S1",
        title: `${row.club} manager`,
        url: row.url,
        date: row.publishedDate,
        snippet: "",
        tier: "news" as const,
      };
      const page = {
        ...source,
        authority: row.url.includes("tottenhamhotspur.com") ? "official" as const : "reputable" as const,
        finalUrl: row.url,
        text: row.text,
        retrievedAt: row.publishedDate,
      };
      const bundle = { queries: [], providerCalls: 0, results: [source] };
      const match = describeManagerStructuralRoleMatch(row.club, expectedManager, row.text, {
        officialSite: page.authority === "official",
      });
      expect(match, `no structural match in fixture ${row.url}`).toBeTruthy();
      const extraction = extractManagerIdentityCandidates({ club: row.club }, bundle, [page], now);
      expect(extraction.facts.map((fact) => fact.name)).toContain(expectedManager);
      const draft = sourceOwnedManagerDraft({ club: row.club, wantsReason: false }, bundle, [page], now);
      expect(draft).toContain(expectedManager);
    },
  );
});
