# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is pre-1.0 and does not follow semantic versioning yet; entries are grouped by release.

## [Unreleased]

### Added

- Container status-change notifications (`container.status`): opt-in per channel, reports when a container of an application, database or service goes running to exited/restarting/unhealthy and back, debounced over two polls and limited to one message per container every 5 minutes.
- The `ws` service is now authenticated and scoped: it requires the session cookie, checks the upgrade `Origin` against `WEB_ORIGIN`, and relays each event only to members of the owning team. It now needs `DATABASE_URL` (already wired in `docker-compose.prod.yml`). The web client reconnects with backoff.
- Audit log: API-token calls (including `/api/v1`) are attributed to the token by name, MCP deploy/backup tools are recorded, and sign-ins, failed attempts, passkey sign-ins and sign-outs are logged with the client IP (migration `0061_audit_ip`).
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

### Known limitations

- Several features were verified with unit tests only and have not been exercised on real infrastructure yet; see [docs/roadmap.md](docs/roadmap.md#verification-status).
