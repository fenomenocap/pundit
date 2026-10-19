import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import {
  publisherOwnedManagerBodyForTests,
  sourceOwnedManagerDraft,
} from "./ask";
import { retrieveEvidencePages } from "./evidence-page-retrieval";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/manager-publisher-fixtures");

const SOURCES = [
  {
    file: "tottenham-football-london-presser.json",
    club: "Tottenham",
    manager: "Roberto De Zerbi",
    url: "https://www.football.london/tottenham-hotspur-fc/news/tottenham-press-conference-live-de-34780662",
    date: "2026-10-18T07:30:00Z",
  },
  {
    file: "tottenham-official-training-camp.json",
    club: "Tottenham",
    manager: "Roberto De Zerbi",
    url: "https://www.tottenhamhotspur.com/news/1177234/de-zerbi-on-purpose-of-spain-training-camp",
    date: "2026-10-12T12:00:00Z",
  },
  {
    file: "everton-skysports-sale.json",
    club: "Everton",
    manager: "David Moyes",
    url: "https://www.skysports.com/football/news/13596920/david-moyes-everton-manager-admits-surprise-at-seeing-the-club-being-put-up-for-sale-by-the-friedkin-group",
    date: "2026-10-09T18:13:00Z",
  },
  {
    file: "newcastle-bbc-jaissle.json",
    club: "Newcastle",
    manager: "Matthias Jaissle",
    url: "https://www.bbc.com/sport/football/articles/c5n49gv1pnm0o",
    date: "2026-10-15T15:49:22Z",
  },
  {
    file: "forest-bbc-glasner.json",
    club: "Nottingham Forest",
    manager: "Oliver Glasner",
    url: "https://www.bbc.com/sport/football/articles/cmqxn291eq5ro",
    date: "2026-10-16T12:00:00Z",
  },
  {
    file: "palace-bbc-sage.json",
    club: "Crystal Palace",
    manager: "Pierre Sage",
    url: "https://www.bbc.com/sport/football/articles/cm93zq75nzd7o",
    date: "2026-10-09T12:00:00Z",
  },
  {
    file: "coventry-bbc-lampard.json",
    club: "Coventry City",
    manager: "Frank Lampard",
    url: "https://www.bbc.com/sport/football/articles/cmly023yx7xko",
    date: "2026-10-08T12:00:00Z",
  },
] as const;

const now = Date.parse("2026-10-19T05:00:00Z");

describe("capture manager publisher fixtures", () => {
  it("fetches live publisher bodies into fixtures", async () => {
    mkdirSync(outDir, { recursive: true });
    for (const row of SOURCES) {
      const source = {
        id: "S1",
        title: `${row.club} manager`,
        url: row.url,
        date: row.date,
        snippet: "",
        tier: "news" as const,
      };
      const pages = await retrieveEvidencePages([{
        id: source.id,
        url: source.url,
        title: source.title,
        date: source.date,
        authority: row.url.includes("tottenhamhotspur.com") ? "official" as const : "reputable" as const,
      }]);
      const page = pages[0];
      const text = publisherOwnedManagerBodyForTests(page);
      const bundle = { queries: [], providerCalls: 0, results: [source] };
      const hydrated = [{ ...page, text, finalUrl: page.finalUrl || row.url }];
      const draft = sourceOwnedManagerDraft({ club: row.club, wantsReason: false }, bundle, hydrated, now);
      writeFileSync(path.join(outDir, row.file), `${JSON.stringify({
        club: row.club,
        expectedManager: row.manager,
        url: row.url,
        publishedDate: page.date || row.date,
        capturedAt: new Date().toISOString(),
        text,
      }, null, 2)}\n`);
      if (!draft?.toLocaleLowerCase().includes(row.manager.split(" ").pop()!.toLocaleLowerCase())) {
        throw new Error(`Failed to extract ${row.manager} for ${row.club}: ${draft ?? "no draft"}`);
      }
    }
  }, 120_000);
});
