#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retrieveEvidencePages } from "../dist/services/evidence-page-retrieval.js";
import { publisherOwnedManagerBody } from "../dist/services/ask.js";

const fixtures = [
  {
    club: "Tottenham",
    manager: "Roberto De Zerbi",
    url: "https://www.football.london/tottenham-hotspur-fc/news/tottenham-press-conference-live-de-34780662",
    date: "2026-10-18T07:30:00Z",
  },
  {
    club: "Tottenham",
    manager: "Roberto De Zerbi",
    url: "https://www.tottenhamhotspur.com/news/1177234/de-zerbi-on-purpose-of-spain-training-camp",
    date: "2026-10-12T12:00:00Z",
    officialAdjacent: true,
  },
  {
    club: "Everton",
    manager: "David Moyes",
    url: "https://www.skysports.com/football/news/13596920/david-moyes-everton-manager-admits-surprise-at-seeing-the-club-being-put-up-for-sale-by-the-friedkin-group",
    date: "2026-10-09T18:13:00Z",
  },
  {
    club: "Newcastle",
    manager: "Eddie Howe",
    url: "https://www.bbc.com/sport/football/articles/clyqn158n5jo",
    date: "2026-08-29T12:00:00Z",
  },
  {
    club: "Nottingham Forest",
    manager: "Oliver Glasner",
    url: "https://www.bbc.com/sport/football/articles/cmqxn291eq5ro",
    date: "2026-10-16T12:00:00Z",
  },
  {
    club: "Crystal Palace",
    manager: "Pierre Sage",
    url: "https://www.bbc.com/sport/football/articles/cm93zq75nzd7o",
    date: "2026-10-09T12:00:00Z",
  },
  {
    club: "Coventry City",
    manager: "Frank Lampard",
    url: "https://www.bbc.com/sport/football/articles/cmly023yx7xko",
    date: "2026-10-08T12:00:00Z",
  },
];

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/manager-publisher-fixtures");
mkdirSync(outDir, { recursive: true });

const now = Date.parse("2026-10-19T05:00:00Z");

for (const row of fixtures) {
  const id = "S1";
  const pages = await retrieveEvidencePages([{
    id,
    url: row.url,
    title: `${row.club} manager fixture`,
    date: row.date,
    authority: row.url.includes("tottenhamhotspur.com") ? "official" : "reputable",
  }]);
  const page = pages[0];
  const body = publisherOwnedManagerBody(page);
  const slug = row.url.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
  const payload = {
    club: row.club,
    expectedManager: row.manager,
    url: row.url,
    publishedDate: page.date || row.date,
    capturedAt: new Date().toISOString(),
    text: body,
  };
  writeFileSync(path.join(outDir, `${slug}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(row.club, body.slice(0, 120).replace(/\s+/g, " "));
}
