/**
 * Mint GitHub Actions OIDC tokens inside the runner (valid ~5 minutes).
 * Falls back to CHAT_EVAL_GITHUB_OIDC_TOKEN when mint env is unavailable.
 */

export const CHAT_EVAL_JUDGE_OIDC_AUDIENCE = "pundit-judge";

export function actionsOidcMintEnvPresent() {
  return Boolean(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim()
    && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim(),
  );
}

export async function mintGitHubActionsOidcToken(
  audience = CHAT_EVAL_JUDGE_OIDC_AUDIENCE,
) {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim();
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim();
  if (!requestUrl || !requestToken) return null;

  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `bearer ${requestToken}`,
        Accept: "application/json",
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  try {
    const body = await response.json();
    const value = typeof body?.value === "string" ? body.value.trim() : "";
    return value || null;
  } catch {
    return null;
  }
}

/** Prefer a fresh Actions mint; use pre-minted workflow token only as fallback. */
export async function resolveRemoteJudgeBearerToken(options = {}) {
  if (options.oidcToken?.trim()) return options.oidcToken.trim();
  const audience = options.audience ?? CHAT_EVAL_JUDGE_OIDC_AUDIENCE;
  const minted = await mintGitHubActionsOidcToken(audience);
  if (minted) return minted;
  return process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN?.trim() ?? null;
}

export function remoteJudgeConfiguredSync(options = {}) {
  if (options.oidcToken?.trim()) return true;
  if (actionsOidcMintEnvPresent()) return true;
  return Boolean(process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN?.trim());
}
