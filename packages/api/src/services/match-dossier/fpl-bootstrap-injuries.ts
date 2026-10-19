import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModelFixture } from "../model-data";
import type { DossierEvidenceItem } from "./types";
import { matchDossierFplEnabled } from "./flags";

const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";

interface FplBootstrapTeam {
  id: number;
  name: string;
  short_name: string;
}

interface FplBootstrapElement {
  id: number;
  web_name: string;
  team: number;
  status: string;
  news: string;
  news_added: string | null;
  chance_of_playing_next_round: number | null;
}

interface FplBootstrapSnapshot {
  teams: FplBootstrapTeam[];
  elements: FplBootstrapElement[];
}

let buildPassCache: { snapshot: FplBootstrapSnapshot; fetchedAt: string } | null = null;

const CLUB_TO_FPL: Record<string, string[]> = {
  Arsenal: ["Arsenal"],
  "Aston Villa": ["Aston Villa"],
  Bournemouth: ["Bournemouth", "AFC Bournemouth"],
  Brentford: ["Brentford"],
  Brighton: ["Brighton", "Brighton and Hove Albion"],
  Chelsea: ["Chelsea"],
  "Crystal Palace": ["Crystal Palace"],
  Everton: ["Everton"],
  Fulham: ["Fulham"],
  Ipswich: ["Ipswich"],
  Leeds: ["Leeds"],
  Liverpool: ["Liverpool"],
  "Man City": ["Man City", "Manchester City"],
  "Man United": ["Man Utd", "Manchester United"],
  Newcastle: ["Newcastle"],
  Forest: ["Nott'm Forest", "Nottingham Forest"],
  Sunderland: ["Sunderland"],
  Tottenham: ["Spurs", "Tottenham"],
  "West Ham": ["West Ham"],
  Wolves: ["Wolves"],
};

function fixtureTeamIds(snapshot: FplBootstrapSnapshot, fixture: ModelFixture): Set<number> {
  const ids = new Set<number>();
  for (const side of [fixture.home, fixture.away]) {
    const names = CLUB_TO_FPL[side] ?? [side];
    for (const team of snapshot.teams) {
      if (names.some((n) => n.toLocaleLowerCase() === team.name.toLocaleLowerCase()
        || n.toLocaleLowerCase() === team.short_name.toLocaleLowerCase())) {
        ids.add(team.id);
      }
    }
  }
  return ids;
}

function evidenceIdForFpl(playerId: number, fixture: ModelFixture): string {
  return createHash("sha256").update(`fpl:${playerId}:${fixture.fixtureId}`).digest("hex").slice(0, 16);
}

export function resetFplBootstrapCacheForTests(): void {
  buildPassCache = null;
}

export function loadFplBootstrapFromRecordedFixture(): FplBootstrapSnapshot {
  const file = path.join(__dirname, "__fixtures__", "fpl-bootstrap-static-sample.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as FplBootstrapSnapshot;
}

export async function prefetchFplBootstrapForBuildPass(
  fetchFn: typeof fetch = fetch,
): Promise<FplBootstrapSnapshot | null> {
  if (!matchDossierFplEnabled()) return null;
  if (buildPassCache) return buildPassCache.snapshot;
  const response = await fetchFn(FPL_BOOTSTRAP_URL, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; pundit/1.0)" },
  });
  if (!response.ok) return null;
  const snapshot = await response.json() as FplBootstrapSnapshot;
  buildPassCache = { snapshot, fetchedAt: new Date().toISOString() };
  return snapshot;
}

export function setFplBootstrapCacheForTests(snapshot: FplBootstrapSnapshot, fetchedAt = new Date().toISOString()): void {
  buildPassCache = { snapshot, fetchedAt };
}

export function buildFplInjuryEvidenceForFixture(
  fixture: ModelFixture,
  retrievedAt: string,
  snapshot: FplBootstrapSnapshot,
): DossierEvidenceItem[] {
  if (fixture.competitionId !== "eng.1") return [];
  const teamIds = fixtureTeamIds(snapshot, fixture);
  if (!teamIds.size) return [];
  const items: DossierEvidenceItem[] = [];
  for (const player of snapshot.elements) {
    if (!teamIds.has(player.team)) continue;
    const hasNews = Boolean(player.news?.trim());
    if (player.status === "a" && !hasNews) continue;
    const team = snapshot.teams.find((t) => t.id === player.team);
    const chance = player.chance_of_playing_next_round;
    const chanceNote = chance != null && chance < 100 ? ` (${chance}% chance next round)` : "";
    const claim = `${player.web_name} (${team?.name ?? "club"}): ${hasNews ? player.news.trim() : `status ${player.status}`}${chanceNote}`;
    const publishedAt = player.news_added ?? retrievedAt;
    items.push({
      id: evidenceIdForFpl(player.id, fixture),
      claim: claim.slice(0, 480),
      sourceUrl: FPL_BOOTSTRAP_URL,
      publisher: "fantasy.premierleague.com",
      publishedAt,
      retrievedAt,
      trustTier: "interim",
      verification: "cited",
      direction: "neutral",
      relatedFactor: "injuries",
      category: "injuries",
      origin: "scheduled",
      source: "fpl-bootstrap-static",
      internalOnly: true,
    });
  }
  return items;
}

export function fplInjuryEvidenceForFixtureIfCached(
  fixture: ModelFixture,
  retrievedAt: string,
): DossierEvidenceItem[] {
  if (!matchDossierFplEnabled() || !buildPassCache) return [];
  return buildFplInjuryEvidenceForFixture(fixture, retrievedAt, buildPassCache.snapshot);
}
