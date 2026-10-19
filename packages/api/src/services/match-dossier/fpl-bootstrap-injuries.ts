import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModelFixture } from "../model-data";
import type { DossierEvidenceItem, FplPlayerAvailabilityStatus } from "./types";
import { matchDossierFplEnabled } from "./flags";

const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";

export interface FplBootstrapTeam {
  id: number;
  name: string;
  short_name: string;
}

export interface FplBootstrapElement {
  id: number;
  web_name: string;
  team: number;
  status: string;
  news: string;
  news_added: string | null;
  chance_of_playing_next_round: number | null;
}

export interface FplBootstrapSnapshot {
  teams: FplBootstrapTeam[];
  elements: FplBootstrapElement[];
}

let buildPassCache: { snapshot: FplBootstrapSnapshot; fetchedAt: string } | null = null;

const FIXTURE_TO_FPL_TEAM_NAMES: Record<string, string[]> = {
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

function fplTeamMatchesFixtureSide(team: FplBootstrapTeam, fixtureSide: string): boolean {
  const aliases = FIXTURE_TO_FPL_TEAM_NAMES[fixtureSide] ?? [fixtureSide];
  const norm = (s: string) => s.trim().toLocaleLowerCase();
  return aliases.some((a) => norm(a) === norm(team.name) || norm(a) === norm(team.short_name));
}

/** Resolve bootstrap team id → fixture home/away label when matched. */
export function clubLabelForFplTeam(
  fixture: ModelFixture,
  team: FplBootstrapTeam,
): string {
  if (fplTeamMatchesFixtureSide(team, fixture.home)) return fixture.home;
  if (fplTeamMatchesFixtureSide(team, fixture.away)) return fixture.away;
  return team.name;
}

export function fixtureFplTeamIds(snapshot: FplBootstrapSnapshot, fixture: ModelFixture): Set<number> {
  const ids = new Set<number>();
  for (const team of snapshot.teams) {
    if (fplTeamMatchesFixtureSide(team, fixture.home) || fplTeamMatchesFixtureSide(team, fixture.away)) {
      ids.add(team.id);
    }
  }
  return ids;
}

function normalizeFplStatus(raw: string, hasNews: boolean): FplPlayerAvailabilityStatus {
  const code = raw.trim().toLocaleLowerCase();
  if (code === "d" || code === "i" || code === "s" || code === "u" || code === "n") return code;
  if (hasNews) return "n";
  return "n";
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
  const teamIds = fixtureFplTeamIds(snapshot, fixture);
  if (!teamIds.size) return [];
  const items: DossierEvidenceItem[] = [];
  for (const player of snapshot.elements) {
    if (!teamIds.has(player.team)) continue;
    const newsText = player.news?.trim() ?? "";
    const hasNews = newsText.length > 0;
    if (player.status === "a" && !hasNews) continue;
    const team = snapshot.teams.find((t) => t.id === player.team);
    if (!team) continue;
    const club = clubLabelForFplTeam(fixture, team);
    const status = normalizeFplStatus(player.status, hasNews);
    const newsAddedAt = player.news_added ?? null;
    const chanceOfPlaying = player.chance_of_playing_next_round ?? null;
    items.push({
      id: evidenceIdForFpl(player.id, fixture),
      claim: `${player.web_name} (${club})`,
      sourceUrl: FPL_BOOTSTRAP_URL,
      publisher: "fantasy.premierleague.com",
      publishedAt: newsAddedAt ?? retrievedAt,
      retrievedAt,
      trustTier: "interim",
      verification: "cited",
      direction: "neutral",
      relatedFactor: "injuries",
      category: "injuries",
      origin: "scheduled",
      source: "fpl-bootstrap-static",
      tier: "interim",
      internalOnly: true,
      player: player.web_name,
      club,
      status,
      chanceOfPlaying,
      newsAddedAt,
      newsText: hasNews ? newsText : undefined,
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
