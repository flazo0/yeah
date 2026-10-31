# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is pre-1.0 and does not follow semantic versioning yet; entries are grouped by release.

## [Unreleased]

### Added

- Rollback to a Docker image still on the server: an application can keep the image of its last N successful deployments (Advanced tab, off by default), the Deployments tab lists them (tag, size, age, deployment, running one) and rolls back to one without cloning or building, and the daily Docker cleanup with image pruning no longer deletes those images. Only unit tested so far (migration `0063_rollback_images`).
- A proxy-wide custom error page (opt-in per server, *Proxy* tab): unknown domains (404) and unreachable backends (502/503/504) get a neutral page with an optional operator title and message (HTML-escaped) instead of Traefik's plain responses. Off by default; turning it on restarts the proxy briefly. Only unit tested so far (migration `0063_proxy_error_page_service_maintenance`).
- Maintenance mode for services and Compose stacks (per service, optionally limited to some containers): the domains answer the 503 notice page through the waker while the stack keeps running, applied without a redeploy. Only unit tested so far.
- Container status-change notifications (`container.status`): opt-in per channel, reports when a container of an application, database or service goes running to exited/restarting/unhealthy and back, debounced over two polls and limited to one message per container every 5 minutes.
- The `ws` service is now authenticated and scoped: it requires the session cookie, checks the upgrade `Origin` against `WEB_ORIGIN`, and relays each event only to members of the owning team. It now needs `DATABASE_URL` (already wired in `docker-compose.prod.yml`). The web client reconnects with backoff.
- SQLite as a standalone database: a file on a Docker volume held by a small container, with a health check, scheduled `.dump` backups, restore, and one-click connection to an application on the same server (volume mount plus `DATABASE_URL`). Only unit tested so far (migration `0062_sqlite_database`).
- Audit log: API-token calls (including `/api/v1`) are attributed to the token by name, MCP deploy/backup tools are recorded, and sign-ins, failed attempts, passkey sign-ins and sign-outs are logged with the client IP (migration `0061_audit_ip`).
- Container file browser for services (per container of a stack) and databases, plus save, upload, create folder and delete for applications, services and databases. Writes are off unless `FILE_BROWSER_WRITES=true` (upload cap `FILE_BROWSER_UPLOAD_MAX_MB`), limited to 2 MB text edits, refuse binary content and sensitive paths, need an explicit delete confirmation and are audit-logged by action. Only unit tested so far.
- Initial public release of the control plane: `api`, `worker`, `ws` and `web` processes, the `yeah` CLI, and the shared packages.
- Deployments from Git (public URL, GitHub App, Git sources, deploy keys), Docker images, pasted Dockerfiles, Docker Compose, Nixpacks, Railpack and static sites, with live logs, rollbacks, preview deployments and remote build servers.
- One-click databases (PostgreSQL, MySQL, MariaDB, Redis, KeyDB, Dragonfly, MongoDB, ClickHouse) with scheduled backups, restore, and S3-compatible storage.
- A catalog of 380 one-click service templates, plus custom Compose stacks.
- Automatic HTTPS through a per-server Traefik proxy, wildcard domains, Let's Encrypt, www redirects, password protection and maintenance mode.
- Scale to zero: idle applications stop and wake on the next request (opt-in per application).
- Server monitoring, container health alerts, OS patch checks, Docker image management, web terminal and a read-only container file browser.
- Notifications (Discord, Slack, Telegram, ntfy, Pushover, e-mail, webhooks) and log drains (Loki, Axiom, New Relic, Fluent Bit, AWS CloudWatch).
- Security: AES-256-GCM encryption at rest with key rotation, TOTP 2FA, passkeys (WebAuthn), optional per-team 2FA enforcement, scoped API tokens, rate limiting and an audit log.
- Pre-update safety checks (disk space guard, database dump) in `yeah update`.
- English as the default interface language, with an optional Portuguese translation.
- Project documentation: README, contributing guide, security policy, code of conduct and the `docs/` folder.
- Memory guard (optional, per server): when RAM stays above a threshold, stops the least important applications and services first (priority low, then normal; critical and databases are never stopped) and starts them again once memory recovers. Priority is set per application and service. Actions are written to the audit log and sent as notifications.
- Server capacity card (*Metrics*): adds up the memory limits of everything on a server against the RAM it has and flags servers that promise more than they can give. The metrics check now also reports the server's total memory.
- Documentation: [small-server.md](docs/small-server.md) (running many projects on 1 vCPU / 4 GB, with what is measured and what is not) and [coolify-comparison.md](docs/coolify-comparison.md) (feature gaps against Coolify 4.5.3).
- A domain with automatic HTTPS for the panel itself (*Settings → Panel domain*): served through the Traefik of the server that hosts the panel with a Let's Encrypt certificate, with a DNS check, and without touching `.env`. The panel accepts the domain as a browser origin (CORS, WebSocket, passkeys, terminal) and marks the session cookie `Secure` for requests that arrive over HTTPS.
- A *Get started* checklist on the dashboard for a new installation: add a server, activate the proxy, deploy the first resource and (when the panel runs on a managed server) give the panel its own domain. It reads the real state, links to each step and can be hidden.
- `yeah reset-password [email] [--disable-2fa]` for a lost password (and a lost authenticator): runs on the host, needs no e-mail, signs the account out everywhere and prints a generated password once. The password is only ever read from `YEAH_NEW_PASSWORD`, never from the command line.
- Scheduled backup of the panel's own database to S3 (*Settings → Panel backup*): daily at a chosen UTC hour, with retention, *Back up now* and a failure notification. Streamed, so it does not load the dump into memory. Includes the restore steps in the troubleshooting guide and a warning that a backup is useless without the `ENCRYPTION_KEY` from `.env`.

### Fixed

- Service templates converted from Coolify: `${VAR:?value}` is now a default (`${VAR:-value}`) instead of a mandatory variable (Palworld, Satisfactory, Convex, Healthchecks), Deno KV uses a named volume instead of `COOLIFY_VOLUME_APP`, and every template now passes `docker compose config` (the remaining 18 failures are variables that are required on purpose).
- The API failed to start because the container file browser routes named the resource id `:resourceId` while the application, service and database routes on the same path use `:applicationId`, `:serviceId` and `:databaseId`. A test now compiles every route module together so this cannot slip through again.
- Database backups to S3 and restores from S3 no longer load the whole file into the worker's memory (a large dump could exhaust the worker on a small server): they are streamed in both directions, and so are backup downloads through the API. Measured against a real SSH server and S3: sending 200 MB to S3 grew the process by 25 MB, restoring 400 MB from S3 grew it by 31 MB. Writing to the server now goes through a `cat` on an SSH channel instead of SFTP, which is also about 20 times faster.
- The sidebar showed only *Dashboard* on the landing page; Servers, Projects, Settings and the other sections now appear there too.
- A migration whose timestamp is older than the previous one is skipped silently by drizzle; a test now checks that the journal only moves forward.
- Production compose is sized for small hosts: PostgreSQL tuned for about 18 connections, Redis capped at 128 MB, a database pool of 6 per service.

### Known limitations

- Several features were verified with unit tests only and have not been exercised on real infrastructure yet; see [docs/roadmap.md](docs/roadmap.md#verification-status).
