# Pundit API on DigitalOcean: runbook

> **Bring-up record (22 Oct 2026).** Steps 1–8 are how degen-dev was first set up, and are kept for reference. The files under `deploy/do/` are now canonical. Deploys go through `/opt/pundit-deploy/deploy.sh <sha>` (zero-downtime blue/green, see `deploy/do/README.md`), not `docker compose up --build api`.

Server: `degen-dev`, 134.209.121.101 (NYC1, Ubuntu 24.04, 2 GB + 2 GB swap, Docker 29.9.2).
Public URL after this: **https://134-209-121-101.sslip.io**
Run every block as root in your SSH session (`ssh root@134.209.121.101`). Paste one block at a time and check its output before the next.

Nothing here touches Railway or Vercel until step 8, so prod keeps serving from Railway (a842177) the whole time.

## 1. Clone the repo and make the data dir
`fenomenocap/pundit` is **public**, so no token or deploy key is needed.
```bash
git clone https://github.com/fenomenocap/pundit.git /opt/pundit
git -C /opt/pundit log --oneline -1
mkdir -p /opt/pundit-data && chown 1000:1000 /opt/pundit-data
docker compose version
```
Expect a commit line from `main` and a `Docker Compose version v2…` line.

## 2. Write the deploy files
Paste this whole block. It creates `/opt/pundit-deploy/` with the compose file, Dockerfile and Caddyfile.
```bash
mkdir -p /opt/pundit-deploy && cd /opt/pundit-deploy
cat > docker-compose.yml <<'EOF'
# Pundit API on the DigitalOcean droplet (degen-dev, 134.209.121.101).
# Layout on the server:
#   /opt/pundit          git clone of fenomenocap/pundit (main)
#   /opt/pundit/.env.api secrets + flags (chmod 600, gitignored by .env.*)
#   /opt/pundit-deploy   this bundle (docker-compose.yml, Dockerfile, Caddyfile)
#   /opt/pundit-data     persistent PUNDIT_DATA_DIR (was Railway /data)
# Start/update:  cd /opt/pundit-deploy && BUILD_SHA=$(git -C /opt/pundit rev-parse HEAD) docker compose up -d --build

name: pundit

services:
  api:
    build:
      context: /opt/pundit
      dockerfile: /opt/pundit-deploy/Dockerfile
    image: pundit-api:local
    restart: unless-stopped
    env_file:
      - /opt/pundit/.env.api
    environment:
      # Fixed by this deployment; override nothing here in .env.api.
      PORT: "3001"
      PUNDIT_DATA_DIR: /data
      BUILD_SHA: ${BUILD_SHA:-unknown}
      NODE_OPTIONS: --max-old-space-size=768
    volumes:
      - /opt/pundit-data:/data
    # Loopback only: reachable from the droplet itself (curl) and from Caddy over
    # the compose network. Docker-published ports bypass ufw, so never 0.0.0.0.
    ports:
      - "127.0.0.1:3001:3001"
    mem_limit: 1g
    memswap_limit: 1536m
    stop_grace_period: 25s   # matches Railway drainingSeconds=20 + margin
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      - api
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data      # certificates: keep this volume
      - caddy_config:/config
    mem_limit: 256m
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

volumes:
  caddy_data:
  caddy_config:
EOF
cat > Dockerfile <<'EOF'
# syntax=docker/dockerfile:1
# Pundit API image. Mirrors Railway: build `pnpm --filter @sports-predict/api build`,
# run `node packages/api/dist/index.js`. Build context = the git clone (/opt/pundit).
# Only explicit paths are copied, so /opt/pundit/.env.api never enters the image.
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/

FROM base AS build
# tsc peaks around 0.6 GB; cap the heap so the 2 GB droplet (+2 GB swap) never OOMs.
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN pnpm install --frozen-lockfile --filter "@sports-predict/api..."
COPY packages/api packages/api
RUN pnpm --filter @sports-predict/api build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@sports-predict/api..."

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/vendor ./vendor
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/packages/api/dist ./packages/api/dist
# Bundled release artifacts (club strength, EPL goal calibration, fixture registry seed).
COPY --from=build /app/packages/api/data ./packages/api/data
# Read at runtime by the remote chat-eval judge and eval replay paths.
COPY scripts ./scripts
COPY evals ./evals
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
CMD ["node", "packages/api/dist/index.js"]
EOF
cat > Caddyfile <<'EOF'
# Automatic HTTPS (Let's Encrypt, ZeroSSL fallback). No domain yet, so this uses
# sslip.io: 134-209-121-101.sslip.io resolves to 134.209.121.101 and gets a real cert.
#
# To switch to a custom domain later (e.g. api.example.com):
#   1. DNS: A record api.example.com -> 134.209.121.101
#   2. Replace the hostname below (or list both, comma-separated, during the switch)
#   3. docker compose restart caddy
#   4. Update Vercel NEXT_PUBLIC_API_URL once and redeploy main once.
{
	# Optional: an address for certificate-expiry notices.
	# email you@example.com
}

134-209-121-101.sslip.io {
	encode zstd gzip
	reverse_proxy api:3001
}
EOF
ls -la /opt/pundit-deploy
```

## 3. Create the env file (secrets go in here, typed by you)
This writes the template with empty keys and locks it to root only.
```bash
install -m 600 /dev/null /opt/pundit/.env.api
# (Template body omitted from git: env files are never committed. Key names and
# defaults are in docs/ops/environment-variables.md; the bring-up template lived
# off-repo. PORT, PUNDIT_DATA_DIR and BUILD_SHA are set by docker-compose.yml.)
chmod 600 /opt/pundit/.env.api && ls -l /opt/pundit/.env.api
```
Then open it and paste in the **new** key(s) from your password manager:
```bash
nano /opt/pundit/.env.api
```
Fill in `OPENROUTER_API_KEY` (recommended) and/or `MINIMAX_API_KEY`. Save with Ctrl+O, Enter, then exit with Ctrl+X. Check that the key names are filled in without printing the values:
```bash
grep -E '^(OPENROUTER_API_KEY|MINIMAX_API_KEY)=' /opt/pundit/.env.api | sed 's/=.\+/=<set>/'
```

## 4. Build and start
The first build takes about 3–5 minutes. Peak build memory is about 0.6 GB, so it fits easily.
```bash
cd /opt/pundit-deploy && BUILD_SHA=$(git -C /opt/pundit rev-parse HEAD) docker compose up -d --build && docker compose ps
```
Expect `pundit-api-1` and `pundit-caddy-1` to show as `Up`. The API shows `(healthy)` after about a minute.

## 5. Check the API on the server
```bash
sleep 45; curl -s localhost:3001/health; echo; curl -s -o /dev/null -w 'startup %{http_code}\n' localhost:3001/startup; curl -s localhost:3001/version; echo
curl -s localhost:3001/ready | grep -o '"inference":{[^}]*}' | head -c 300; echo
```
Expect `{"status":"ok"}`, `startup 200`, the commit SHA, and `"keySource":"OPENROUTER_API_KEY","configured":true` (or `MINIMAX_API_KEY`). `startup 503` just means it's still warming up, so wait 30 s and run it again. If it stays at 503: `docker compose logs --tail 80 api`.

## 6. Check HTTPS from outside
The first request makes Caddy get the certificate, which takes 10–30 s.
```bash
curl -s https://134-209-121-101.sslip.io/health; echo
curl -sI -H 'Origin: https://thepundit.vercel.app' https://134-209-121-101.sslip.io/health | grep -i access-control-allow-origin
```
Expect `{"status":"ok"}` and `access-control-allow-origin: https://thepundit.vercel.app`. If the certificate fails, run `docker compose logs --tail 50 caddy`. See "Certificate trouble" below.

## 7. Test chat (uses the LLM key, which costs a few cents)
```bash
curl -s -X POST https://134-209-121-101.sslip.io/api/ask -H 'content-type: application/json' -d '{"question":"What do you think about Liverpool'"'"'s form?"}' | head -c 400; echo
```
Expect a real answer. `{"error":"Analysis service is temporarily unavailable."}` means no working LLM key, so recheck step 3.

## 8. Switch the website (Vercel): one env change plus one redeploy
Vercel project **sports-prediction-markets-web** (serves thepundit.vercel.app):
1. Go to Settings, then Environment Variables, and find **`NEXT_PUBLIC_API_URL`** (Production, Sensitive). Click Edit and set it to:
   `https://134-209-121-101.sslip.io`  (no trailing slash). Save.
2. Go to Deployments and open the current **Production** deployment (branch `main`). Click ⋯, then **Redeploy**, and **untick "Use project's Ignore Build Step"**. Otherwise `scripts/vercel-ignore.sh` sees no web change and cancels the build, and a cancelled build still counts against the quota. Then confirm Redeploy.
3. When it's Ready, open https://thepundit.vercel.app. In DevTools, the Network tab should show calls going to `134-209-121-101.sslip.io`. Ask one question in chat.

`NEXT_PUBLIC_API_URL` is baked in at build time, so the redeploy is needed. Saving the variable alone changes nothing.

## Rollback
- Before step 8: nothing to roll back, because the site still uses Railway. To stop the new server: `cd /opt/pundit-deploy && docker compose down`.
- After step 8: in Vercel Deployments, use **Instant Rollback** (or "Promote to Production") on the previous production deployment. It still has the Railway URL baked in, needs no build, and doesn't change the env var. Then set `NEXT_PUBLIC_API_URL` back to `https://thepundit.up.railway.app` so the next build doesn't switch to the new server again.
- Railway prod (a842177) keeps running until you delete it. Keep it up for 7 days after the switch.

## Later: restore Railway's /data (once a backup exists)
```bash
cd /opt/pundit-deploy && docker compose stop api
tar xzf /root/pundit-data-backup.tgz -C /opt/pundit-data --strip-components=1   # adjust to the archive layout
chown -R 1000:1000 /opt/pundit-data && docker compose start api
```

## Updating to a new commit
Superseded. Merges to `main` deploy automatically: `deploy-do.yml` SSHes in, and the forced command `/opt/pundit-deploy/deploy.sh` runs the health-gated swap. To deploy by hand: `/opt/pundit-deploy/deploy.sh <40-hex sha>`. The old command (`git pull && docker compose up -d --build api`) caused about 1 min of 502s, so don't use it.

## Switching to a custom domain later
Add a DNS A record `api.<domain>` pointing to 134.209.121.101. In `/opt/pundit-deploy/Caddyfile`, change the hostname (during the switch you can list both, separated by a comma), then run `docker compose restart caddy`. Then do step 8 again with the new URL, which is one more env change plus one redeploy.

## Certificate trouble
sslip.io names share Let's Encrypt's rate limits with every other sslip.io user. If Caddy logs `rateLimited`, it retries and falls back to ZeroSSL on its own. Uncomment the `email` line in the Caddyfile to help with that, then `docker compose restart caddy`. If it still fails, a cheap domain (step above) removes the problem.

## Notes
- Data: with an empty `/opt/pundit-data`, the API still starts and passes `/startup`. The model, ratings and fixtures come from artifacts bundled in the repo plus public feeds, and it writes new state as it runs. What's missing until the Railway `/data` backup is restored: the rolling club-season calibration history, the prospective-model evidence, the season-schedule and registry recovery copies, and older match dossiers (new ones get rebuilt). Calibration and prospective history can't be regenerated, so restore the backup before the restarted history gets too long. Merging the two needs care, so don't overwrite blindly.
- Docker-published ports bypass ufw. That's why the API is bound to `127.0.0.1:3001` and only Caddy publishes 80 and 443.
- Logs: `cd /opt/pundit-deploy && docker compose logs -f api`. Memory: `docker stats --no-stream`.
