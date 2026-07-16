import { DEFAULT_ELO, eloToLambdas, simulateMatch } from "./dixon-coles";
import { WORLD_CUP_GROUPS, WORLD_CUP_TEAMS } from "./world-cup-teams";

export const MONTE_CARLO_RUNS = 100_000;

export interface GroupStandingState {
  pts: number;
  gd: number;
  gf: number;
  played: number;
}

export interface TournamentFixtureState {
  home: string;
  away: string;
  stage: string;
  result: { winner: string | null } | null;
}

export interface TournamentProbability {
  winProb: number;
  sfProb: number;
  qfProb: number;
}

const ROUND_ROBIN: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2],
];
const KNOCKOUT_STAGES = [
  "round_of_32", "round_of_16", "quarterfinals", "semifinals", "final",
] as const;

interface ThirdPlaceRecord extends GroupStandingState {
  team: string;
}

function rating(elo: Map<string, number>, team: string): number {
  return elo.get(team) ?? DEFAULT_ELO;
}

export function simulateGroup(
  teams: readonly string[],
  elo: Map<string, number>,
  current: Record<string, GroupStandingState> | undefined,
  random: () => number = Math.random
): [string, string, ThirdPlaceRecord] {
  const standings = new Map<string, GroupStandingState>();
  const completeCurrent = current && teams.every((team) => current[team]);
  const roundsPlayed = completeCurrent ? current[teams[0]].played : 0;
  for (const team of teams) {
    const state = completeCurrent ? current[team] : { pts: 0, gd: 0, gf: 0, played: 0 };
    standings.set(team, { ...state });
  }

  for (const [homeIndex, awayIndex] of ROUND_ROBIN.slice(roundsPlayed * 2)) {
    const home = teams[homeIndex];
    const away = teams[awayIndex];
    const [homeGoals, awayGoals] = simulateMatch(
      ...eloToLambdas(rating(elo, home), rating(elo, away)),
      false,
      random
    );
    const homeState = standings.get(home)!;
    const awayState = standings.get(away)!;
    homeState.gf += homeGoals;
    homeState.gd += homeGoals - awayGoals;
    awayState.gf += awayGoals;
    awayState.gd += awayGoals - homeGoals;
    if (homeGoals > awayGoals) homeState.pts += 3;
    else if (awayGoals > homeGoals) awayState.pts += 3;
    else {
      homeState.pts += 1;
      awayState.pts += 1;
    }
  }

  const ordered = [...teams].sort((a, b) => {
    const left = standings.get(a)!;
    const right = standings.get(b)!;
    return right.pts - left.pts || right.gd - left.gd || right.gf - left.gf;
  });
  const third = standings.get(ordered[2])!;
  return [ordered[0], ordered[1], { team: ordered[2], ...third }];
}

export function seedBracket(teams: string[], elo: Map<string, number>): string[] {
  const ranked = [...teams].sort((a, b) => rating(elo, b) - rating(elo, a));
  const bracket: string[] = [];
  for (let index = 0; index < ranked.length / 2; index += 1) {
    bracket.push(ranked[index], ranked[ranked.length - 1 - index]);
  }
  return bracket;
}

function playKnockout(
  home: string,
  away: string,
  elo: Map<string, number>,
  random: () => number
): string {
  const [homeGoals, awayGoals] = simulateMatch(
    ...eloToLambdas(rating(elo, home), rating(elo, away)),
    true,
    random
  );
  return homeGoals > awayGoals ? home : away;
}

export function realKnockoutState(fixtures: TournamentFixtureState[]) {
  const pairings = new Map<string, Array<[string, string]>>();
  const decided = new Map<string, string>();
  for (const fixture of fixtures) {
    if (!KNOCKOUT_STAGES.includes(fixture.stage as typeof KNOCKOUT_STAGES[number])) continue;
    const current = pairings.get(fixture.stage) ?? [];
    current.push([fixture.home, fixture.away]);
    pairings.set(fixture.stage, current);
    if (fixture.result?.winner) {
      decided.set([fixture.home, fixture.away].sort().join("::"), fixture.result.winner);
    }
  }
  return { pairings, decided };
}

export function simulateKnockout(
  field: string[],
  elo: Map<string, number>,
  realPairings = new Map<string, Array<[string, string]>>(),
  realDecided = new Map<string, string>(),
  random: () => number = Math.random
): { champion: string; semifinalists: string[]; quarterfinalists: string[] } {
  let current = [...field];
  const entering = new Map<string, string[]>();
  let seeded = false;

  for (const stage of KNOCKOUT_STAGES) {
    entering.set(stage, [...current]);
    const published = seeded ? undefined : realPairings.get(stage);
    const publishedTeams = published ? new Set(published.flat()) : null;
    let pairs: Array<[string, string]>;
    if (published && publishedTeams?.size === current.length
      && current.every((team) => publishedTeams.has(team))) {
      pairs = published;
    } else {
      if (!seeded) {
        current = seedBracket(current, elo);
        seeded = true;
      }
      pairs = Array.from({ length: current.length / 2 }, (_, index) =>
        [current[index * 2], current[index * 2 + 1]]
      );
    }

    current = pairs.map(([home, away]) =>
      realDecided.get([home, away].sort().join("::"))
      ?? playKnockout(home, away, elo, random)
    );
  }

  return {
    champion: current[0],
    semifinalists: entering.get("semifinals") ?? [],
    quarterfinalists: entering.get("quarterfinals") ?? [],
  };
}

export function runMonteCarlo(
  elo: Map<string, number>,
  standings: Record<string, Record<string, GroupStandingState>>,
  fixtures: TournamentFixtureState[],
  simulations = MONTE_CARLO_RUNS,
  random: () => number = Math.random
): Map<string, TournamentProbability> {
  const counts = new Map<string, { win: number; sf: number; qf: number }>(
    WORLD_CUP_TEAMS.map((team) => [team, { win: 0, sf: 0, qf: 0 }])
  );
  const { pairings, decided } = realKnockoutState(fixtures);

  for (let run = 0; run < simulations; run += 1) {
    const field: string[] = [];
    const thirds: ThirdPlaceRecord[] = [];
    for (const [group, teams] of Object.entries(WORLD_CUP_GROUPS)) {
      const [winner, runnerUp, third] = simulateGroup(
        teams,
        elo,
        standings[group],
        random
      );
      field.push(winner, runnerUp);
      thirds.push(third);
    }
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    field.push(...thirds.slice(0, 8).map((record) => record.team));

    const result = simulateKnockout(field, elo, pairings, decided, random);
    counts.get(result.champion)!.win += 1;
    for (const team of result.semifinalists) counts.get(team)!.sf += 1;
    for (const team of result.quarterfinalists) counts.get(team)!.qf += 1;
  }

  return new Map(WORLD_CUP_TEAMS.map((team) => {
    const count = counts.get(team)!;
    return [team, {
      winProb: count.win / simulations,
      sfProb: count.sf / simulations,
      qfProb: count.qf / simulations,
    }];
  }));
}
