import { canonicalClubName } from "../lib/team-names";

/** Offline capture helpers. Runtime model code must not contact ClubElo. */

export interface ClubEloCaptureRow {
  club: string;
  country: string;
  elo: number;
}

/** Current Premier League clubs on ClubElo (2025-26). */
export const EPL_CLUB_PAGE_SLUGS: Array<{ slug: string; name: string }> = [
  { slug: "Arsenal", name: "Arsenal" },
  { slug: "ManCity", name: "Man City" },
  { slug: "Liverpool", name: "Liverpool" },
  { slug: "Brighton", name: "Brighton" },
  { slug: "AstonVilla", name: "Aston Villa" },
  { slug: "Chelsea", name: "Chelsea" },
  { slug: "ManUnited", name: "Man United" },
  { slug: "Newcastle", name: "Newcastle" },
  { slug: "Brentford", name: "Brentford" },
  { slug: "Bournemouth", name: "Bournemouth" },
  { slug: "CrystalPalace", name: "Crystal Palace" },
  { slug: "Everton", name: "Everton" },
  { slug: "Leeds", name: "Leeds" },
  { slug: "Tottenham", name: "Tottenham" },
  { slug: "Forest", name: "Forest" },
  { slug: "Fulham", name: "Fulham" },
  { slug: "WestHam", name: "West Ham" },
  { slug: "Sunderland", name: "Sunderland" },
  { slug: "Wolves", name: "Wolves" },
  { slug: "Burnley", name: "Burnley" },
];

function slugToClubEloName(slug: string): string {
  if (slug.includes("-") && slug === slug.toLowerCase()) return slug;
  return slug.replace(/(?<=[a-z])(?=[A-Z])/g, " ");
}

export function parseClubEloCsv(text: string): ClubEloCaptureRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length <= 1) return [];
  const rows: ClubEloCaptureRow[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const club = parts[1]?.trim();
    const country = parts[2]?.trim();
    const elo = Number.parseFloat(parts[4]);
    if (!club || !country || !Number.isFinite(elo)) continue;
    rows.push({ club, country, elo });
  }
  return rows;
}

export function parseClubEloRankingHtml(html: string): ClubEloCaptureRow[] {
  const vegaByName = new Map<string, number>();
  const objectPattern = /\{\s*"Colour"[\s\S]*?"Name":\s*"((?:\\.|[^"\\])*)"[\s\S]*?\}/g;
  for (const match of html.matchAll(objectPattern)) {
    const blob = match[0];
    const nameMatch = blob.match(/"Name":\s*"((?:\\.|[^"\\])*)"/);
    const eloMatch = blob.match(/"Elo":\s*([0-9.]+)/);
    if (!nameMatch || !eloMatch) continue;
    const name = JSON.parse(`"${nameMatch[1]}"`) as string;
    vegaByName.set(name, Number.parseFloat(eloMatch[1]));
  }

  const rows: ClubEloCaptureRow[] = [];
  const seen = new Set<string>();
  for (const fragment of html.split("<tr")) {
    const flagMatch = fragment.match(/<img alt="([A-Z]{3})"/);
    const clubMatch = fragment.match(
      /href="\/([^"]+)"><span class="NonAst">[^<]*<\/span><span class="Ast">([^<]+)<\/span><\/a><\/td><td class="r">(\d+)<\/td>/
    );
    if (!flagMatch || !clubMatch) continue;
    const country = flagMatch[1];
    const slug = clubMatch[1];
    const astName = clubMatch[2]
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .trim();
    const integerElo = Number.parseInt(clubMatch[3], 10);
    const club = canonicalClubName(slugToClubEloName(slug)) || astName;
    const precise = vegaByName.get(club)
      ?? vegaByName.get(astName)
      ?? vegaByName.get(slugToClubEloName(slug));
    const elo = precise ?? integerElo;
    if (!club || !Number.isFinite(elo) || seen.has(`${country}:${club}`)) continue;
    seen.add(`${country}:${club}`);
    rows.push({ club, country, elo });
  }
  return rows;
}

export function parseClubEloClubPageHtml(html: string): {
  club: string | null;
  elo: number | null;
  rankingDate: string | null;
} {
  const eloMatch = html.match(/Elo:\s*<b>(\d+(?:\.\d+)?)<\/b>/i);
  const titleMatch = html.match(/<h1><a href="\/\d{4}-\d{2}-\d{2}\/([^"]+)">([^<]+)<\/a><\/h1>/i)
    ?? html.match(/<h1><a href="\/([^"/]+)">([^<]+)<\/a><\/h1>/i);
  const dateMatch = html.match(/href="\/(\d{4}-\d{2}-\d{2})\/[^"]+"/);
  return {
    club: titleMatch?.[2]?.trim() ?? null,
    elo: eloMatch ? Number.parseFloat(eloMatch[1]!) : null,
    rankingDate: dateMatch?.[1] ?? null,
  };
}

export function rankingDateFromClubEloRankingHtml(html: string): string | null {
  const match = html.match(/href="\/(\d{4}-\d{2}-\d{2})\/(?:Ranking)?"/);
  return match?.[1] ?? null;
}
