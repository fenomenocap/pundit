import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { shouldBuildWeb } from "./deploy-build-paths.mjs";
import { runHistoryFetch } from "./fetch-history.mjs";

const helper = path.resolve("scripts/resolve-deployed-sha.sh");
const curlBoundsHelper = path.resolve("scripts/curl-bounds.sh");
const historyFetcher = path.resolve("scripts/fetch-history.mjs");
const verifyLocalScript = path.resolve("scripts/verify-local.sh");
const verifyProdScript = path.resolve("scripts/verify-prod.sh");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(cwd, relative, content) {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function withTempDirectory(prefix, run) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return run(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function fakeCommand(cwd, name, source) {
  const bin = path.join(cwd, "fake-bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(cwd, `fake-${name}.mjs`);
  fs.writeFileSync(script, source);
  const variable = `PUNDIT_FAKE_${name.toUpperCase()}_SCRIPT`;
  const launcher = path.join(bin, name);
  fs.writeFileSync(
    launcher,
    `#!/usr/bin/env bash\nexec node "$${variable}" "$@"\n`,
  );
  fs.chmodSync(launcher, 0o755);
  return { bin, variable, script };
}

function withFakePath(env, bin) {
  return {
    ...env,
    PATH: [bin, env.PATH].filter(Boolean).join(path.delimiter),
    // Git Bash's Windows launcher prepends its bundled tools to PATH. Reapply
    // the fake directory inside the shell so its curl cannot shadow our stub.
    PUNDIT_FAKE_COMMAND_BIN: process.platform === "win32"
      ? `/${bin[0].toLowerCase()}${bin.slice(2).replaceAll("\\", "/")}`
      : bin,
  };
}

function writeShellCommand(bin, name, body = "exit 0") {
  fs.mkdirSync(bin, { recursive: true });
  const launcher = path.join(bin, name);
  fs.writeFileSync(launcher, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(launcher, 0o755);
  return launcher;
}

function initRepo(cwd) {
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  write(cwd, "package.json", "{}");
  write(cwd, "scripts/vercel-ignore-build.mjs", "export {};");
}

function withRepo(run) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-deployed-sha-"));
  try {
    run(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function seedRepo(cwd) {
  initRepo(cwd);
  write(cwd, "packages/api/src.ts", "api-0");
  write(cwd, "packages/web/page.tsx", "web-0");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "seed");
  return git(cwd, "rev-parse", "HEAD");
}

function commitFiles(cwd, message, files) {
  for (const [relative, content] of Object.entries(files)) write(cwd, relative, content);
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function resolve(cwd, target) {
  return execFileSync("bash", [helper, target], { cwd, encoding: "utf8" }).trim();
}

function compare(cwd, floor, served) {
  return execFileSync(
    "bash",
    [helper, "compare", "--floor", floor, "--served", served],
    { cwd, encoding: "utf8" }
  ).trim();
}

test("docs-only commits retain the latest deployed API and web path SHAs", () => {
  withRepo((cwd) => {
    initRepo(cwd);
    write(cwd, "packages/api/src.ts", "api-1");
    write(cwd, "packages/web/page.tsx", "web-1");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "deploy inputs");
    const deployed = git(cwd, "rev-parse", "HEAD");
    write(cwd, "docs/readme.md", "docs only");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "docs only");
    assert.notEqual(git(cwd, "rev-parse", "HEAD"), deployed);
    assert.equal(resolve(cwd, "api"), deployed);
    assert.equal(resolve(cwd, "web"), deployed);
  });
});

test("merge commits on main resolve to the platform merge SHA, not the PR tip", () => {
  withRepo((cwd) => {
    initRepo(cwd);
    write(cwd, "packages/api/src.ts", "api-base");
    write(cwd, "packages/web/page.tsx", "web-base");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "base deploy inputs");
    git(cwd, "checkout", "-q", "-b", "feature/api-change");
    write(cwd, "packages/api/src.ts", "api-2");
    git(cwd, "add", "packages/api/src.ts");
    git(cwd, "commit", "-qm", "api change on branch");
    const branchTip = git(cwd, "rev-parse", "HEAD");
    git(cwd, "checkout", "-q", "main");
    git(cwd, "merge", "--no-ff", "-qm", "Merge pull request #1 from feature/api-change", "feature/api-change");
    const mergeSha = git(cwd, "rev-parse", "HEAD");
    assert.notEqual(branchTip, mergeSha);
    assert.equal(resolve(cwd, "api"), mergeSha);
    assert.equal(resolve(cwd, "web"), git(cwd, "rev-parse", "HEAD~1"));
  });
});

test("unrelated merge commits that do not advance deploy paths keep the prior SHA", () => {
  withRepo((cwd) => {
    initRepo(cwd);
    write(cwd, "packages/api/src.ts", "api-base");
    write(cwd, "packages/web/page.tsx", "web-base");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "deploy inputs");
    const deployed = git(cwd, "rev-parse", "HEAD");
    git(cwd, "checkout", "-q", "-b", "feature/docs-only");
    write(cwd, "docs/readme.md", "docs on branch");
    git(cwd, "add", "docs/readme.md");
    git(cwd, "commit", "-qm", "docs on branch");
    git(cwd, "checkout", "-q", "main");
    git(cwd, "merge", "--no-ff", "-qm", "Merge pull request #2 from feature/docs-only", "feature/docs-only");
    assert.notEqual(git(cwd, "rev-parse", "HEAD"), deployed);
    assert.equal(resolve(cwd, "api"), deployed);
    assert.equal(resolve(cwd, "web"), deployed);
  });
});

// --- The shape that broke Verify Production -------------------------------
//
// A web-touching commit lands, then a long run of API-only commits. Vercel
// skips the web build for each of those, so the frontend keeps serving an
// older commit than main's tip -- correctly. But Vercel also fails open to a
// build whenever the commit range is unusable, so it can equally end up
// serving one of those *later* API-only commits. Both are healthy. Only
// serving something older than the last commit that had to rebuild the web is
// a fault, and that is what the resolved SHA is a floor for.

test("a run of API-only commits leaves the web floor on the last web commit", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const webCommit = commitFiles(cwd, "web change", {
      "packages/web/page.tsx": "web-1",
      "packages/api/src.ts": "api-1",
    });
    let lastApi = webCommit;
    for (let index = 0; index < 6; index += 1) {
      lastApi = commitFiles(cwd, `api only ${index}`, {
        "packages/api/src.ts": `api-only-${index}`,
        "evals/chat/scenarios.json": `[${index}]`,
      });
    }
    assert.equal(resolve(cwd, "web"), webCommit);
    assert.equal(resolve(cwd, "api"), lastApi);
  });
});

test("a web-touching commit becomes the web floor immediately", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const apiCommit = commitFiles(cwd, "api only", { "packages/api/src.ts": "api-1" });
    const webCommit = commitFiles(cwd, "web only", { "packages/web/page.tsx": "web-1" });
    assert.equal(resolve(cwd, "web"), webCommit);
    // A web-only commit does not move the API floor.
    assert.equal(resolve(cwd, "api"), apiCommit);
  });
});

test("a mixed commit is the floor for both targets", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const mixed = commitFiles(cwd, "api and web", {
      "packages/api/src.ts": "api-2",
      "packages/web/page.tsx": "web-2",
    });
    commitFiles(cwd, "docs only", { "docs/readme.md": "docs" });
    assert.equal(resolve(cwd, "web"), mixed);
    assert.equal(resolve(cwd, "api"), mixed);
  });
});

test("root-level toolchain changes rebuild both targets", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const lockfile = commitFiles(cwd, "bump lockfile", { "pnpm-lock.yaml": "lockfileVersion: 9" });
    assert.equal(resolve(cwd, "web"), lockfile);
    assert.equal(resolve(cwd, "api"), lockfile);
  });
});

test("changing the shared build-path rule rebuilds the web", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const ruleChange = commitFiles(cwd, "edit the rule", {
      "scripts/deploy-build-paths.mjs": "export const WEB_BUILD_PATHS = [];",
    });
    assert.equal(resolve(cwd, "web"), ruleChange);
  });
});

test("a later skipped commit served by the frontend is ahead, not stale", () => {
  withRepo((cwd) => {
    const seed = seedRepo(cwd);
    const webCommit = commitFiles(cwd, "web change", { "packages/web/page.tsx": "web-1" });
    const apiCommits = [];
    for (let index = 0; index < 11; index += 1) {
      apiCommits.push(commitFiles(cwd, `api only ${index}`, {
        "packages/api/src.ts": `api-only-${index}`,
      }));
    }
    const floor = resolve(cwd, "web");
    assert.equal(floor, webCommit);

    // Exactly the production symptom: Vercel built an API-only commit that the
    // diff rule alone would have skipped, so the served SHA is newer than the
    // floor. That must pass.
    assert.equal(compare(cwd, floor, apiCommits.at(-1)), "ahead");
    assert.equal(compare(cwd, floor, floor), "match");
    assert.equal(compare(cwd, floor, floor.slice(0, 7)), "match");

    // The failures the check exists for.
    assert.equal(compare(cwd, floor, seed), "stale");
    assert.equal(compare(cwd, floor, ""), "missing");
    assert.equal(compare(cwd, floor, "unknown"), "missing");
    assert.equal(compare(cwd, floor, "0".repeat(40)), "unknown");
  });
});

test("the resolver agrees with the Vercel ignore-build rule commit for commit", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    commitFiles(cwd, "web change", { "packages/web/page.tsx": "web-1" });
    commitFiles(cwd, "api only", { "packages/api/src.ts": "api-1" });
    commitFiles(cwd, "docs only", { "docs/readme.md": "docs" });

    // Independently replay the ignore rule over first-parent history: the
    // newest commit it would have built must be the resolver's answer.
    const history = git(cwd, "log", "main", "--first-parent", "--format=%H").split("\n");
    let expected = null;
    for (const sha of history) {
      const changed = git(cwd, "show", "--name-only", "--format=", sha)
        .split("\n").map((line) => line.trim()).filter(Boolean);
      if (shouldBuildWeb(changed)) {
        expected = sha;
        break;
      }
    }
    assert.equal(resolve(cwd, "web"), expected);
  });
});

test("local verification applies bounded curl flags to every request", () => {
  withTempDirectory("pundit-verify-local-", (cwd) => {
    const log = path.join(cwd, "curl-calls.json");
    const command = fakeCommand(cwd, "curl", `
      import fs from "node:fs";

      const args = process.argv.slice(2);
      const log = process.env.PUNDIT_FAKE_CURL_LOG;
      const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, "utf8")) : [];
      calls.push(args);
      fs.writeFileSync(log, JSON.stringify(calls));

      const url = args.at(-1) || "";
      if (args.includes("-w")) process.stdout.write("200");
      else if (url.endsWith("/health")) process.stdout.write('{"status":"ok"}');
      else if (url.endsWith("/api/matches/competitions")) process.stdout.write('{"competitions":["eng.1"]}');
      else if (url.endsWith("/api/matches/active")) process.stdout.write('{"fixtures":[]}');
      else if (url.endsWith("/api/model/active")) process.stdout.write('{"fixtures":[]}');
      else if (url.endsWith("/api/evaluation/wc-2026")) process.stdout.write('{"competition":"fifa.world"}');
    `);
    const result = spawnSync("bash", [
      "-c", 'export PATH="$PUNDIT_FAKE_COMMAND_BIN:$PATH"; source "$1"',
      "bash", verifyLocalScript,
    ], {
      cwd,
      encoding: "utf8",
      env: withFakePath({
        ...process.env,
        API_URL: "http://localhost:3001",
        VERIFY_CURL_CONNECT_TIMEOUT_SECONDS: "2",
        VERIFY_CURL_TOTAL_TIMEOUT_SECONDS: "5",
        PUNDIT_FAKE_CURL_LOG: log,
        [command.variable]: command.script,
      }, command.bin),
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const calls = JSON.parse(fs.readFileSync(log, "utf8"));
    assert.equal(calls.length, 6);
    for (const args of calls) {
      assert.deepEqual(
        args.slice(0, 4),
        ["--connect-timeout", "2", "--max-time", "5"],
      );
    }
  });
});

test("curl bounds reject invalid, inverted, and oversized values before a request", () => {
  withTempDirectory("pundit-curl-bounds-", (cwd) => {
    const log = path.join(cwd, "curl-calls.log");
    const command = fakeCommand(cwd, "curl", `
      import fs from "node:fs";
      fs.writeFileSync(process.env.PUNDIT_FAKE_CURL_LOG, "called");
    `);
    const cases = [
      { connect: "0", total: "5" },
      { connect: "9", total: "8" },
      { connect: "31", total: "31" },
      { connect: "999999999999999999999999", total: "20" },
    ];

    for (const values of cases) {
      const result = spawnSync(
        "bash",
        [
          "-c",
          'set -euo pipefail; export PATH="$PUNDIT_FAKE_COMMAND_BIN:$PATH"; source "$1"; curl_bounded "$2"',
          "bash",
          curlBoundsHelper,
          "http://localhost:3001/health",
        ],
        {
          cwd,
          encoding: "utf8",
          env: withFakePath({
            ...process.env,
            VERIFY_CURL_CONNECT_TIMEOUT_SECONDS: values.connect,
            VERIFY_CURL_TOTAL_TIMEOUT_SECONDS: values.total,
            PUNDIT_FAKE_CURL_LOG: log,
            [command.variable]: command.script,
          }, command.bin),
        },
      );
      assert.notEqual(result.status, 0, `${values.connect}/${values.total} unexpectedly passed`);
      assert.equal(fs.existsSync(log), false);
    }
  });
});

test("production polling rejects settings that skip version checks before any request", () => {
  withTempDirectory("pundit-poll-bounds-", (cwd) => {
    const log = path.join(cwd, "curl-calls.log");
    const command = fakeCommand(cwd, "curl", `
      import fs from "node:fs";
      fs.appendFileSync(process.env.PUNDIT_FAKE_CURL_LOG, "called\\n");
      process.exitCode = 90;
    `);
    writeShellCommand(command.bin, "python3");
    const cases = [
      ...["0", "-1", "1.5", "abc", "121", "999999999999999999999999", "08"]
        .map((value) => ({ name: "VERIFY_PROD_POLL_ATTEMPTS", value })),
      ...["0", "-1", "0.5", "abc", "61", "999999999999999999999999"]
        .map((value) => ({ name: "VERIFY_PROD_POLL_INTERVAL_SECONDS", value })),
    ];
    for (const { name, value } of cases) {
      const result = spawnSync("bash", [
        "-c", 'export PATH="$PUNDIT_FAKE_COMMAND_BIN:$PATH"; exec bash "$1" "$2" "$2" shadow',
        "bash", verifyProdScript, "a".repeat(40),
      ], {
        cwd,
        encoding: "utf8",
        timeout: 5000,
        env: withFakePath({
          ...process.env,
          VERIFY_PROD_POLL_ATTEMPTS: "1",
          VERIFY_PROD_POLL_INTERVAL_SECONDS: "1",
          [name]: value,
          PUNDIT_FAKE_CURL_LOG: log,
          [command.variable]: command.script,
        }, command.bin),
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 2, `${name}=${value}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, new RegExp(name));
      assert.equal(fs.existsSync(log), false, `${name}=${value} reached curl`);
      assert.doesNotMatch(result.stdout, /PASS: production verification OK/);
    }
  });
});

test("production verification rejects a missing runtime before any request", () => {
  withTempDirectory("pundit-verify-prerequisites-", (cwd) => {
    const runtimes = ["node", "git", "curl", "python3"];
    for (const missing of runtimes) {
      const bin = path.join(cwd, `runtime-bin-${missing}`);
      const marker = path.join(cwd, `curl-${missing}-called`);
      for (const runtime of runtimes) {
        if (runtime !== missing) writeShellCommand(bin, runtime);
      }
      if (missing !== "curl") {
        writeShellCommand(bin, "curl", 'printf "called" > "$PUNDIT_RUNTIME_MARKER"; exit 90');
      }

      const result = spawnSync(
        "bash",
        [
          "-c",
          'export PATH="$PUNDIT_FAKE_COMMAND_BIN"; source "$1" "$2" "$3" "$4"',
          "bash",
          verifyProdScript,
          "a".repeat(40),
          "a".repeat(40),
          "shadow",
        ],
        {
          cwd,
          encoding: "utf8",
          timeout: 5000,
          env: withFakePath({
            ...process.env,
            PUNDIT_RUNTIME_MARKER: marker,
            VERIFY_PROD_POLL_ATTEMPTS: "1",
            VERIFY_PROD_POLL_INTERVAL_SECONDS: "1",
          }, bin),
        },
      );

      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 2, `${missing}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, new RegExp(`required command '${missing}' is unavailable`));
      assert.equal(fs.existsSync(marker), false, `${missing} reached curl`);
    }
  });
});

test("valid production polling settings still enter mandatory version checks", () => {
  withTempDirectory("pundit-poll-valid-", (cwd) => {
    const log = path.join(cwd, "curl-calls.json");
    const command = fakeCommand(cwd, "curl", `
      import fs from "node:fs";
      const log = process.env.PUNDIT_FAKE_CURL_LOG;
      const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, "utf8")) : [];
      calls.push(process.argv.slice(2).at(-1));
      fs.writeFileSync(log, JSON.stringify(calls));
      process.exitCode = 90;
    `);
    writeShellCommand(command.bin, "python3");
    // End after the first failed attempt without a real delay or a live request.
    const sleep = fakeCommand(cwd, "sleep", "process.exitCode = 91;\n");
    for (const overrides of [
      {},
      { VERIFY_PROD_POLL_ATTEMPTS: "1", VERIFY_PROD_POLL_INTERVAL_SECONDS: "1" },
      { VERIFY_PROD_POLL_ATTEMPTS: "120", VERIFY_PROD_POLL_INTERVAL_SECONDS: "60" },
    ]) {
      fs.writeFileSync(log, "[]");
      const env = { ...process.env };
      delete env.VERIFY_PROD_POLL_ATTEMPTS;
      delete env.VERIFY_PROD_POLL_INTERVAL_SECONDS;
      const result = spawnSync("bash", [
        "-c", 'export PATH="$PUNDIT_FAKE_COMMAND_BIN:$PATH"; exec bash "$1" "$2" "$2" shadow',
        "bash", verifyProdScript, "a".repeat(40),
      ], {
        cwd,
        encoding: "utf8",
        timeout: 5000,
        env: withFakePath({
          ...env, ...overrides,
          PUNDIT_FAKE_CURL_LOG: log,
          [command.variable]: command.script,
          [sleep.variable]: sleep.script,
        }, command.bin),
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, overrides.VERIFY_PROD_POLL_ATTEMPTS === "1" ? 1 : 91);
      assert.match(result.stdout, /Poll API startup\/version/);
      assert.deepEqual(JSON.parse(fs.readFileSync(log, "utf8")), [
        "https://thepundit.up.railway.app/startup",
        "https://thepundit.up.railway.app/version",
      ]);
      assert.doesNotMatch(result.stdout, /PASS: production verification OK/);
    }
  });
});

test("history refresh suppresses prompts and returns when the child exceeds its bound", () => {
  withTempDirectory("pundit-history-fetch-", (cwd) => {
    const log = path.join(cwd, "git-invocation.json");
    const fixture = path.join(cwd, "history-fetch-fixture.mjs");
    fs.writeFileSync(fixture, `
      import fs from "node:fs";

      if (process.env.PUNDIT_FAKE_GIT_MODE === "hang") {
        setTimeout(() => {}, 5000);
      } else {
        fs.writeFileSync(process.env.PUNDIT_FAKE_GIT_LOG, JSON.stringify({
          args: process.argv.slice(2),
          terminalPrompt: process.env.GIT_TERMINAL_PROMPT,
          credentialInteractive: process.argv.includes("credential.interactive=false"),
        }));
      }
    `);
    const baseEnv = {
      ...process.env,
      PUNDIT_FAKE_GIT_LOG: log,
      PUNDIT_FAKE_GIT_MODE: "success",
    };
    const invalid = spawnSync(
      process.execPath,
      [historyFetcher, "--timeout-seconds", "61"],
      { cwd, encoding: "utf8", env: baseEnv },
    );
    assert.equal(invalid.error, undefined, invalid.error?.message);
    assert.equal(invalid.status, 2);

    const success = runHistoryFetch({
      cwd,
      timeoutSeconds: "1",
      env: baseEnv,
      command: process.execPath,
      commandPrefixArgs: [fixture],
    });
    assert.equal(success.ok, true);
    const invocation = JSON.parse(fs.readFileSync(log, "utf8"));
    assert.deepEqual(invocation.args, [
      "-c",
      "credential.interactive=false",
      "fetch",
      "--quiet",
      "origin",
      "main",
    ]);
    assert.equal(invocation.terminalPrompt, "0");
    assert.equal(invocation.credentialInteractive, true);

    const started = Date.now();
    const timedOut = runHistoryFetch({
      cwd,
      timeoutSeconds: "1",
      env: { ...baseEnv, PUNDIT_FAKE_GIT_MODE: "hang" },
      command: process.execPath,
      commandPrefixArgs: [fixture],
    });
    const elapsed = Date.now() - started;
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.timedOut, true);
    assert.ok(elapsed < 4000, `history refresh took ${elapsed}ms`);
  });
});
