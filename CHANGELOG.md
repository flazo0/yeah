# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is pre-1.0 and does not follow semantic versioning yet; entries are grouped by release.

## [Unreleased]

### Added

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
