# Cloud production monitoring

24/7 monitoring for Pundit uses **Cursor Automations** (scheduled) and **Bugbot** for PR review, plus the GitHub workflows listed at the end. Cursor cloud agents read this doc and follow the incident playbook below. How a change reaches production is in [Deploy and release](deploy.md).

No subagent required — automation prompts point here.

## Project configuration (Pundit)

| Variable | Value |
|----------|-------|
| GitHub repo | `fenomenocap/pundit` |
| API host | DigitalOcean droplet, Docker blue/green behind Caddy ([`deploy/do/README.md`](../../deploy/do/README.md)) |
| Production API URL | `https://134-209-121-101.sslip.io` |
| Web frontend URL | `https://thepundit.vercel.app` |
| API deploy | `.github/workflows/deploy-do.yml` (exact CI-tested sha) |
| Health endpoint | `/health` |
| Readiness endpoint | `/ready` |
| Build identity | `/version` (API), `/api/version` (web) |

**Railway is retired** as the production API host (22 Oct 2026). The old service at `thepundit.up.railway.app` may still answer with a frozen build; it receives no deploys, and nothing in production, Verify Production or the chat eval targets it. Do not use its status or logs to judge production.

## One-time dashboard setup

### 1. Bugbot

1. [cursor.com/dashboard](https://cursor.com/dashboard) → Integrations → confirm **GitHub** access to `fenomenocap/pundit`
2. [cursor.com/automations/from-cursor/bugbot](https://cursor.com/automations/from-cursor/bugbot) → **Enable** for `fenomenocap/pundit`
3. Default: review on every PR update (not mention-only)

Stops `cursor[bot]` "Bugbot is not enabled" emails.

### 2. Automation: Pundit prod monitor (scheduled)

Create at [cursor.com/automations](https://cursor.com/automations):

| Setting | Value |
|---------|-------|
| Name | `Pundit prod monitor` |
| Trigger | Scheduled — every 15 minutes (`*/15 * * * *`) |
| Repository | `fenomenocap/pundit`, branch `main` |
| Tools | Pull request creation |

**Prompt:**

```
Scheduled production health check.

1. Run bash scripts/verify-prod.sh from the repo root.
2. If it passes, reply "OK — production healthy" and stop.
3. If it fails, read and follow docs/ops/cloud-monitor.md completely (Incident playbook section).
```

The former Railway deploy-failure webhook automation is retired with Railway. A failed API deploy now shows as a failed **Deploy API (DigitalOcean)** run in GitHub Actions, followed by no Verify Production run for that sha.

---

## Incident playbook

Follow this when `verify-prod.sh` fails or a **Deploy API (DigitalOcean)** run fails.

### Step 1 — Assess

```bash
bash scripts/verify-prod.sh
bash scripts/diagnose-prod.sh
```

With no SHA arguments, `verify-prod.sh` resolves the latest commits that touched
the API and web deployment watch sets independently. A documentation-only main
commit is skipped by Vercel and must not create a false SHA alarm (the API watch set also ignores docs). For
an authorized release, explicit expected SHAs remain supported:
`bash scripts/verify-prod.sh <api-sha> <web-sha>`. The expected fixture-registry
mode comes from `PUNDIT_EXPECT_FIXTURE_REGISTRY` (`enabled` by default, or
`shadow`); a third positional argument is ignored.

For API deploy problems, read the failed **Deploy API (DigitalOcean)** run log in GitHub Actions: `swap.sh` logs every step and exits with a specific code (2 bad request, 3 sha refused, 4 not ready, 5 Caddy reload failed, 6 public verify failed; see `deploy/do/README.md`). Container logs are on the droplet (`docker logs pundit-api-<colour>`, `state/swap.log`); only the owner has droplet access, so ask for them rather than logging in.

Grep logs for: `fatal`, `[Bootstrap]`, `[ClubRatings] ALERT`, `[ClubRatings] WARN`, `unhandledRejection`, `uncaughtException`,
`web_search_provider_failed`, `web_search_failed`.

`GET /ready` `model.ratingsRefreshDue` is true when the ClubElo pin is 7 or more days old. Forecasts keep serving until the 30-day fail-closed gate. Refresh with `pnpm --filter @sports-predict/api refresh:clubelo-snapshot`, then review and deploy the new artifact.

### Step 1b — Chat answers degraded but the service is up

Chat answers are pinned to `deepseek/deepseek-v4-flash` via `OPENROUTER_API_KEY`,
with MiniMax only as the fallback when that key is unset. Web search is a
Pundit-executed OpenRouter tool rather than a hosted one. Search failing does
**not** take the whole service down. Structured model/competition grounding
remains usable, while current-fact requests fail closed or abstain instead of
falling back to stale pre-training. The degradation is safe for claims but still
operationally important.

`GET /ready` reports `webSearch`:

```json
"webSearch": {
  "lastGoodProvider": "openrouter",
  "lastGoodAt": "2026-08-11T10:31:02.104Z",
  "consecutiveFailures": 0,
  "totalSearches": 41,
  "providerFailures": {},
  "enabledProviders": ["openrouter"]
}
```

Alert on either of:

- `consecutiveFailures` climbing above ~3 — every enabled provider is failing.
- `lastGoodProvider` stuck at an old `lastGoodAt` while `totalSearches` climbs — searches
  are running but none are succeeding.

**Why search can look empty when it is not.** Search calls OpenRouter chat completions
with `openrouter:web_search` and keeps `url_citation` pages. A reply with no citation
and no recorded search is `malformed_response`, not an empty web. The answer client
does not receive that tool.

**Recovery** is a code change in `openRouterProvider.run` inside `web-search.ts`.
Search and answers share `OPENROUTER_API_KEY`. There is no Brave or MiniMax search
provider.

### Step 1c — Rate limiting and replica count

`express-rate-limit` keeps counters in process memory. `/api/ask` uses one
process-wide bucket rather than a bucket per client IP, and each replica enforces its own
limit. `/api/ask` therefore divides the intended global budget by the declared replica
count: `ASK_RATE_LIMIT_PER_MINUTE` (default 10) ÷ `API_REPLICAS` (default 1, matching
the single live API container; during a blue/green swap two containers overlap
for about 20 seconds).

`GET /ready` reports the resolved values:

```json
"askRateLimit": { "scope": "deployment", "perMinute": 10, "replicas": 1, "perInstance": 10 }
```

The same response reports `seasonSchedule` with the current season, 380-row
completeness, age, refresh error, and `servingLastGood`. `ready` is true only
for a current-season, complete, error-free snapshot younger than six hours. The
schedule is checked on the 30-minute refresh cadence and refreshed ahead of
that deadline so normal polling drift does not create a false readiness gap.

**If you change the number of live API containers, change `API_REPLICAS` to match.** If the
declared count is lower than the actual replica count, the effective deployment ceiling
becomes too permissive; if it is higher, each replica throttles more aggressively. Treat
either mismatch as configuration drift.

The limiter uses one process-wide bucket, so different client IPs share the same per-instance
allowance. Confirming it with production requests spends live MiniMax traffic and requires
explicit authorization and pacing; use the local behavioral regression test for routine checks.

### Step 2 — Decide

#### A) Transient / site down

Logs show OOM, timeout, unclear runtime exit, or verify-prod fails with connection errors — and no obvious code regression on `main`.

**Action:**

1. Re-run **Deploy API (DigitalOcean)** for the current `main` sha (workflow dispatch), or ask the owner to restart the live container. Never deploy an older sha without the owner's approval.
2. Wait for the run to finish and `/version` to show the sha
3. Re-run `bash scripts/verify-prod.sh`
4. Report outcome

#### B) Code bug

Logs point to a fixable bug in this repo (missing handler, bad import, crash in cron refresh, TypeScript/build failure).

**Action:**

1. Fix on branch `cursor/incident-*`
2. Run:
   ```bash
   pnpm --filter @sports-predict/api test
   cd packages/api && npx tsc --noEmit
   ```
3. Open a **draft PR** with root cause and fix
4. Do **not** merge

#### C) Unclear / env / secret

A missing key in the droplet env file, droplet or Caddy misconfiguration, or cause not obvious from logs.

**Action:**

1. Do **not** restart in a loop or open a speculative PR
2. Post a short summary: what failed, what was checked, what the human must fix manually

### Step 3 — Report

Always end with:

- Current `/health` and `/ready` status
- Action taken: restart / draft PR / none
- Link to draft PR if opened

---

## Fork checklist (new project)

1. Copy this file and `scripts/verify-prod.sh`, `scripts/diagnose-prod.sh`
2. Update the **Project configuration** table (URLs, service names)
3. Copy `deploy/do/` (compose, Dockerfile, Caddy, `swap.sh`, `deploy.sh`) and `.github/workflows/deploy-do.yml`; set the host and deploy-key secrets
4. Duplicate the Cursor Automation; the prompt stays the same (it references this doc path)
5. Enable Bugbot for the new repo

---

## What stays in GitHub CI

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — tests on every PR and `main` push
- [`.github/workflows/deploy-do.yml`](../../.github/workflows/deploy-do.yml) — deploys the CI-tested sha to DigitalOcean after CI passes on `main`
- [`.github/workflows/verify-prod.yml`](../../.github/workflows/verify-prod.yml) — `verify-prod.sh` after every Deploy API run
- [`.github/workflows/model-pin-expiry.yml`](../../.github/workflows/model-pin-expiry.yml) — daily model pin expiry alarm
- [`.github/workflows/chat-eval-daily.yml`](../../.github/workflows/chat-eval-daily.yml) — daily chat eval against the live API

The 15-minute health check runs in **Cursor**; the daily checks above run in GitHub Actions.
