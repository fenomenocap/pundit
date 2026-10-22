# DigitalOcean API deploy: health-gated blue/green swap

`deploy-do.yml` SSHes to the droplet after CI passes on `main`. The deploy key
is pinned by an `authorized_keys` forced command to `deploy.sh`, which only
accepts a commit sha and hands it to `swap.sh`. `swap.sh` brings the new build
up next to the old one and only moves traffic once the new container is ready,
so a deploy no longer causes a window of HTTP 502s.

| File | Installed on the droplet as | Role |
| --- | --- | --- |
| `deploy.sh` | `/opt/pundit-deploy/deploy.sh` | SSH forced command. Parses `$SSH_ORIGINAL_COMMAND` strictly. |
| `swap.sh` | `/opt/pundit-deploy/bin/swap.sh` | The swap itself. |
| `swap.conf.example` | `/opt/pundit-deploy/swap.conf` | Non-secret settings (paths, service name, ports). |

Both scripts run from **pinned copies** outside the git checkout. `swap.sh`
runs `git checkout` on the build tree, and bash must never execute a file
that is being rewritten under it. A change to these scripts only takes
effect when it is reinstalled by hand. `swap.sh` logs a NOTICE when the
deployed commit's copy differs from the one running.

## What one deploy does

1. **Resolve the commit.** `deploy.sh` accepts only `<sha>`, `deploy <sha>`,
   or (while `ALLOW_TIP_DEPLOY=1`) the legacy bare `deploy`. Anything else
   exits 2. `swap.sh` fetches `origin/main` and refuses (exit 3) a sha that is
   not a commit, or is neither `origin/main` nor an ancestor of it. It also
   refuses a sha older than the live one (an ancestor of `active-sha`), so a
   late, queued CI run cannot roll prod back. A deliberate rollback sets
   `ALLOW_OLDER=1` by hand. It then checks the sha out detached in `REPO_DIR`.
2. **Start the idle colour.** It builds `pundit-api:<sha>`, reusing the image
   if it already exists. It then starts compose project `pundit-api-<colour>`
   from the existing compose service through a generated override. The
   override sets the image tag, the container name `pundit-api-<colour>`,
   `GITHUB_SHA`/`BUILD_SHA=<sha>` so `/version` is exact, and a loopback port:
   blue `127.0.0.1:3101`, green `127.0.0.1:3102`. The first run moves from
   the pre-swap ("legacy") container to blue.
3. **Health gate.** It polls `/ready` on the new port until it returns 200 and
   `/version` reports the sha. The timeout is `READY_TIMEOUT` (300 s). On
   timeout or a crash it stops the new container, leaves the old one serving
   and exits 4.
4. **Switch.** It rewrites `UPSTREAM_FILE` (`reverse_proxy <new upstream>`),
   which the Caddyfile `import`s, and runs `caddy reload`. That reload is
   graceful: connections already in flight finish on the old upstream. If
   the reload fails, it restores the old upstream, stops the new container
   and exits 5.
5. **Verify through Caddy.** It polls `PUBLIC_URL/version` until it shows the
   sha, waiting up to `VERIFY_TIMEOUT` (60 s). If it never does, Caddy is
   rolled back and the script exits 6.
6. **Retire the old colour.** It waits `DRAIN_SECONDS` (20 s, which matches
   the API's graceful shutdown) and then stops the old container. The
   stopped container is kept for a fast manual rollback. Only the newest
   `KEEP_IMAGES` sha-tagged images are kept.

The script is **idempotent**. If the active colour already runs the sha and
the public `/version` shows it, it logs `already live` and exits 0. A `flock`
on `STATE_DIR/swap.lock` serialises runs. Every step is logged to stderr,
which shows in the Actions log, and to `STATE_DIR/swap.log`.

Exit codes: 0 ok · 1 other · 2 bad request/config · 3 sha refused · 4 not ready · 5 caddy reload failed · 6 public verify failed.

## Operating

```bash
/opt/pundit-deploy/deploy.sh <sha>             # deploy one exact commit by hand
cat /opt/pundit-deploy/state/active-colour /opt/pundit-deploy/state/active-sha
tail -50 /opt/pundit-deploy/state/swap.log
```

**Rollback** means redeploying an older sha by hand on the droplet:
`ALLOW_OLDER=1 /opt/pundit-deploy/deploy.sh <older sha>`. It goes through the
same health gate. Over SSH, the forced command never gets `ALLOW_OLDER`.

**Upgrading the scripts** after a merge that changes `deploy/do/`:

```bash
install -m 0755 /opt/pundit-deploy/pundit/deploy/do/swap.sh /opt/pundit-deploy/bin/swap.sh
install -m 0755 /opt/pundit-deploy/pundit/deploy/do/deploy.sh /opt/pundit-deploy/deploy.sh
```

**Capacity:** for the length of the health gate, two API containers run at
once, so the droplet needs enough memory for both.

**Requirements on the droplet:** Docker Compose ≥ 2.24.4 (the override uses
`!override`), `git`, `curl`, `flock`, and the Caddyfile importing
`UPSTREAM_FILE`. The API service must use bind mounts, not named volumes,
for shared data such as `/opt/pundit-data`. Named volumes are scoped per
compose project, so each colour would get a fresh, empty one.
