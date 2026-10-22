# Environment variables

Names only — never commit secret **values**. Production API secrets live in an env file on the DigitalOcean droplet (never in git; owner-managed); web variables live in the Vercel project. Railway is retired as the API host. Local development uses a gitignored repo-root `.env` (see [README](../../README.md)); the web app receives only `NEXT_PUBLIC_*` keys via `packages/web/next.config.mjs`.

## API — core

| Variable | Purpose |
| --- | --- |
| `API_PORT` | Local listen port (default 3001) |
| `API_URL` | Base URL for internal references |
| `PORT` | Platform port override (set by `deploy/do/docker-compose.yml` in production) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins; empty = open (dev only) |
| `PUNDIT_DATA_DIR` | Writable durable state (`/data` in prod; else `packages/api/data`) |

## API — model & fixtures policy

| Variable | Purpose |
| --- | --- |
| `FIXTURE_REGISTRY_ENABLED` | Expanded recognized-fixture routing (code default false; **enabled in production**, and Verify Production expects `enabled`) |
| `FRIENDLY_SHADOW_ENABLED` | Private friendly-shadow ledger (default false) |
| `PROSPECTIVE_MODEL_CAPTURE` | Retired prospective collector; keep `false` for v3 |
| `BACKTEST_PROMOTED_MODEL_ENABLED` | Allow backtest-promoted model path (default false) |
| `ONE_X_TWO_TEMPERATURE_ENABLED` | 1X2 temperature scaling, T = 1.286 ([Methodology §5.4](../methodology.md)). **Off** unless exactly `true`; enabling it changes live forecasts and needs the owner's approval |

## API — inference & chat

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Answers + search (production primary) |
| `OPENROUTER_MODEL` | Optional override; auto/online lists ignored |
| `OPENROUTER_BASE_URL` | OpenRouter API host |
| `MINIMAX_API_KEY` | Answer fallback when OpenRouter unset |
| `MINIMAX_MODEL` | MiniMax model id |
| `MINIMAX_BASE_URL` | Region-scoped Anthropic-compatible host |
| `PUNDIT_REASONING` | Set `off` to disable reasoning on OpenRouter (default off in prod) |
| `CHAT_ENGINE` | `agent` for tool-calling engine; default `legacy` |
| `ANALYST_RESPONSE_V2` | Response-facts architecture; set exactly `false` for emergency rollback |

## API — search & rate limits

| Variable | Purpose |
| --- | --- |
| `WEB_SEARCH_PROVIDER_ORDER` | Provider preference list |
| `WEB_SEARCH_CONCURRENCY` | In-flight search cap (default 4, max 8) |
| `WEB_SEARCH_REPLAY_RECORD` | Record search payloads for replay id (eval tooling) |
| `ASK_RATE_LIMIT_PER_MINUTE` | Deployment-wide `/api/ask` limit |
| `API_REPLICAS` | Divides rate limit across processes |

## API — build / ops metadata

| Variable | Purpose |
| --- | --- |
| `BUILD_SHA` | Served build identifier when not injected by platform |

## Chat eval, verification (CLI / CI, not production server settings)

| Variable | Purpose |
| --- | --- |
| `PUNDIT_API_URL` | API to sweep or verify. Default is the production DigitalOcean API (`scripts/chat-battle-test.mjs`, `scripts/verify-prod.sh`) |
| `PUNDIT_EXPECT_FIXTURE_REGISTRY` | Expected fixture-registry mode for `verify-prod.sh` (`enabled` default, or `shadow`) |
| `CHAT_EVAL_SEARCH_REPLAY_DIR` | Directory of recorded search fixtures |
| `CHAT_EVAL_SEARCH_REPLAY_ID` | Select replay bundle for a run |
| `CHAT_EVAL_ENGINE` | `agent` or legacy for battle-test |
| `PUNDIT_DEPLOYMENT_ID` | Bind eval artifact to deployment |
| `PUNDIT_SOURCE_SHA` | Expected source SHA for eval run |

## Web (Next.js)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Browser API base (production: the DigitalOcean API). Inlined at build time; a change needs one Vercel rebuild |
| `NEXT_PUBLIC_USE_MOCK` | `true` = mock fixtures; `false` = live API |
| `NEXT_PUBLIC_DOCS_URL` | Public GitBook URL for in-app doc links |
| `VERCEL_GIT_COMMIT_SHA` | Set by Vercel for `/api/version` |
| `BUILD_SHA` | Fallback build SHA on web |

Template with comments: [`.env.example`](../../.env.example). Agent-oriented summary: [`CLAUDE.md`](../../CLAUDE.md).
