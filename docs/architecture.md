# Architecture

## Overview

`yeah` is a control plane that orchestrates remote servers over SSH. It never runs your application itself; it tells the remote server to run it with Docker. You point it at a server with an SSH key and it handles the rest — deployments, database provisioning, backups, the reverse proxy — by sending commands over SSH. There is no agent on the managed servers.

```
┌─────────────┐      HTTP       ┌──────────┐     enqueues jobs      ┌────────┐
│  web (Vue)  │ ───────────────▶│   api    │ ──────────────────────▶│ Redis  │
└─────────────┘                 │ (Elysia) │                        │(BullMQ)│
       ▲                        └────┬─────┘                        └───┬────┘
       │ WebSocket                   │ reads/writes                     │ processes
       │                             ▼                                  ▼
┌─────────────┐   Redis pub/sub ┌──────────┐                      ┌──────────┐
│     ws      │◀────────────────│ Postgres │                      │  worker  │
└─────────────┘                 └──────────┘                      └────┬─────┘
                                                                       │ SSH
                                                                       ▼
                                                                ┌───────────────┐
                                                                │ managed server│
                                                                │   (Docker)    │
                                                                └───────────────┘
```

### Where the panel runs relative to the servers

The panel (api, worker, ws, web, Postgres, Redis) and the managed servers are independent. The worker is the only component that speaks SSH, and it treats every target as remote: it never assumes a local Docker socket, not even for the "Local server", which is just a row in `servers` pointing at `host.docker.internal`. That is why you can install only the panel on one machine and never register that machine as a server (`install.sh --control-plane-only`, see [installation.md](installation.md)).

One piece changes in that mode: `createLocalhostServerIfConfigured` (`apps/api/src/lib/localhostServer.ts`) only creates the "Local server" — flagged `is_platform_host` — when `LOCALHOST_SSH_PRIVATE_KEY_BASE64` is present in the environment, and the installer only writes that variable outside control-plane-only mode. Without a server flagged `is_platform_host`, the "update platform / update system" operations (which act over SSH on that server) answer 409 `no_platform_host` and the *Updates* page hides those buttons: the panel updates itself with `yeah update` on its own machine.

The connection always goes from the panel to the server (outbound from the panel, SSH port open on the server). The managed server must therefore be reachable over SSH; this is why `yeah` stays agentless instead of using an agent that dials back.

## Why four processes

- **`api`** (Elysia) — HTTP only. It does not run long SSH jobs. It makes a few short, synchronous SSH calls where the browser is already waiting (backup download, container file listing, Docker image listing, teardown on delete); anything long or periodic goes through the worker.
- **`worker`** (BullMQ) — runs deployments, provisioning, backups, restores and every periodic check. If it goes down, jobs queue up and wait; the API keeps answering.
- **`ws`** — a dedicated WebSocket process. It subscribes to a Redis channel (`SERVER_EVENTS_CHANNEL`) where `api` and `worker` publish events, and relays them to browsers, each event only to members of the owning team (the socket is authenticated by the session cookie; see [security.md](security.md)). It is separate from the API so it does not compete with regular HTTP requests for connections or threads.
- **`web`** — a Vue 3 single-page app that talks to `api` through `fetch` and to `ws` through a native WebSocket.

The split exists for robustness, not premature performance: a stuck deployment in the worker does not take down the API or block anyone looking at the dashboard.

## Bun instead of Node — where it matters

- **Native Postgres driver** (`drizzle-orm/bun-sql`) — no `pg` / `postgres.js` at runtime (only as a dev dependency of the `drizzle-kit` CLI).
- **`Bun.password`** (argon2id) for password hashing — no compiled `bcrypt` / `argon2` dependency.
- **`Bun.S3Client`** — a native S3 client that works with any S3-compatible service (AWS, MinIO, R2, Spaces) through `endpoint`. No `@aws-sdk/*`.
- **Native WebSocket** (`Bun.serve({ websocket })`) in `ws`.
- **`node:crypto`** where it makes sense (RS256 GitHub App JWTs, webhook HMAC) — Bun is fully compatible there.

## Shared packages (`packages/`)

| Package | Used by | Purpose |
|---|---|---|
| `db` | all | Drizzle schema, migrations, Postgres client, secret encryption |
| `shared` | all | TypeScript types, `DATABASE_ENGINES`, `SERVICE_CATALOG`, shell quoting, command builders and parsers (deliberately free of heavy dependencies so pure logic can be tested without loading `ssh2`) |
| `queue` | api, worker, ws | BullMQ queue definitions and Redis pub/sub |
| `ssh` | worker, api (short calls) | SSH client (ssh2) |
| `storage` | api, worker | Thin wrapper over `Bun.S3Client` |
| `github` | api, worker | GitHub App JWTs, installation tokens, webhook verification |
| `notifications` | worker | Discord, Slack, Telegram, ntfy, Pushover, e-mail (SMTP via `nodemailer`) and generic webhook senders — best effort, never throw |
| `logdrains` | api, worker | Log forwarding to Loki, Axiom, New Relic, Fluent Bit and AWS CloudWatch (with a dependency-free SigV4 signer) |
| `templates` | api | The one-click service catalog (`services/*.yml`) |

## Domain model

```
User ──┬── TeamMember ──── Team ──┬── Server (SSH, per team — shared across projects)
       │                          ├── S3Storage (per team — backup destination)
       │                          ├── GithubInstallation (0 or 1 per team)
       │                          ├── NotificationChannel (per team)
       │                          └── Project ──── Environment ──┬── Application
       │                                                         ├── Database ──┬── BackupSchedule
       │                                                         │             └── BackupExecution
       │                                                         └── Service (catalog template or Compose stack)
       └── Session (cookie)
```

- **Team → Project → Environment → Resource** is the same hierarchy Coolify uses. Every new team gets a `Default` project with a `production` environment, so there is never a dead end with nowhere to put a resource.
- **`User` / `TeamMember` / roles exist, but `yeah` is single-admin on purpose.** `POST /auth/register` only works while no user exists (`hasAnyUser()` in `apps/api/src/routes/auth.ts`), and there is no invitation route. The team model remains because every resource is scoped by `teamId`, not because more than one user is expected.
- **The machine running `yeah` can register itself as the first `Server`.** When the (only) admin account is created, `createLocalhostServerIfConfigured()` inserts a `Server` pointing at `host.docker.internal`, using an SSH key that `install.sh` generates and authorizes in the host's `~/.ssh/authorized_keys`. The worker reaches it through `extra_hosts: host-gateway` (`docker-compose.prod.yml`). Without `LOCALHOST_SSH_PRIVATE_KEY_BASE64` in `.env`, this step is silently skipped.
- **A `Server` belongs to the team, not to a project** — one physical server is shared by several projects and environments.
- **`Application.domain` null** = the port is published directly on the host (`-p port:port`). **Set** (manually or derived from the server's `wildcardDomain`) = routed through Traefik, no port published.
- **`Database.username` / `databaseName` are nullable** because Redis has neither; see `DATABASE_ENGINES` in `packages/shared/src/types.ts` for the fields each engine uses.
- **SQLite is a database with no server** (`fileBased` in `DATABASE_ENGINES`). Provisioning starts a small long-lived holder container (`keinos/sqlite3` with its entrypoint replaced) that owns the data volume `yeah-db-<id>-data`, creates `/data/<databaseName>.db`, and makes the `sqlite3` CLI available for the health probe (`SELECT 1`), the backup (`sqlite3 .dump`, compressed to `.sql.gz`) and the restore (a fresh file loaded from the dump). It publishes no port and has no TLS or public access (`port` is stored as 0). Applications reach it through a storage row of kind `database` whose `hostPath` is that volume's name; `POST .../databases/:id/connect-application` creates it together with the `DATABASE_URL` variable, and deleting the database deletes those rows.
- **`BackupSchedule.storageId` null** = the dump stays on the remote server's disk. **Set** = it is uploaded to S3 and the local copy removed.
- **`Service`** has the same shape as Application/Database (name, server, environment, optional domain), but its image/port/env come from a catalog template (`packages/templates`) or a custom Compose stack, instead of a repository build or a built-in database engine.
- **`Server.cpuPercent / memPercent / diskPercent / metricsCheckedAt`** are the latest reading of the periodic `server-metrics` job — a snapshot; history lives in a separate samples table.
- **`memoryLimitMb` / `cpuLimit`** (`resourceLimitColumns()` in `packages/db/src/schema/columns.ts`) are nullable: both `null` means no limit. When set they become `--memory=<mb>m` / `--cpus=<cpu>` on `docker run` via `resourceLimitFlags()`.

## Deployment flow

1. The user clicks "Deploy". `POST .../deploy` creates a `deployments` row (status `queued`) and enqueues an `application-deploy` BullMQ job.
2. The worker picks the job up and connects to the application's server over SSH.
3. It writes the application's `.env` over SFTP.
4. It clones or updates the repository (`git clone`, or `fetch` + `reset --hard`). For GitHub App applications it first mints a fresh installation token (valid for one hour, never stored) and runs `git remote set-url origin` with the token before each fetch/clone.
5. It builds the image (`docker build` from the repository's Dockerfile, a pasted Dockerfile, Nixpacks, Railpack, or `docker pull` for an image) — or `docker compose up` for Compose applications.
6. It stops the previous container (honouring the configured stop grace period) and starts the new one: with a domain it joins the `yeah-proxy-net` network and a Traefik dynamic config file is written; without a domain it publishes the port on the host.
7. It waits for the healthcheck.
8. Every output line is published to Redis (`deployment.log`) and relayed by `ws` to the browser in real time (xterm.js).
9. At the end it updates `deployments.status` and `applications.status` and publishes `deployment.status`.

The same pattern (async job → SSH → live log → final status) repeats for database provisioning, backups, restores and proxy provisioning.

## Real-time events

A single Redis channel (`SERVER_EVENTS_CHANNEL`) carries every event type, multiplexed by a discriminated union (`WsServerEvent` in `packages/shared/src/types.ts`):

```ts
type WsServerEvent =
  | { type: "server.status"; serverId; status; dockerVersion? }
  | { type: "server.proxy"; serverId; proxyStatus }
  | { type: "server.metrics"; serverId; cpuPercent; memPercent; diskPercent }
  | { type: "deployment.log"; deploymentId; line }
  | { type: "deployment.status"; deploymentId; status }
  | { type: "database.status"; databaseId; status }
  | { type: "service.status"; serviceId; status }
  | { type: "backup.status"; executionId; scheduleId; status };
```

`api` and `worker` publish, `ws` subscribes and relays over plain WebSocket (no Socket.IO) to the connected clients whose user belongs to the team that owns the event's resource. The frontend (`apps/web/src/lib/ws.ts`) keeps a single shared connection and fans events out to listeners.

## Queues (BullMQ)

Each queue has its own pair of dedicated Redis connections (one to consume jobs, one only to publish events) so a connection blocked waiting for jobs never delays publishing. The main ones:

| Queue | Job data | What it does |
|---|---|---|
| `server-check` | `{ serverId }` | Tests the SSH connection, updates status and Docker version |
| `application-deploy` | `{ deploymentId }` | The deployment flow above |
| `database-provision` | `{ databaseId }` | `docker run` for the right engine |
| `database-backup` | `{ scheduleId, manual? }` | Dump, optional S3 upload, retention. Scheduled with a **BullMQ Job Scheduler** (`upsertJobScheduler` / `removeJobScheduler`); there is no custom scheduler |
| `proxy-provision` | `{ serverId }` | Starts Traefik on the server with the ACME configuration |
| `service-provision` | `{ serviceId }` | Writes stack files and runs `docker compose up` for a catalog template or custom stack |
| `server-metrics` | `{}` | A single system job scheduled at worker boot; every tick it reads `/proc/stat`, `/proc/meminfo` and `df` over SSH for each connected server |
| `tls-check` | `{}` | A single system job (every 24 h): connects with `node:tls` (no SSH) to every domain in use and alerts when a certificate expires in 14 days or less |

There are also queues for application lifecycle actions, scheduled tasks, database restores, volume backups, Docker cleanup, platform updates, CA certificates, log retention, traffic analytics, API token expiry, the Cloudflare tunnel and routing changes. A few periodic checks are plain timers inside the worker rather than queues — for example the OS patch check (`apt`, every 6 hours by default, see `PATCH_CHECK_INTERVAL_SECONDS`), which flags security and risky updates and notifies. Notifications have no queue: they are fired inline, fire and forget, from inside the jobs through `apps/worker/src/lib/notify.ts`. A failure to send (webhook down, wrong token) is logged and swallowed — it never fails the job that triggered it. Each channel can filter by `NotificationChannel.events` (`null` = receives every event type).

Rollback images: when an application sets `rollbackImages` above 0, each deploy of a built application also tags its image `yeah-app-<id>:dep-<12 hex of the deployment id>` and untags those of deployments beyond the newest N successful ones. A rollback created with `image: true` stores that ref in `deployments.rollback_image`; the worker then skips the clone and build, retags the image as the run name and starts it. The Docker cleanup, when image pruning is on and some application keeps rollback images, drops `-a` from `docker system prune` and removes only the unused images none of whose tags is protected. The tagging, parsing, matching and selection logic is pure and lives in `packages/shared/src/rollbackImages.ts`.

## Reverse proxy: two different levels

1. **Per managed server** (`provisionProxy.ts`, Traefik): each server can enable its own Traefik, which routes the *applications you deploy*. Routing is written as one file per application in `/opt/yeah-proxy/dynamic/<container>.yml` (Traefik's file provider); containers carry `traefik.enable=false`. The worker provisions it over SSH.
2. **`yeah` itself** (production, `docker-compose.prod.yml` + `install.sh`, nginx): the `web` container embeds an nginx that reverse-proxies `/api/*` and `/ws` to the `api` / `ws` containers internally (`apps/web/nginx.conf`); `api` and `ws` are only bound to `127.0.0.1` on the host. Only the `web` port needs to be reachable. This also means the frontend never needs to know its own public host at build time (`lib/api.ts` and `lib/ws.ts` use relative paths). HTTPS or a custom domain in front of this is infrastructure for whoever hosts `yeah` (Caddy or an external nginx, see [installation.md](installation.md)) — separate from the Traefik in item 1, which is a product feature.

### Scale to zero (the waker)

For applications that opt in, routing points at a small proxy (`yeah-waker`, a Node container on the proxy network) instead of the application. The waker holds an incoming request, runs `docker start` on the application's container, waits for its TCP port and then forwards the request, so the visitor sees a slightly slower first response and no loading page. WebSocket upgrades work as well. A sweep every 15 seconds stops containers that were idle longer than their configured time. The same proxy serves the 503 page for maintenance mode. Applications without a domain, or with sleeping disabled, are routed directly and never go through it.

### `PANEL_PATH`: an optional secret path

Off by default — the dashboard answers at `/` like any app. To add a layer of obscurity, set `PANEL_PATH` in `.env` (for example `/a1b2c3d4`) and run `sudo yeah update`: the dashboard then only answers under that path, and any other URL on the same port (including `/`) gets nginx's `return 444` (connection closed, not even a valid HTTP response). A single variable drives everything when set: Vite's `base` (`vite.config.ts`, through `VITE_BASE_PATH`), the Vue Router base (`createWebHistory(import.meta.env.BASE_URL)`), the relative prefix in `lib/api.ts` / `lib/ws.ts`, and the nginx `location`, rewritten at container boot by `apps/web/docker-entrypoint-panel-path.sh` (a `/docker-entrypoint.d/` hook of the official nginx image) only when `PANEL_PATH` is not empty. It is a layer of obscurity on top of real authentication, not a replacement.

## The "API does not run long SSH jobs" rule

Every short synchronous SSH call from the API is commented in the code (`servers.ts`, `databases.ts`, `applications.ts`, `services.ts`, `applicationFiles.ts`, `serverOps.ts`). The deliberate cases:

- **Backup download**: a bounded, synchronous SFTP read — the browser is already waiting for the file, and routing it through a job plus a polling endpoint would only add latency.
- **Listings** (container files, Docker images, pending patches): short read-only commands the page is waiting for.
- **Deleting an Application / Database / Service**: container teardown (and the volume, for databases and persistent services) over SSH before the row is deleted. If SSH fails (server offline, wrong key), the delete proceeds anyway — Postgres cascades take care of the rest, and blocking the user because the remote container could not be cleaned up makes no sense.

## Security

The full security model is in [security.md](security.md): encryption at rest, authentication, rate limiting, the audit log and hardening notes.

## Design system

The frontend design system is a red palette (`--red-50..900`) defined twice in `apps/web/src/styles/main.css` — once in `:root` (light), once in `.dark`, with the dark ramp deliberately inverted to read well against black. The fonts (Google Sans Code and Material Symbols Outlined) are self-hosted in `apps/web/public/fonts/` and never loaded from a CDN, which keeps the page free of third-party requests (the Content-Security-Policy in `apps/web/index.html` enforces this). Screens follow Coolify's layout conventions: tabs and sub-menus on detail pages, a card grid on resource lists.
