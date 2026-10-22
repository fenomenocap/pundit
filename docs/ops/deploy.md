# Deploy and release

How a change on `main` reaches production. Production is two services:

| Service | Host | Deploys when |
| --- | --- | --- |
| **Web** (`packages/web`, Next.js) | Vercel, project `sports-prediction-markets-web`, <https://thepundit.vercel.app> | A push to `main` that changes a web or shared input (see below) |
| **API** (`packages/api`, Express) | DigitalOcean droplet behind Caddy, <https://134-209-121-101.sslip.io> | Every push to `main` whose CI run passes |

The API moved from Railway to DigitalOcean on 22 Oct 2026. Railway is **retired as the production API host**: the old service may still answer at its old address with a frozen build, but nothing deploys to it, the website does not call it, and Verify Production and the chat eval no longer target it.

## Pipeline on `main`

1. **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`: dependency audits, API and web type-checks, the pinned club-strength artifact check, API tests, the walk-forward backtest smoke, chat-eval harness tests and the pinned deterministic gate, deploy-script tests, a web build and the Playwright smoke.
2. **Deploy API (DigitalOcean)** (`.github/workflows/deploy-do.yml`) runs when CI on a `main` push succeeds (or by hand). It SSHes to the droplet with the **exact commit CI tested** (`deploy <sha>`), then polls the public `/version` until it reports that sha.
3. On the droplet, `deploy/do/swap.sh` does a **health-gated blue/green swap** with no downtime: it builds the new image while the old container keeps serving, starts the idle colour, waits for `/ready` and `/version`, switches Caddy gracefully, verifies through the public URL, then retires the old container after a drain. It refuses a commit that is not on `main` or is older than the live one, so a late CI run cannot roll production back. Full detail, exit codes and rollback: [`deploy/do/README.md`](../../deploy/do/README.md).
4. **Verify Production** (`.github/workflows/verify-prod.yml`) runs after each Deploy API run and checks the live API and web against the expected commits (`scripts/verify-prod.sh`, see [Production verification](cloud-monitor.md)).

`deploy-do.yml` has no path filter: a documentation-only push to `main` still triggers a (harmless, zero-downtime) API redeploy of the same code. To avoid a needless rebuild, documentation-only commits can carry `[skip ci]` in the merge commit message; CI still runs on the pull request.

## When Vercel builds

`packages/web/vercel.json` runs `scripts/vercel-ignore.sh`. It builds **only on `main`** and only when a web or shared input changed (the path list is in `scripts/deploy-build-paths.mjs`). Pull-request previews and API-only or docs-only commits are skipped ("Canceled by Ignored Build Step"). Batch web changes so one merge means one build. `NEXT_PUBLIC_API_URL` is inlined at build time, so changing it in Vercel needs one rebuild.

## Scheduled checks

| Workflow | When | What |
| --- | --- | --- |
| `model-pin-expiry.yml` | Daily 00:00 UTC (08:00 SGT) | Fails from 7 days before the EPL goal calibration or ClubElo pin hard expiry ([Methodology §8](../methodology.md)) |
| `clubelo-freshness.yml` | Mondays 08:00 UTC | ClubElo pin age plus the same expiry check |
| `chat-eval-daily.yml` | Daily 08:23 and 11:47 UTC | Chat eval sweep against the live DigitalOcean API ([Chat eval runbook](chat-eval.md)) |

## Configuration and secrets

API environment variables live in an env file on the droplet that is never committed; web variables live in the Vercel project. Names only are listed in [Environment variables](environment-variables.md). Changes to the droplet, its env file or the deploy keys are made by the owner, not by agents or CI.

## Rollback

* **API:** run the swap by hand with an older sha and `ALLOW_OLDER=1` (see `deploy/do/README.md`). The previous container is kept stopped for a fast rollback.
* **Web:** promote the previous production deployment in Vercel.
