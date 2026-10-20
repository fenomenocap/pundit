import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWK,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";

export const GITHUB_ACTIONS_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const CHAT_EVAL_JUDGE_OIDC_AUDIENCE = "pundit-judge";
export const CHAT_EVAL_JUDGE_REPOSITORY = "fenomenocap/pundit";
export const CHAT_EVAL_DAILY_WORKFLOW_SUFFIX = ".github/workflows/chat-eval-daily.yml";
export const DOSSIER_REBUILD_WORKFLOW_SUFFIX = ".github/workflows/dossier-rebuild.yml";

/** Small skew allowance for GitHub Actions runner ↔ Railway clock drift and nbf/iat. */
export const CHAT_EVAL_JUDGE_OIDC_CLOCK_TOLERANCE_SEC = 60;

const ALLOWED_EVENT_NAMES = new Set(["schedule", "workflow_dispatch", "repository_dispatch"]);

export type GitHubActionsOidcClaims = {
  repository?: string;
  ref?: string;
  event_name?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
};

let productionJwks: JWTVerifyGetKey | null = null;

function getProductionJwks(): JWTVerifyGetKey {
  if (!productionJwks) {
    productionJwks = createRemoteJWKSet(
      new URL(`${GITHUB_ACTIONS_OIDC_ISSUER}/.well-known/jwks`),
    );
  }
  return productionJwks;
}

export function workflowRefAuthorizesDailyEval(claims: GitHubActionsOidcClaims): boolean {
  const refs = [claims.job_workflow_ref, claims.workflow_ref].filter(Boolean) as string[];
  return refs.some((ref) =>
    ref.includes(CHAT_EVAL_DAILY_WORKFLOW_SUFFIX)
    && ref.includes(`${CHAT_EVAL_JUDGE_REPOSITORY}/`));
}

export function refAuthorizesDailyEval(claims: GitHubActionsOidcClaims): boolean {
  if (claims.ref === "refs/heads/main") return true;
  return ALLOWED_EVENT_NAMES.has(String(claims.event_name ?? ""))
    && claims.ref === "refs/heads/main";
}

export function workflowRefAuthorizesDossierRebuild(claims: GitHubActionsOidcClaims): boolean {
  const refs = [claims.job_workflow_ref, claims.workflow_ref].filter(Boolean) as string[];
  return refs.some((ref) =>
    ref.includes(DOSSIER_REBUILD_WORKFLOW_SUFFIX)
    && ref.includes(`${CHAT_EVAL_JUDGE_REPOSITORY}/`));
}

export function validateChatEvalDailyOidcClaims(claims: GitHubActionsOidcClaims): string | null {
  if (claims.repository !== CHAT_EVAL_JUDGE_REPOSITORY) {
    return "repository_mismatch";
  }
  if (!workflowRefAuthorizesDailyEval(claims)) {
    return "workflow_mismatch";
  }
  if (!refAuthorizesDailyEval(claims)) {
    return "ref_not_main";
  }
  return null;
}

export function validateDossierRebuildOidcClaims(claims: GitHubActionsOidcClaims): string | null {
  if (claims.repository !== CHAT_EVAL_JUDGE_REPOSITORY) {
    return "repository_mismatch";
  }
  if (!workflowRefAuthorizesDossierRebuild(claims)) {
    return "workflow_mismatch";
  }
  if (!refAuthorizesDailyEval(claims)) {
    return "ref_not_main";
  }
  return null;
}

export type OidcVerifier = (token: string) => Promise<GitHubActionsOidcClaims>;

export function createGitHubActionsOidcVerifier(jwks?: JWTVerifyGetKey): OidcVerifier {
  const keySet = jwks ?? getProductionJwks();
  return async (token: string) => {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: GITHUB_ACTIONS_OIDC_ISSUER,
      audience: CHAT_EVAL_JUDGE_OIDC_AUDIENCE,
      clockTolerance: CHAT_EVAL_JUDGE_OIDC_CLOCK_TOLERANCE_SEC,
    });
    return payload as GitHubActionsOidcClaims;
  };
}

let defaultVerifier: OidcVerifier | null = null;

export function getGitHubActionsOidcVerifier(): OidcVerifier {
  if (!defaultVerifier) defaultVerifier = createGitHubActionsOidcVerifier();
  return defaultVerifier;
}

/** Vitest-only: inject a local JWKS verifier or reset to production. */
export function setGitHubActionsOidcVerifierForTests(verifier: OidcVerifier | null): void {
  defaultVerifier = verifier;
}

/** Test-only: verify with a local JWKS instead of GitHub production keys. */
export function createLocalJwksFromRsaPublicJwk(publicJwk: JWK): JWTVerifyGetKey {
  return createLocalJWKSet({ keys: [publicJwk] });
}

export type OidcClaimsValidator = (claims: GitHubActionsOidcClaims) => string | null;

export async function authorizeChatEvalGithubOidcBearer(
  bearer: string | null | undefined,
  verify: OidcVerifier = getGitHubActionsOidcVerifier(),
  validateClaims: OidcClaimsValidator = validateChatEvalDailyOidcClaims,
): Promise<"missing" | "invalid" | "forbidden" | "authorized"> {
  const token = bearer?.trim();
  if (!token) return "missing";
  try {
    const claims = await verify(token);
    const violation = validateClaims(claims);
    if (violation) return "forbidden";
    return "authorized";
  } catch {
    return "invalid";
  }
}
