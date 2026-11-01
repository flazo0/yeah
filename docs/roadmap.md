# Roadmap

What `yeah` does today, what has and has not been verified on real infrastructure, and what is planned. The project is pre-1.0.

## What exists

| Area | Capabilities |
|---|---|
| **Applications** | Git (public URL, GitHub App, Git sources, deploy keys), Docker image, pasted Dockerfile, Docker Compose, Nixpacks, Railpack, static sites; live logs; rollbacks; preview deployments per pull request; deploy webhooks; `[skip ci]` handling; remote build servers with a registry; stop grace period; configurable healthchecks; build vs runtime variables; scheduled tasks; web terminal; read-only container file browser; clone, move between environments, move between servers |
| **Databases** | PostgreSQL, MySQL, MariaDB, Redis, KeyDB, Dragonfly, MongoDB, ClickHouse, SQLite (a file on a volume, mounted into applications); scheduled backups with count/age/size retention; local or S3 storage; restore and upload; optional external access with TLS |
| **Services** | 380 one-click templates imported from the Coolify catalog, custom Compose stacks, per-container domains, stack config files, volume backups |
| **Networking** | Per-server Traefik (File Provider), wildcard domains, Let's Encrypt, extra domains, www redirects, per-application password protection and maintenance mode, scale to zero, Cloudflare Tunnel for the panel, private environment network |
| **Servers** | SSH servers (generated or stored keys), VPS creation at DigitalOcean and Vultr, metrics (live and history), traffic analytics, container health alerts, Docker cleanup, CA certificates, OS patch checks with optional automatic security updates, Docker image management |
| **Operations** | Notifications (Discord, Slack, Telegram, ntfy, Pushover, e-mail, webhook) with per-event filters; log drains (Loki, Axiom, New Relic, Fluent Bit, CloudWatch); update checks for the platform and Docker images; pre-update disk and backup guard |
| **Security** | Encryption at rest with rotation, TOTP 2FA, passkeys, per-team 2FA enforcement, scoped API tokens, rate limiting, audit log, optional log redaction |
| **Automation** | Token-based CI API with OpenAPI and Swagger UI, `yeah` CLI, MCP server, preview comments on pull requests |
| **Organisation** | Teams, projects, environments, shared variables with scopes, tags, global search, English and Portuguese UI |

## Verification status

Everything above is covered by unit tests, `tsc` and `vue-tsc`. There is no automated end-to-end suite; the core flows (deployments, databases, backups, the proxy) were exercised by hand during development.

The following were verified **only** with unit tests and local fakes, and still need a run against real infrastructure:

- scale to zero: wake latency and the stop sweep against a real Docker daemon and Traefik (the waker is tested against a fake Docker API),
- the 32 service templates that ship configuration files (for example Supabase, Dify, SigNoz) — the importer converts them, but none has been through `docker compose config` or a real start,
- OS patch checks, automatic security updates, Docker image removal and the pre-update guard on a real host,
- HTTP basic auth: that Traefik accepts the generated bcrypt hashes,
- `db:rekey` on a database with real data, and team-wide 2FA enforcement end to end,
- the AWS CloudWatch log drain (the SigV4 signer is checked against AWS's published test vector, not against the service),
- passkey registration and sign-in with a real authenticator,
- the container file browser against real containers,
- SQLite databases: the holder container (the `keinos/sqlite3` image with its entrypoint replaced, run as root), the `sqlite3 .dump` backup and restore, and connecting an application (volume mount plus `DATABASE_URL`) are only unit tested on the generated commands. Nothing has run on a real Docker host, and the image's tags and shell have not been checked.

If you run any of these, a report of what worked and what did not is a valuable contribution.

## Planned

- **Secret-manager integrations**: remote references resolved at deployment time (Vault, Infisical, AWS Secrets Manager). Needs a provider decision and testing against a real one.
- **Skip the Compose build when images did not change**, and **drain seconds** for rolling updates. Optimisations that need to be measured on real builds.
- **List the Docker images of recent deployments for rollback** (rollback currently uses the deployment history).
- **A proxy-wide custom error page** (generic 404/502 for any domain) and maintenance mode for services and stacks.
- **Container name prefix**: readable names instead of `yeah-app-<id>`. Deferred on purpose: the current name is the key for routing, the waker, metrics and backups, so changing it is a migration.
- **A private per-user WebSocket channel** (the socket currently carries state and log events only, filtered client-side).
- **Generic container status-change notifications**, and a file browser for services and databases, with upload and edit.
- **Evaluate a single-node Swarm mode** to get rolling updates and multi-host networks.

## Not planned (product decisions)

- Multi-user teams, invitations, OIDC/SSO and hosting third parties on the same instance: `yeah` is single-admin on purpose.
- Billing and payments, managed DNS, self-hosted GitHub Actions runners and a draggable canvas view.
- Instance-to-instance migration and VPS creation at further providers.

Suggestions are welcome through issues; see [CONTRIBUTING.md](../CONTRIBUTING.md).
