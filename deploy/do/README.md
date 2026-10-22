# DigitalOcean API deploy (degen-dev): health-gated blue/green swap

| File | On the droplet | Role |
| --- | --- | --- |
| `docker-compose.yml` | `/opt/pundit-deploy/docker-compose.yml` | Compose project `pundit`: Caddy, plus the `api` service definition each colour is started from. |
| `Dockerfile` | `/opt/pundit-deploy/Dockerfile` | API image. The build context is the clone at `/opt/pundit`. |
| `caddy/Caddyfile` | `/opt/pundit-deploy/caddy/Caddyfile` | TLS for `134-209-121-101.sslip.io`. It `import`s `upstream.caddy`. |
| `caddy/upstream.caddy.example` | `/opt/pundit-deploy/caddy/upstream.caddy` | `reverse_proxy <live container>:3001`. It is written only by `swap.sh`. |
| `deploy.sh` | `/opt/pundit-deploy/deploy.sh` | The SSH forced command for the deploy key. It parses `$SSH_ORIGINAL_COMMAND` strictly. |
| `swap.sh` | `/opt/pundit-deploy/bin/swap.sh` | The swap itself. |
| `swap.conf.example` | `/opt/pundit-deploy/swap.conf` | Non-secret settings. The defaults match degen-dev. |
| `RUNBOOK.md` | n/a | The original bring-up record. |

Env stays in `/opt/pundit/.env.api`. Compose references that file by path (`env_file`), and it is never in git.

## Topology

```
internet :443 ── pundit-caddy-1 ──(pundit_default)──▶ pundit-api-blue:3001   ◀─ 127.0.0.1:3101 (health gate)
                 (project pundit)                     pundit-api-green:3001  ◀─ 127.0.0.1:3102
                                                      pundit-api-1:3001      (legacy, pre-swap, stopped)
all API containers: /opt/pundit-data → /data (bind mount), env_file /opt/pundit/.env.api
```

Each colour is the `api` service from `docker-compose.yml`, run as its own compose project (`pundit-blue`, `pundit-green`). A generated override (`state/override-<colour>.yml`) sets:
- the image `pundit-api:<sha>`;
- the container name `pundit-api-<colour>`;
- `GITHUB_SHA` and `BUILD_SHA` set to `<sha>`, so `/version` is exact;
- a loopback port;
- the external network `pundit_default`.

Caddy dials the live container **by container name**. Compose also gives every colour the alias `api`, so `api:3001` would round-robin across colours. Never put it back in `upstream.caddy`.

In `docker-compose.yml`, `api` sits behind `profiles: ["legacy"]`, and Caddy no longer `depends_on` it. A plain `docker compose up -d` therefore never starts a second API.

## What one deploy does

1. **Resolve the commit.**
   - `deploy.sh` accepts only `<sha>`, `deploy <sha>`, or the legacy bare `deploy` (only while `ALLOW_TIP_DEPLOY=1`). Anything else exits 2.
   - `swap.sh` takes the deploy lock (`flock` on `/opt/pundit-deploy/deploy.lock`, waiting up to 900 s, as the old deploy did). It fetches `origin/main`.
   - It refuses, with exit 3, a sha that is unknown, that is neither `origin/main` nor an ancestor of it, or that is **older than the live sha**. A late, queued CI run therefore can't roll prod back. `ALLOW_OLDER=1`, set by hand, allows a deliberate rollback.
   - It checks the sha out detached in `/opt/pundit`.
2. **Build and start.** It builds `pundit-api:<sha>`, reusing the image if one exists, while the old container keeps serving. It then starts the idle colour. The first run moves from `pundit-api-1` to blue.
3. **Health gate.** It polls `http://127.0.0.1:<port>/ready` until it returns 200 and `/version` reports the sha, for up to `READY_TIMEOUT` (300 s). On timeout or a crash, it stops the new container and exits 4. The old one never stopped serving.
4. **Switch.** It writes `upstream.caddy` atomically. The `caddy/` directory is bind-mounted, so the rename is visible inside the container. It then runs `docker compose -p pundit exec -T caddy caddy reload` (graceful). If the reload fails, it restores the old upstream and exits 5.
5. **Verify through Caddy.** It polls `https://134-209-121-101.sslip.io/version` until it shows the sha, for up to 60 s. If it doesn't, it rolls Caddy back and exits 6.
6. **Retire.** It waits 20 s (drain), then runs `docker stop -t 25` on the old container. The stopped container is kept for a manual rollback. It keeps the newest 3 sha-tagged images and runs `docker image prune -f`.

The script is idempotent: if the active colour already runs the sha and the public `/version` shows it, it logs `already live` and exits 0. Each step is logged to stderr, which shows in the Actions log, and to `state/swap.log`.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | other error |
| 2 | bad request or config |
| 3 | sha refused |
| 4 | not ready |
| 5 | Caddy reload failed |
| 6 | public verify failed |

## Shared `/data` during the overlap (about 1–2 min per deploy)

Both colours mount `/opt/pundit-data`, and the API's background jobs start as soon as the server listens (`packages/api/src/index.ts:307-318`). Those start functions also do the initial load that `/ready` waits on, so the new container can't hold its scheduler back without a new flag. Running two writers for the overlap is safe, for these reasons:

- **Every `/data` writer that runs in prod goes through `writeJsonFileAtomic`** (`services/persistent-store.ts`). That covers the football schedule, club ratings, fixture registry, club-season ledger and checkpoint state, and match dossiers. Before this change, its temp file was `<file>.<pid>.tmp`. Both containers run node as **PID 1**, so two concurrent writes would have shared one temp file and could have renamed interleaved bytes into place. `readJsonFile` turns a corrupt ledger into `null`, and `loadClubSeasonEvaluationArtifact` then starts an empty ledger. The temp name now adds a `randomUUID()`, and the temp file is removed on failure. `persistent-store.test.ts` covers both.
- **The club-season ledger is the only append-only history.** `updateClubSeasonSnapshots` (`club-season-snapshots.ts:762`) re-reads the file on every call and does read→merge→write synchronously, with no `await` in between. Its merge is idempotent by `forecastId`: identity excludes refresh time (`club-season-snapshots.ts:666-670`). Two containers with the same inputs therefore write the same rows. A lost update would need both writes to land in the same few milliseconds, and the survivor's next 15-minute tick re-merges from disk.
- Everything else is an idempotent overwrite of freshly fetched data, or a per-fixture or versioned file. The prospective collector and friendly-shadow ledger are off in prod (`PROSPECTIVE_MODEL_CAPTURE=false`, `FRIENDLY_SHADOW_ENABLED=false`). The friendly ledger also takes its own `.lock`.

## Operating

```bash
/opt/pundit-deploy/deploy.sh <sha>                       # deploy an exact commit by hand
ALLOW_OLDER=1 /opt/pundit-deploy/deploy.sh <older sha>   # deliberate rollback (same health gate)
cat /opt/pundit-deploy/state/active-colour /opt/pundit-deploy/state/active-sha
tail -50 /opt/pundit-deploy/state/swap.log
docker logs -f "pundit-api-$(cat /opt/pundit-deploy/state/active-colour)"
```

The scripts run from **pinned copies**, because `swap.sh` runs `git checkout` on `/opt/pundit` and bash must not execute a file that is being rewritten under it. After a merge that changes `deploy/do/*.sh`, `swap.sh` logs a NOTICE. Reinstall the scripts:

```bash
git -C /opt/pundit show origin/main:deploy/do/swap.sh   > /opt/pundit-deploy/bin/swap.sh
git -C /opt/pundit show origin/main:deploy/do/deploy.sh > /opt/pundit-deploy/deploy.sh
```

**Capacity:** each API container has `mem_limit: 1g`. During the gate, two run on the 2 GB droplet (+2 GB swap), alongside Caddy (256 MB). Building the image while the old container serves is the same load as the old deploy.
