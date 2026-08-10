# Cloud production monitoring

24/7 monitoring for Pundit uses **Cursor Automations** (scheduled + Railway webhook) and **Bugbot** for PR review. Cursor cloud agents read this doc and follow the incident playbook below.

No subagent required — automation prompts point here.

## Project configuration (Pundit)

| Variable | Value |
|----------|-------|
| GitHub repo | `fenomenocap/pundit` |
| Railway project | `pundit` |
| Railway API service | `@sports-predict/api` |
| Production API URL | `https://sports-predictapi-production.up.railway.app` |
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

Railway service `@sports-predict/api` → Settings → **Config file path** → `/packages/api/railway.toml`

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
Railway webhook: deployment failure or crash for @sports-predict/api.

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

Use **Railway MCP** to fetch latest deploy/build logs for `@sports-predict/api` in production.

Grep logs for: `fatal`, `[Bootstrap]`, `[ClubRatings] ALERT`, `unhandledRejection`, `uncaughtException`.

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

Missing `ANTHROPIC_API_KEY`, Railway misconfiguration, or cause not obvious from logs.

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
