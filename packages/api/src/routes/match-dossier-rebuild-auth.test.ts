import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import {
  CHAT_EVAL_JUDGE_OIDC_AUDIENCE,
  CHAT_EVAL_JUDGE_REPOSITORY,
  createGitHubActionsOidcVerifier,
  createLocalJwksFromRsaPublicJwk,
  GITHUB_ACTIONS_OIDC_ISSUER,
  setGitHubActionsOidcVerifierForTests,
} from "../services/eval-github-oidc";
import {
  getDossierSlateRebuildProgress,
  resetDossierSlateRebuildForTests,
  restoreSlateRebuildRunnerDepsForTests,
  setSlateRebuildRunnerDepsForTests,
} from "../services/match-dossier/dossier-slate-rebuild";
import {
  DOSSIER_SLATE_REBUILD_COOLDOWN_MS,
  resetDossierRebuildRateLimitsForTests,
  setLastSlateRebuildTriggeredAtForTests,
} from "../services/match-dossier/dossier-rebuild-rate-limit";
import * as builder from "../services/match-dossier/builder";

const DOSSIER_REBUILD_WORKFLOW_REF =
  `${CHAT_EVAL_JUDGE_REPOSITORY}/.github/workflows/dossier-rebuild.yml@refs/heads/main`;

async function getPath(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }> {
  const chunks: Buffer[] = [];
  const headerLines: string[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
  const httpSocket = socket as unknown as Socket;
  const request = new IncomingMessage(httpSocket);
  request.method = "GET";
  request.url = path;
  request.headers = { host: "localhost", ...headers };
  const response = new ServerResponse(request);
  response.assignSocket(httpSocket);
  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    app(request, response);
    request.emit("end");
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  const split = raw.indexOf("\r\n\r\n");
  const headerBlock = raw.slice(0, split);
  for (const line of headerBlock.split("\r\n").slice(1)) {
    headerLines.push(line);
  }
  const responseHeaders: Record<string, string | string[] | undefined> = {};
  for (const line of headerLines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    responseHeaders[key] = value;
  }
  const jsonStart = split + 4;
  let body: Record<string, unknown> = {};
  const jsonPart = raw.slice(jsonStart).trim();
  if (jsonPart) body = JSON.parse(jsonPart);
  return { status: response.statusCode ?? 0, body, headers: responseHeaders };
}

async function mintDossierRebuildOidcToken(privateKey: KeyLike): Promise<string> {
  return new SignJWT({
    repository: CHAT_EVAL_JUDGE_REPOSITORY,
    ref: "refs/heads/main",
    event_name: "workflow_dispatch",
    job_workflow_ref: DOSSIER_REBUILD_WORKFLOW_REF,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(GITHUB_ACTIONS_OIDC_ISSUER)
    .setAudience(CHAT_EVAL_JUDGE_OIDC_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

describe("match dossier rebuild auth", () => {
  let privateKey: KeyLike;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    savedEnv.MATCH_DOSSIER_ENABLED = process.env.MATCH_DOSSIER_ENABLED;
    process.env.MATCH_DOSSIER_ENABLED = "true";
    resetDossierSlateRebuildForTests();
    resetDossierRebuildRateLimitsForTests();
    restoreSlateRebuildRunnerDepsForTests();
    setSlateRebuildRunnerDepsForTests({
      listFixtures: () => [],
      buildFixture: async () => {},
      paceMs: 0,
      sleepFn: async () => {},
    });
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const publicJwk = await exportJWK(keys.publicKey);
    setGitHubActionsOidcVerifierForTests(
      createGitHubActionsOidcVerifier(createLocalJwksFromRsaPublicJwk(publicJwk)),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setGitHubActionsOidcVerifierForTests(null);
    restoreSlateRebuildRunnerDepsForTests();
    resetDossierRebuildRateLimitsForTests();
    if (savedEnv.MATCH_DOSSIER_ENABLED === undefined) delete process.env.MATCH_DOSSIER_ENABLED;
    else process.env.MATCH_DOSSIER_ENABLED = savedEnv.MATCH_DOSSIER_ENABLED;
  });

  it("returns 401 on slate rebuild without OIDC and does not start a build", async () => {
    const result = await getPath("/api/match-dossier/status?rebuild=true");
    expect(result.status).toBe(401);
    expect(getDossierSlateRebuildProgress().state).toBe("idle");
  });

  it("accepts valid OIDC on slate rebuild and starts async rebuild", async () => {
    const token = await mintDossierRebuildOidcToken(privateKey);
    const result = await getPath("/api/match-dossier/status?rebuild=true", {
      authorization: `Bearer ${token}`,
    });
    expect(result.status).toBe(202);
    expect(getDossierSlateRebuildProgress().state).toBe("completed");
  });

  it("returns 429 with retryAfter when slate rebuild is inside cooldown", async () => {
    setLastSlateRebuildTriggeredAtForTests(Date.now() - 60_000);
    const token = await mintDossierRebuildOidcToken(privateKey);
    const result = await getPath("/api/match-dossier/status?rebuild=true", {
      authorization: `Bearer ${token}`,
    });
    expect(result.status).toBe(429);
    expect(result.body.retryAfter).toBeTypeOf("number");
    expect(result.body.retryAfter as number).toBeGreaterThan(0);
    expect(result.body.retryAfter as number).toBeLessThanOrEqual(
      Math.ceil(DOSSIER_SLATE_REBUILD_COOLDOWN_MS / 1000),
    );
    expect(result.headers["retry-after"]).toBe(String(result.body.retryAfter));
  });

  it("plain GET /status stays public without rebuild side effects", async () => {
    const result = await getPath("/api/match-dossier/status");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ storedCount: expect.any(Number) });
    expect(getDossierSlateRebuildProgress().state).toBe("idle");
  });

  it("returns 401 on fixture rebuild without OIDC", async () => {
    const buildSpy = vi.spyOn(builder, "buildMatchDossierForFixtureAsync");
    const result = await getPath("/api/match-dossier/espn:eng.1:401?rebuild=true");
    expect(result.status).toBe(401);
    expect(buildSpy).not.toHaveBeenCalled();
  });
});
