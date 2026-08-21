# Cloud production monitoring

24/7 monitoring for Pundit uses **Cursor Automations** (scheduled + Railway webhook) and **Bugbot** for PR review. Cursor cloud agents read this doc and follow the incident playbook below.

No subagent required — automation prompts point here.

## Project configuration (Pundit)

| Variable | Value |
|----------|-------|
| GitHub repo | `fenomenocap/pundit` |
| Railway project | `pundit` |
| Railway API service | `@pundit/api` |
| Production API URL | `https://thepundit.up.railway.app` |
| Web frontend URL | `https://thepundit.vercel.app` |
| Railway config file | `/packages/api/railway.toml` |
| Health endpoint | `/health` |
| Readiness endpoint | `/ready` |

## One-time dashboard setup

### 1. Bugbot

1. [cursor.com/dashboard](https://cursor.com/dashboard) → Integrations → confirm **GitHub** access to `fenomenocap/pundit`
2. [cursor.com/automations/from-cursor/bugbot](https://cursor.com/automations/from-cursor/bugbot) → **Enable** for `fenomenocap/pundit`
3. Default: review on every PR update (not mention-only)

Stops `cursor[bot]` "Bugbot is not enabled" emails.

### 2. Railway config-as-code

Railway service `@pundit/api` → Settings → **Config file path** → `/packages/api/railway.toml`

Deploy healthcheck hits `/health`; `ON_FAILURE` auto-restarts up to 10 times.

### 3. Automation: Pundit prod monitor (scheduled)

Create at [cursor.com/automations](https://cursor.com/automations):

| Setting | Value |
|---------|-------|
| Name | `Pundit prod monitor` |
| Trigger | Scheduled — every 15 minutes (`*/15 * * * *`) |
| Repository | `fenomenocap/pundit`, branch `main` |
| Tools | Railway MCP, Pull request creation |

**Prompt:**

```
Scheduled production health check.

1. Run bash scripts/verify-prod.sh from the repo root.
2. If it passes, reply "OK — production healthy" and stop.
3. If it fails, read and follow docs/ops/cloud-monitor.md completely (Incident playbook section).
```

### 4. Automation: Pundit Railway incident (webhook)

| Setting | Value |
|---------|-------|
| Name | `Pundit Railway incident` |
| Trigger | Webhook (save automation to get URL + API key) |
| Repository | `fenomenocap/pundit`, branch `main` |
| Tools | Railway MCP, Pull request creation |

**Prompt:**

```
Railway webhook: deployment failure or crash for @pundit/api.

Parse the webhook payload, then read and follow docs/ops/cloud-monitor.md completely (Incident playbook section).
```

Wire Railway → Settings → Webhooks → deploy failure/crash events → this automation's webhook URL.

---

## Incident playbook

Follow this when `verify-prod.sh` fails or Railway reports a deploy crash.

### Step 1 — Assess

```bash
bash scripts/verify-prod.sh
bash scripts/diagnose-prod.sh
```

With no SHA arguments, `verify-prod.sh` resolves the latest commits that touched
the API and web deployment watch sets independently. A documentation-only main
commit is skipped by Railway/Vercel and must not create a false SHA alarm. For
an authorized release, explicit expected SHAs remain supported:
`bash scripts/verify-prod.sh <api-sha> <web-sha> shadow`.

Use **Railway MCP** to fetch latest deploy/build logs for `@pundit/api` in production.

Grep logs for: `fatal`, `[Bootstrap]`, `[ClubRatings] ALERT`, `unhandledRejection`, `uncaughtException`,
`web_search_provider_failed`, `web_search_failed`.

### Step 1b — Chat answers degraded but the service is up

Chat runs on MiniMax M3, and its web search is a Pundit-executed tool rather than a hosted
one. Search failing does **not** take the whole service down. Structured model/competition
grounding remains usable, while current-fact requests fail closed or abstain instead of
falling back to stale pre-training. The degradation is safe for claims but still operationally
important.

`GET /ready` reports `webSearch`:

```json
"webSearch": {
  "lastGoodProvider": "minimax",
  "lastGoodAt": "2026-08-11T10:31:02.104Z",
  "consecutiveFailures": 0,
  "totalSearches": 41,
  "providerFailures": {},
  "enabledProviders": ["minimax"]
}
```

Alert on either of:

- `consecutiveFailures` climbing above ~3 — every enabled provider is failing.
- `lastGoodProvider` stuck at an old `lastGoodAt` while `totalSearches` climbs — searches
  are running but none are succeeding.

**Why the primary is the fragile part.** MiniMax's search endpoint
(`POST /v1/coding_plan/search`) is undocumented; it was identified from the source of
MiniMax's published `minimax-coding-plan-mcp` server. It uses the same key and coding-plan
quota as inference, so it adds no vendor or bill, but it can change shape without notice.

**Recovery** is a code change: the response shape is parsed in one place (`web-search.ts`,
`minimaxProvider.run`), so adapting to a changed payload — or slotting in a replacement
backend — touches that file only. There is deliberately no second vendor configured; search
rides the key and quota Pundit already pays for.

### Step 1c — Rate limiting and replica count

`express-rate-limit` keeps counters in process memory. `/api/ask` uses one
process-wide bucket rather than a bucket per client IP, and each replica enforces its own
limit. `/api/ask` therefore divides the intended global budget by the declared replica
count: `ASK_RATE_LIMIT_PER_MINUTE` (default 10) ÷ `API_REPLICAS` (default 1, matching
Railway's current single replica).

`GET /ready` reports the resolved values:

```json
"askRateLimit": { "scope": "deployment", "perMinute": 10, "replicas": 1, "perInstance": 10 }
```

The same response reports `seasonSchedule` with the current season, 380-row
completeness, age, refresh error, and `servingLastGood`. `ready` is true only
for a current-season, complete, error-free snapshot younger than six hours. The
schedule is checked on the 30-minute refresh cadence and refreshed ahead of
that deadline so normal polling drift does not create a false readiness gap.

**If you change Railway's replica count, change `API_REPLICAS` to match.** If the
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

1. Restart or redeploy the service via Railway MCP
2. Wait for deploy to complete
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

Missing `MINIMAX_API_KEY`, Railway misconfiguration, or cause not obvious from logs.

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
3. Copy `packages/api/railway.toml` pattern; set Railway config file path
4. Duplicate both Cursor Automations; prompts stay the same (they reference this doc path)
5. Enable Bugbot for the new repo
6. Wire the new Railway project's webhook to the incident automation

---

## What stays in GitHub CI

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — tests on every PR and `main` push
- [`.github/workflows/verify-prod.yml`](../../.github/workflows/verify-prod.yml) — `verify-prod.sh` after every merge to `main`

Scheduled 24/7 checks run in **Cursor**, not GitHub Actions.
