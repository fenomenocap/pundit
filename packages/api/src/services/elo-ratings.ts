import { canonicalTeamName } from "../lib/team-names";

const WORLD_TSV_URL = "https://www.eloratings.net/World.tsv";
const TEAM_NAMES_TSV_URL = "https://www.eloratings.net/en.teams.tsv";

export function parseTsv(text: string): string[][] {
  return text.trim().split("\n").map((row) => row.trim()).filter(Boolean)
    .map((row) => row.split("\t"));
}

async function fetchTsv(url: string): Promise<string[][]> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pundit/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Elo ratings ${response.status} from ${url}`);
  return parseTsv(await response.text());
}

export function parseEloRatings(namesRows: string[][], worldRows: string[][]): Map<string, number> {
  const names = new Map<string, string>();
  for (const row of namesRows) {
    if (row.length >= 2 && !row[0].endsWith("_loc")) names.set(row[0], row[1]);
  }

  const ratings = new Map<string, number>();
  for (const row of worldRows) {
    if (row.length < 4) continue;
    const name = names.get(row[2]);
    const rating = Number.parseInt(row[3], 10);
    if (name && Number.isFinite(rating)) ratings.set(canonicalTeamName(name), rating);
  }
  if (ratings.size < 10) {
    throw new Error(`Only ${ratings.size} Elo ratings parsed; upstream TSV format may have changed.`);
  }
  return ratings;
}

export async function fetchEloRatings(): Promise<Map<string, number>> {
  const [names, world] = await Promise.all([
    fetchTsv(TEAM_NAMES_TSV_URL),
    fetchTsv(WORLD_TSV_URL),
  ]);
  return parseEloRatings(names, world);
}
