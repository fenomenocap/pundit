import fs from "node:fs";
import path from "node:path";
import type { FootballMatch } from "../../football-data";

/** ESPN finished eng.1 rows before GW8 kickoff (recorded 2026-10-21). */
export function loadGw8SlateFormSchedule(): FootballMatch[] {
  const file = path.join(
    __dirname,
    "../__fixtures__/espn-eng1-form-schedule-gw8-recorded.json",
  );
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { fixtures: FootballMatch[] };
  return parsed.fixtures;
}
