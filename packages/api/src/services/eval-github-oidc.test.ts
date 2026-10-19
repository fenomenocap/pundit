import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_EVAL_JUDGE_OIDC_AUDIENCE,
  CHAT_EVAL_JUDGE_OIDC_CLOCK_TOLERANCE_SEC,
  CHAT_EVAL_JUDGE_REPOSITORY,
  createGitHubActionsOidcVerifier,
  createLocalJwksFromRsaPublicJwk,
  GITHUB_ACTIONS_OIDC_ISSUER,
  refAuthorizesDailyEval,
  setGitHubActionsOidcVerifierForTests,
  validateChatEvalDailyOidcClaims,
  workflowRefAuthorizesDailyEval,
} from "./eval-github-oidc";

const VALID_WORKFLOW_REF =
  `${CHAT_EVAL_JUDGE_REPOSITORY}/.github/workflows/chat-eval-daily.yml@refs/heads/main`;

import type { KeyLike } from "jose";

async function signTestOidcToken(
  privateKey: KeyLike,
  claims: Record<string, unknown>,
  expiresInSec = 3600,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(GITHUB_ACTIONS_OIDC_ISSUER)
    .setAudience(CHAT_EVAL_JUDGE_OIDC_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSec}s`)
    .sign(privateKey);
}

describe("chat eval GitHub OIDC claims", () => {
  it("accepts the daily workflow on main", () => {
    const claims = {
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/main",
      event_name: "schedule",
      workflow_ref: VALID_WORKFLOW_REF,
    };
    expect(workflowRefAuthorizesDailyEval(claims)).toBe(true);
    expect(refAuthorizesDailyEval(claims)).toBe(true);
    expect(validateChatEvalDailyOidcClaims(claims)).toBeNull();
  });

  it("rejects wrong repository, workflow, audience, and expiry", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const verify = createGitHubActionsOidcVerifier(createLocalJwksFromRsaPublicJwk(publicJwk));

    expect(validateChatEvalDailyOidcClaims({
      repository: "other/repo",
      ref: "refs/heads/main",
      workflow_ref: VALID_WORKFLOW_REF,
    })).toBe("repository_mismatch");

    expect(validateChatEvalDailyOidcClaims({
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/main",
      workflow_ref: "other/repo/.github/workflows/other.yml@refs/heads/main",
    })).toBe("workflow_mismatch");

    expect(refAuthorizesDailyEval({
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/feature",
      event_name: "workflow_dispatch",
    })).toBe(false);

    const badAud = await new SignJWT({
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/main",
      workflow_ref: VALID_WORKFLOW_REF,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(GITHUB_ACTIONS_OIDC_ISSUER)
      .setAudience("wrong-audience")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    await expect(verify(badAud)).rejects.toThrow();

    const expired = await new SignJWT({
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/main",
      workflow_ref: VALID_WORKFLOW_REF,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(GITHUB_ACTIONS_OIDC_ISSUER)
      .setAudience(CHAT_EVAL_JUDGE_OIDC_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`-${CHAT_EVAL_JUDGE_OIDC_CLOCK_TOLERANCE_SEC + 120}s`)
      .sign(privateKey);
    await expect(verify(expired)).rejects.toThrow();
  });

  it("accepts job_workflow_ref when workflow_ref is absent", () => {
    expect(workflowRefAuthorizesDailyEval({
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/main",
      job_workflow_ref: VALID_WORKFLOW_REF,
    })).toBe(true);
  });

  it(`allows ${CHAT_EVAL_JUDGE_OIDC_CLOCK_TOLERANCE_SEC}s clock skew on nbf/iat`, async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const verify = createGitHubActionsOidcVerifier(createLocalJwksFromRsaPublicJwk(publicJwk));
    const skewSec = Math.min(30, CHAT_EVAL_JUDGE_OIDC_CLOCK_TOLERANCE_SEC - 5);
    const token = await new SignJWT({
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/main",
      event_name: "schedule",
      workflow_ref: VALID_WORKFLOW_REF,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(GITHUB_ACTIONS_OIDC_ISSUER)
      .setAudience(CHAT_EVAL_JUDGE_OIDC_AUDIENCE)
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000) + skewSec)
      .setExpirationTime("10m")
      .sign(privateKey);
    const claims = await verify(token);
    expect(claims.repository).toBe(CHAT_EVAL_JUDGE_REPOSITORY);
  });

  it("verifies a locally signed JWT against a local JWKS", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const verify = createGitHubActionsOidcVerifier(createLocalJwksFromRsaPublicJwk(publicJwk));
    const token = await signTestOidcToken(privateKey, {
      repository: CHAT_EVAL_JUDGE_REPOSITORY,
      ref: "refs/heads/main",
      event_name: "schedule",
      job_workflow_ref: VALID_WORKFLOW_REF,
    });
    const claims = await verify(token);
    expect(claims.repository).toBe(CHAT_EVAL_JUDGE_REPOSITORY);
    expect(validateChatEvalDailyOidcClaims(claims)).toBeNull();
  });
});

afterEach(() => {
  setGitHubActionsOidcVerifierForTests(null);
});
