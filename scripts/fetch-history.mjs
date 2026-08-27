#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 60;

function timeoutMilliseconds(value) {
  const text = String(value ?? "");
  if (!/^[0-9]+$/.test(text)) {
    throw new Error("history fetch timeout must be a positive integer number of seconds");
  }
  const normalized = text.replace(/^0+/, "");
  if (!normalized) {
    throw new Error("history fetch timeout must be greater than zero");
  }
  const seconds = Number(normalized);
  if (!Number.isSafeInteger(seconds) || seconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`history fetch timeout must be no greater than ${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return seconds * 1000;
}

export function runHistoryFetch({
  cwd = process.cwd(),
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  env = process.env,
  command = "git",
  commandPrefixArgs = [],
} = {}) {
  const result = spawnSync(
    command,
    [
      ...commandPrefixArgs,
      "-c",
      "credential.interactive=false",
      "fetch",
      "--quiet",
      "origin",
      "main",
    ],
    {
      cwd,
      env: {
        ...env,
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: "ignore",
      timeout: timeoutMilliseconds(timeoutSeconds),
      killSignal: "SIGKILL",
      windowsHide: true,
    },
  );

  return {
    ok: result.status === 0 && !result.error,
    timedOut: result.error?.code === "ETIMEDOUT" || result.signal === "SIGKILL",
    status: result.status,
    errorCode: result.error?.code,
  };
}

function usage() {
  console.error("usage: fetch-history.mjs [--timeout-seconds <positive integer <= 60>]");
  process.exit(2);
}

function main(argv) {
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  if (argv.length === 0) {
    // Keep the default for direct use by the verification script.
  } else if (argv.length === 2 && argv[0] === "--timeout-seconds") {
    timeoutSeconds = argv[1];
  } else {
    usage();
  }

  try {
    const result = runHistoryFetch({ timeoutSeconds });
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
