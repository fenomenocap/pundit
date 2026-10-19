import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_PATH = path.join(ROOT, "evals/chat/fixtures/monitor-gate-pinned.json");

function composePinnedUserLinePassPlayAnswer() {
  return execSync(
    "pnpm --filter @sports-predict/api exec tsx ../../scripts/recapture-monitor-user-line-turn.ts --print-only",
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
}

test("monitor user-line turn 2 matches composer recapture output", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const scenario = fixture.scenarios.find((row) => row.id === "user-line-pass-play");
  assert.ok(scenario?.turns[1]);
  assert.equal(scenario.turns[1].answer, composePinnedUserLinePassPlayAnswer());
});
