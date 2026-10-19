import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  actionsOidcMintEnvPresent,
  mintGitHubActionsOidcToken,
  resolveRemoteJudgeBearerToken,
  remoteJudgeConfiguredSync,
} from "./chat-eval-github-oidc.mjs";

let savedFetch;

afterEach(() => {
  globalThis.fetch = savedFetch;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN;
});

test("actionsOidcMintEnvPresent requires both Actions mint env vars", () => {
  assert.equal(actionsOidcMintEnvPresent(), false);
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://example.test/oidc";
  assert.equal(actionsOidcMintEnvPresent(), false);
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "req-token";
  assert.equal(actionsOidcMintEnvPresent(), true);
});

test("mintGitHubActionsOidcToken requests audience pundit-judge", async () => {
  savedFetch = globalThis.fetch;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://example.test/oidc?foo=1";
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "req-token";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://example.test/oidc?foo=1&audience=pundit-judge");
    assert.equal(init.headers.Authorization, "bearer req-token");
    return new Response(JSON.stringify({ value: "fresh-jwt" }), { status: 200 });
  };
  assert.equal(await mintGitHubActionsOidcToken(), "fresh-jwt");
});

test("resolveRemoteJudgeBearerToken prefers fresh mint over fallback env", async () => {
  savedFetch = globalThis.fetch;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://example.test/oidc";
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "req-token";
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "stale-fallback";
  globalThis.fetch = async () => new Response(JSON.stringify({ value: "fresh-jwt" }), { status: 200 });
  assert.equal(await resolveRemoteJudgeBearerToken(), "fresh-jwt");
  assert.equal(remoteJudgeConfiguredSync(), true);
});

test("resolveRemoteJudgeBearerToken uses fallback when mint env is absent", async () => {
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "fallback-only";
  assert.equal(await resolveRemoteJudgeBearerToken(), "fallback-only");
});
