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

Use **Railway MCP** to fetch latest deploy/build logs for `@pundit/api` in production.

Grep logs for: `fatal`, `[Bootstrap]`, `[ClubRatings] ALERT`, `unhandledRejection`, `uncaughtException`,
`web_search_provider_failed`, `web_search_failed`.

### Step 1b — Chat answers degraded but the service is up

Chat runs on MiniMax M3, and its web search is a Pundit-executed tool rather than a hosted
one. Search failing does **not** fail a request: answers fall back to model grounding and
pre-training, which for team news, transfers and injuries means quietly stale content. It is
therefore invisible unless watched for.

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

`express-rate-limit` keeps counters in process memory, so each replica enforces its own
limit. `/api/ask` therefore divides the intended global budget by the declared replica
count: `ASK_RATE_LIMIT_PER_MINUTE` (default 10) ÷ `API_REPLICAS` (default 1, matching
Railway's current single replica).

`GET /ready` reports the resolved values:

```json
"askRateLimit": { "perMinute": 10, "replicas": 1, "perInstance": 10 }
```

**If you change Railway's replica count, change `API_REPLICAS` to match.** If it drifts
low the limit only gets stricter than intended, which is the safe direction; if it drifts
high, users get throttled more than intended on an endpoint that costs LLM quota per call.

To confirm the real ceiling, send ~14 *sequential* requests from a fresh window and watch
for 429s: the count decrements by one per request and the request after the limit is
refused. A concurrent burst is a poor test — the in-memory counter increments
asynchronously, so simultaneous requests can all read the same remaining count and slip
through together. That overshoot is a property of the store, not of the budget.

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
