# API reference

Base URL in development: `http://localhost:3000`. Authentication uses an httpOnly session cookie (`SESSION_COOKIE`); the token-based CI API is described [below](#ci-api-and-cli). Every authenticated route returns `401` without a valid session and `403` if the user is not a member of the team (`assertMember`).

Errors use `{ "error": "message" }` with the matching HTTP status. Success is usually `{ "ok": true }` or the serialized resource (`{ "server": {...} }`, ...). The exact shapes (`*Dto`) live in `packages/shared/src/types.ts`.

> This page documents the core resource routes. The route modules in `apps/api/src/routes/` are authoritative and also cover areas not listed here (SSH keys, Git sources, registries, tags, shared variables, log drains, scheduled tasks, volumes and volume backups, previews, the audit log, passkeys, team security, server operations such as patches and Docker images, and the container file browser). The token-based API has a machine-readable OpenAPI document (see below).

## Auth (`/auth`)

`yeah` is single-admin, not multi-tenant: `/auth/register` only creates the first (and only) account of the instance — see `/auth/setup-status`.

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/auth/setup-status` | — | `{ needsSetup: boolean }` — `true` while no user exists |
| POST | `/auth/register` | `{ email, password (≥8), name? }` | Creates the user, a personal team, an automatic `Default` / `production` project and environment, and the automatic local server (when `LOCALHOST_SSH_*` is configured — see [architecture.md](architecture.md)). Sets the session cookie. Returns `403` if any user already exists |
| POST | `/auth/login` | `{ email, password, code? }` | Sets the session cookie. Returns `code: "totp_required"` when 2FA is enabled and no `code` (TOTP or recovery code) was sent, and `code: "totp_invalid"` for a wrong one |
| POST | `/auth/logout` | — | Destroys the session |
| GET | `/auth/me` | — | The current user (`null` when signed out) |
| GET / POST / DELETE | `/auth/passkeys…` | — | Passkey (WebAuthn) registration and sign-in |

## Teams (`/teams`)

There is no invitation route — on purpose, a second person cannot gain a login on the instance.

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/teams` | — | The signed-in user's teams, with their role in each |
| POST | `/teams` | `{ name }` | Creates a team (the user becomes `owner`) with a default project and environment |

## Servers (`/teams/:teamId/servers`)

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/teams/:teamId/servers` | — | Lists the team's servers |
| POST | `/teams/:teamId/servers` | `{ name, host, port?, sshUser?, privateKey }` | Registers a server (initial status `pending`) |
| POST | `/teams/:teamId/servers/:serverId/test-connection` | — | Enqueues an asynchronous SSH check (`server-check`); the result arrives over WebSocket (`server.status`) |
| PUT | `/teams/:teamId/servers/:serverId/domain` | `{ wildcardDomain?, acmeEmail? }` | Sets the wildcard domain and the Let's Encrypt e-mail |
| PUT | `/teams/:teamId/servers/:serverId/memory-guard` | `{ enabled, threshold, recover }` | Optional memory guard (off by default). `threshold` 70-99 and `recover` ≥ 40 are percentages of memory in use; `recover` must be at least 5 points below `threshold` (400 otherwise) |
| POST | `/teams/:teamId/servers/:serverId/proxy` | — | Enqueues Traefik provisioning (`proxy-provision`); the result arrives over WebSocket (`server.proxy`) |

CPU, RAM and disk (`cpuPercent`, `memPercent`, `diskPercent`, `metricsCheckedAt` in `ServerDto`) are refreshed in the background by a system job (`server-metrics`, every 60 s per connected server). There is no route to trigger it by hand — only the latest value on the list `GET` and `server.metrics` WebSocket events.

## Instance settings (`/teams/:teamId/instance`)

Settings of the whole installation, reached through a team so that changes land in the audit log.

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/teams/:teamId/instance/panel-domain` | — | `{ domain, platformServer }`: the panel's own domain (or `null`) and the server that hosts the panel (`{ id, name, host, proxyActive, hasAcmeEmail }`, or `null`) |
| POST | `/teams/:teamId/instance/panel-domain/check` | `{ domain }` | Resolves the domain with the system resolver and compares it with the panel server's address: `{ domain, found, expected, matches }` |
| GET | `/teams/:teamId/instance/backup` | — | The panel-database backup settings and the result of the last run: `{ enabled, storageId, hourUtc, retention, lastAt, lastStatus, lastError, lastSizeBytes, hasPlatformServer }` |
| PUT | `/teams/:teamId/instance/backup` | `{ enabled, storageId, hourUtc (0-23, UTC), retention (1-90) }` | Saves the schedule. 400 when the storage is not in the team, when enabling without a storage, or without a server that hosts the panel |
| POST | `/teams/:teamId/instance/backup/run` | — | Queues a backup now, ignoring the schedule |
| PUT | `/teams/:teamId/instance/panel-domain` | `{ domain }` (`null` removes it) | Saves the domain and queues the proxy route. 400 when the name is not a public domain, when no server hosts the panel, or when its proxy is not active / has no Let's Encrypt e-mail |

## S3 storage (`/teams/:teamId/storages`)

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/teams/:teamId/storages` | — | Lists the team's S3 destinations (without `secretAccessKey`) |
| POST | `/teams/:teamId/storages` | `{ name, endpoint?, region?, bucket, accessKeyId, secretAccessKey }` | Creates a destination (empty `endpoint` = real AWS S3) |
| POST | `/teams/:teamId/storages/:storageId/test-connection` | — | Writes and deletes a marker object — synchronous, no worker |
| DELETE | `/teams/:teamId/storages/:storageId` | — | Removes the destination (schedules that pointed at it fall back to `storage_id = null` through `ON DELETE SET NULL`) |

## GitHub App

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/teams/:teamId/github` | — | `{ configured, installation }` — whether the server has `GITHUB_APP_*` and whether the team connected |
| GET | `/teams/:teamId/github/install-url` | — | URL to install the App on GitHub |
| GET | `/github/callback` | query: `installation_id, state, setup_action` | GitHub callback — saves the installation and redirects to the dashboard |
| GET | `/teams/:teamId/github/repos` | — | Lists the connected installation's repositories (mints an installation token on the spot) |
| DELETE | `/teams/:teamId/github` | — | Disconnects (does not uninstall the App on GitHub's side) |
| POST | `/webhooks/github` | raw body + header `X-Hub-Signature-256` | Receives push events, matches `installationId` + `repo` + `branch` and triggers a deployment |

## Notifications (`/teams/:teamId/notifications`)

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/teams/:teamId/notifications` | — | Lists the team's channels |
| POST | `/teams/:teamId/notifications` | `{ name, type: discord\|slack\|telegram\|webhook\|email\|ntfy\|pushover, url?, telegramBotToken?, telegramChatId?, smtpHost?, smtpPort?, smtpSecure?, smtpUser?, smtpPassword?, smtpFrom?, emailTo?, events? }` | Creates a channel. `url` for discord/slack/webhook/ntfy; `telegramBotToken` + `telegramChatId` for telegram; for e-mail, `smtpHost`, `smtpPort`, `smtpFrom` and `emailTo` are required and `smtpUser`, `smtpPassword`, `smtpSecure` optional — any SMTP server, no proprietary API. `smtpFrom` / `emailTo` accept both `email@domain.com` and `"Name <email@domain.com>"`. `events` is a list of event types (below); omitted or `null` = receives all |
| PUT | `/teams/:teamId/notifications/:channelId` | `{ enabled?, events?, smtp… }` | Enables/pauses, changes the event filter and/or updates the SMTP configuration without deleting the channel |
| POST | `/teams/:teamId/notifications/:channelId/test` | — | Sends a test message, returns `{ ok }` |
| DELETE | `/teams/:teamId/notifications/:channelId` | — | Removes the channel |

Secrets (`telegramBotToken`, `smtpPassword`, webhook URLs) never come back in a response.

Valid event types in `events`: `deploy.success`, `deploy.failed`, `backup.success`, `backup.failed`, `task.success`, `task.failed`, `server.down`, `server.reconnected`, `server.metrics` (CPU/RAM/disk crossed a threshold), `tls.expiring` (a certificate in use expires in 14 days or less), `docker-cleanup.success`, `docker-cleanup.failed`, `api-token.expiring`, `server.patches` (pending security updates), `container.unhealthy` (restart loop or out of memory), `container.status` (a container of an application, database or service changed status, for example running to exited or unhealthy and back; opt-in like the `*.success` events, debounced over two polls and at most one message per container every 5 minutes) and `traefik.outdated`.

## Updates

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/updates/platform` | — | `{ currentCommit, latestCommit, updateAvailable, compareUrl }` — compares `YEAH_COMMIT` (baked into the image at build time) with `main`'s HEAD on GitHub. All `null` when running outside a production container |
| GET | `/teams/:teamId/updates/images` | — | For every Docker image in use (the team's databases and services plus system images such as Traefik): `{ image, currentTag, latestTag, updateAvailable }` compared with Docker Hub. `quay.io` images return `updateAvailable: null` (not verifiable through that API) |

## Services (`/teams/:teamId/projects/:projectId/environments/:environmentId/services`)

One-click catalog templates (`packages/templates`) and custom Compose stacks, beyond the built-in database engines.

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `.../services` | — | Lists the environment's services |
| POST | `.../services` | `{ name, serverId, catalogKey \| templateKey \| composeContent, port?, memoryLimitMb?, cpuLimit? }` | Creates from a catalog entry, a saved template or raw Compose content (exactly one source), and enqueues provisioning |
| GET | `.../services/:id` | — | Detail |
| PUT | `.../services/:id/env` | `{ envContent }` | Replaces the raw `.env` |
| PUT | `.../services/:id/domain` | `{ domain? }` | Sets/clears a custom domain |
| PUT | `.../services/:id/limits` | `{ memoryLimitMb?, cpuLimit? }` | Sets/clears resource limits (`null` = no limit); applies on the next redeploy |
| PUT | `.../services/:id/priority` | `{ priority: "critical" \| "normal" \| "low" }` | Priority for the server's memory guard (default `normal`) |
| POST | `.../services/:id/redeploy` | — | Re-provisions with the current configuration |
| DELETE | `.../services/:id` | — | Removes the container and remote volume over SSH (best effort) and deletes the row |

## Projects and environments (`/teams/:teamId/projects`)

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/teams/:teamId/projects` | — | Lists projects with `environmentCount` |
| POST | `/teams/:teamId/projects` | `{ name, firstEnvironmentName? }` | Creates a project and its first environment (default `"production"`) |
| GET | `/teams/:teamId/projects/:projectId` | — | Project detail |
| GET | `/teams/:teamId/projects/:projectId/environments` | — | Lists environments with `applicationCount` / `databaseCount` / `serviceCount` |
| POST | `/teams/:teamId/projects/:projectId/environments` | `{ name }` | Creates an environment |

## Applications (`/teams/:teamId/projects/:projectId/environments/:environmentId/applications`)

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `.../applications` | — | Lists the environment's applications |
| POST | `.../applications` | `{ name, serverId, repoUrl? \| githubRepo? \| gitSourceId + gitRepo?, branch?, port?, memoryLimitMb?, cpuLimit? }` | Creates an application (exactly one source) |
| GET | `.../applications/:id` | — | Detail |
| PUT | `.../applications/:id/env` | `{ envContent }` | Replaces the raw `.env` (applies on the next deployment) |
| PUT | `.../applications/:id/domain` | `{ domain? }` | Sets/clears the domain |
| PUT | `.../applications/:id/limits` | `{ memoryLimitMb?, cpuLimit? }` | Sets/clears resource limits (`null` = no limit); applies on the next deployment |
| PUT | `.../applications/:id/sleep` | `{ sleepAfterMinutes? }` | Enables or disables sleep-when-idle (only for applications with a domain) |
| PUT | `.../applications/:id/priority` | `{ priority: "critical" \| "normal" \| "low" }` | Priority for the server's memory guard (default `normal`) |
| PUT | `.../applications/:id/protection` | `{ basicAuthUser?, basicAuthPassword?, maintenanceMode?, maintenanceMessage? }` | Password protection and maintenance mode |
| GET | `.../applications/:id/deployments` | — | History (last 20) |
| GET | `.../applications/:id/deployments/:deploymentId` | — | One deployment, with its full log |
| GET | `.../applications/:id/rollback-images` | — | Docker images of recent deployments still on the server (`{ enabled, supported, images[] }`: tag, size, created, deploymentId, commitSha, running), read over SSH |
| POST | `.../applications/:id/deployments/:deploymentId/rollback` | `{ image?: true }` | Roll back to a past deployment; with `image: true` the retained Docker image is reused with no clone or build (409 `image_missing` if it was removed). Retention is the `rollbackImages` field of `PUT .../advanced` (0-20, default 0) |
| POST | `.../applications/:id/deploy` | — | Enqueues a deployment (`application-deploy`) |
| DELETE | `.../applications/:id` | — | Removes the remote container over SSH (best effort) and deletes the row (cascades to `deployments`) |

## Databases (`/teams/:teamId/projects/:projectId/environments/:environmentId/databases`)

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `.../databases` | — | Lists the environment's databases |
| POST | `.../databases` | `{ name, serverId, engine?, image?, port?, username?, databaseName?, memoryLimitMb?, cpuLimit? }` | Creates and enqueues provisioning. `engine` defaults to `postgresql`; see `DATABASE_ENGINES` for per-engine defaults |
| GET | `.../databases/:id` | — | Detail |
| PUT | `.../databases/:id/limits` | `{ memoryLimitMb?, cpuLimit? }` | Sets/clears resource limits (`null` = no limit) and re-enqueues provisioning — the processor recreates the container idempotently, so the new limit applies immediately |
| GET | `.../databases/:id/backup-schedule` | — | Current schedule (or `null`) |
| POST | `.../databases/:id/backup-schedule` | `{ cron, timezone?, timeoutSeconds?, retentionCount?, retentionDays?, retentionSizeGb?, storageId? }` | Creates (409 if one exists) |
| PUT | `.../databases/:id/backup-schedule/:scheduleId` | same fields, all optional | Edits in place without deleting and recreating |
| DELETE | `.../databases/:id/backup-schedule/:scheduleId` | — | Removes the schedule and unregisters the BullMQ job scheduler |
| POST | `.../databases/:id/backup-schedule/:scheduleId/run-now` | — | Triggers a manual backup |
| GET | `.../databases/:id/backup-executions` | — | Last 50 executions |
| GET | `.../databases/:id/backup-executions/:executionId/download` | — | Local: streamed over SFTP. S3: 302 redirect to a presigned URL |
| DELETE | `.../databases/:id/backup-executions/:executionId` | — | Deletes the file (S3 or remote) and the row |
| POST | `.../databases/:id/connect-application` | `{ applicationId, envKey?, mountPath? }` | SQLite only: mounts the database's volume in an application of the same environment and server (a `database`-kind storage row, default `/data`) and sets `envKey` (default `DATABASE_URL`) to `file:<mountPath>/<name>.db`. Applies on the application's next deploy. 400 for other engines, Compose applications or another server |
| DELETE | `.../databases/:id` | — | Removes the remote container and volume over SSH (best effort), unregisters the BullMQ schedule, deletes the row (cascade) |

## Container file browser

The same routes exist under `.../applications/:id`, `.../services/:id` and `.../databases/:id`. For a service (a stack) every call also takes `?container=<compose service>`; `GET .../services/:id/files/containers` lists the choices. Browser-session only (not available to API tokens). Paths are absolute and canonical (no `..`, `.` or control characters). The write routes answer `403` unless the instance sets `FILE_BROWSER_WRITES=true`; see [security.md](security.md#container-file-browser-writes).

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `.../:id/files?path=` | — | Lists a folder: `{ path, entries, writable, maxEditBytes, maxUploadBytes }` |
| GET | `.../:id/files/content?path=&edit=1` | — | Reads a file: `{ binary, content, truncated, editable }`. Reads are cut at 256 KB (2 MB with `edit=1`); binary files return no content |
| PUT | `.../:id/file-save` | `{ path, content, create? }` | Saves a UTF-8 text file (up to 2 MB, no NUL bytes). `create: true` refuses to replace an existing file. Keeps the owner and mode of an existing file |
| POST | `.../:id/file-upload` | `{ dir, name, contentBase64, overwrite? }` | Uploads a file (cap `FILE_BROWSER_UPLOAD_MAX_MB`, 10 by default). `409` if it exists and `overwrite` is not `true` |
| POST | `.../:id/file-mkdir` | `{ path }` | Creates one folder (`409`-style failure if it exists or the parent is missing) |
| POST | `.../:id/file-delete` | `{ path, confirm }` | Deletes a file or a folder recursively. `confirm` must repeat `path` exactly. Top-level folders cannot be deleted |

Writes to `/`, `/proc`, `/sys`, `/dev` and `*.sock` files are always refused. Each write is recorded in the audit log by action only, never with the path or content.

## WebSocket (`ws`, separate port — `WS_PORT`)

Connect to `ws://<host>:<WS_PORT>`. The socket has no authentication of its own: it only carries events the signed-in user's frontend already filters by IDs it has loaded on screen (there is no private per-user channel yet; see [roadmap.md](roadmap.md)). Messages are the JSON of `WsServerEvent` (see [architecture.md](architecture.md#real-time-events)): `server.status`, `server.proxy`, `server.metrics`, `deployment.log`, `deployment.status`, `database.status`, `service.status` and `backup.status`.

## CI API and CLI

Authentication with a personal token (`Authorization: Bearer yeah_…`, created under Keys & Tokens). The prefix is `/teams/:teamId/ci` (or `/api/v1/teams/:teamId`, same thing). The OpenAPI document is at `/api/v1/openapi.json` and a Swagger UI at `/swagger`.

| Method | Route | Permission | Description |
|---|---|---|---|
| GET | `/applications`, `/databases`, `/services`, `/servers`, `/projects`, `/storages`, `/notification-channels`, `/scheduled-tasks` | read | Lists the team's resources (without secrets) |
| GET | `/applications/:id/deployments` | read | Last 10 deployments (status, no log) |
| GET | `/applications/:id/previews` | read | Previews (one per open pull request): id, PR, branch, domain, status |
| GET | `/applications/:id/previews/:previewId` | read | One preview with its last 5 deployments (status, no log) |
| POST | `/move-resource` | full | Moves an application, database or service to another environment of the team |
| POST | `/applications/:id/deploy?force=true` | full | Enqueues a deployment (409 `server_overloaded` without `force`) |
| POST | `/databases/:id/backup` | full | Triggers a backup (needs an existing schedule) |

CLI (`apps/cli`; `bun run --cwd apps/cli build` produces the `dist/yeah` binary): `yeah list apps|databases|services`, `yeah deploy <id> [--force]`, `yeah backup <id>`. Configured through the environment: `YEAH_URL`, `YEAH_TOKEN`, `YEAH_TEAM`.

## Rate limiting

Mutations (POST / PUT / PATCH / DELETE) are limited per IP (120 per minute; login and registration have their own stricter rules). When exceeded: HTTP `429` with `{ "error": … }` and a `Retry-After: <seconds>` header (exposed through CORS). The CLI prints that value. There are no `X-RateLimit-*` headers on successful responses.
