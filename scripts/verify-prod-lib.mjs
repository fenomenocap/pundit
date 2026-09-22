import {
  classifyServedShaWithRefresh,
  isAcceptableServedSha,
} from "./resolve-deployed-sha.mjs";

/**
 * Decide whether the API startup poll in verify-prod.sh can stop.
 *
 * Step 2 normally waits for /startup HTTP 200 plus an acceptable served SHA.
 * During Railway rollouts the edge can return 502 on the healthcheck path
 * while /version already serves the target commit and /health is live — that
 * is a proxy race, not a stale deploy.
 */
export function apiStartupPollPassed({
  startupHttp,
  healthHttp = null,
  servedSha,
  floorSha,
  cwd = process.cwd(),
}) {
  const shaState = floorSha
    ? classifyServedShaWithRefresh(floorSha, servedSha, { cwd })
    : "missing";
  const shaOk = isAcceptableServedSha(shaState);

  if (!shaOk) {
    return { pass: false, shaState, reason: "sha-not-ready", startupHttp, healthHttp };
  }

  if (startupHttp === "200") {
    return { pass: true, shaState, reason: "startup-ready", startupHttp, healthHttp };
  }

  if (startupHttp === "502" && healthHttp === "200") {
    return {
      pass: true,
      shaState,
      reason: "rollout-proxy-502",
      startupHttp,
      healthHttp,
    };
  }

  return { pass: false, shaState, reason: "waiting", startupHttp, healthHttp };
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function printJson(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1]?.endsWith("verify-prod-lib.mjs")) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "startup-poll") {
    console.error("usage: verify-prod-lib.mjs startup-poll --startup <code> [--health <code>] --served <sha> --floor <sha>");
    process.exit(2);
  }

  printJson(apiStartupPollPassed({
    startupHttp: flag(argv, "--startup") ?? "",
    healthHttp: flag(argv, "--health") ?? null,
    servedSha: flag(argv, "--served") ?? "",
    floorSha: flag(argv, "--floor") ?? "",
  }));
}
