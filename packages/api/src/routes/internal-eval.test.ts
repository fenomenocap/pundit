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

const VALID_WORKFLOW_REF =
  `${CHAT_EVAL_JUDGE_REPOSITORY}/.github/workflows/chat-eval-daily.yml@refs/heads/main`;

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  const chunks: Buffer[] = [];
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
  request.method = "POST";
  request.url = path;
  request.headers = {
    host: "localhost",
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
    ...headers,
  };
  const response = new ServerResponse(request);
  response.assignSocket(httpSocket);
  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    app(request, response);
    request.emit("data", payload);
    request.emit("end");
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  const jsonStart = raw.indexOf("\r\n\r\n") + 4;
  return {
    status: response.statusCode ?? 0,
    body: JSON.parse(raw.slice(jsonStart)),
  };
}

async function mintValidOidcToken(privateKey: KeyLike): Promise<string> {
  return new SignJWT({
    repository: CHAT_EVAL_JUDGE_REPOSITORY,
    ref: "refs/heads/main",
    event_name: "schedule",
    job_workflow_ref: VALID_WORKFLOW_REF,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(GITHUB_ACTIONS_OIDC_ISSUER)
    .setAudience(CHAT_EVAL_JUDGE_OIDC_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

const ENV_KEYS = ["OPENROUTER_API_KEY"] as const;

describe("POST /internal/eval/judge", () => {
  const saved: Record<string, string | undefined> = {};
  let privateKey: KeyLike;

  beforeEach(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const publicJwk = await exportJWK(keys.publicKey);
    setGitHubActionsOidcVerifierForTests(
      createGitHubActionsOidcVerifier(createLocalJwksFromRsaPublicJwk(publicJwk)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setGitHubActionsOidcVerifierForTests(null);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("returns 503 judge_unavailable when OpenRouter is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const token = await mintValidOidcToken(privateKey);
    const result = await postJson("/internal/eval/judge", {
      turns: [{ question: "Q?", answer: "A." }],
    }, { authorization: `Bearer ${token}` });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("judge_unavailable");
  });

  it("returns 401 when OIDC bearer is missing or invalid", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    const missing = await postJson("/internal/eval/judge", {
      turns: [{ question: "Q?", answer: "A." }],
    });
    expect(missing.status).toBe(401);
    const wrong = await postJson("/internal/eval/judge", {
      turns: [{ question: "Q?", answer: "A." }],
    }, { authorization: "Bearer not-a-jwt" });
    expect(wrong.status).toBe(401);
  });

  it("returns 403 when OIDC claims fail daily workflow policy", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    const token = await new SignJWT({
      repository: "other/repo",
      ref: "refs/heads/main",
      workflow_ref: VALID_WORKFLOW_REF,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(GITHUB_ACTIONS_OIDC_ISSUER)
      .setAudience(CHAT_EVAL_JUDGE_OIDC_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const result = await postJson("/internal/eval/judge", {
      turns: [{ question: "Q?", answer: "A." }],
    }, { authorization: `Bearer ${token}` });
    expect(result.status).toBe(403);
  });

  it("accepts valid OIDC and returns judge payload shape", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            personaStrength: 0.8,
            clearCall: 0.7,
            specificity: 0.75,
            variety: 0.6,
            citationCorrectness: 0.9,
            overall: 0.74,
            note: "ok",
          }),
        },
      }],
    }), { status: 200 })));
    const token = await mintValidOidcToken(privateKey);
    const result = await postJson("/internal/eval/judge", {
      turns: [{ question: "Who wins?", answer: "Lean Chelsea." }],
      maxTurns: 1,
      paceMs: 0,
    }, { authorization: `Bearer ${token}` });
    expect(result.status).toBe(200);
    expect(result.body.scoredTurns).toBe(1);
    expect(result.body.averages).toMatchObject({ overall: 0.74 });
    const fetchMock = vi.mocked(fetch);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer openrouter-test-key");
    expect(String(init?.body)).toContain("deliveredAnswer");
    expect(String(init?.body)).not.toContain("openrouter-test-key");
  });
});
