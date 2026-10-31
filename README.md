# yeah

**A self-hosted, open-source alternative to Heroku, Netlify, Vercel and Coolify.** Connect a server over SSH and deploy applications, databases and one-click services — with automatic HTTPS, scheduled backups to S3, auto-deploy on every Git push, and no agent running on your servers.

Bun + TypeScript end to end. Postgres, Redis/BullMQ for queues, a dedicated WebSocket process for real time, and a Vue 3 dashboard.

> **Project status: pre-1.0.** The code base is covered by unit tests (`bun test`, `tsc`, `vue-tsc`), but several features have not been validated against real infrastructure yet. [docs/roadmap.md](docs/roadmap.md) lists what is verified, what is not, and what is planned.

## Why

Most self-hosted platforms either need a lot of machine (a heavy agent, many layers) or are too complex to run on a small VPS. `yeah` is **agentless**: it only needs SSH and the Docker that your servers already have. The whole backend runs on Bun — native Postgres driver, native WebSocket, native password hashing, native S3 client — so it stays light even on a 1 GB machine.

## Features

**Deploy**
- Applications from a public Git URL, a GitHub App (auto-deploy on push), a Git source (GitLab / Bitbucket / Gitea), a deploy key, a Docker image, a pasted Dockerfile, Docker Compose, Nixpacks, Railpack or a static site
- Live build and deploy logs in the browser, rollbacks, preview deployments per pull request, deploy webhooks and a CI API
- Remote build servers with a container registry
- Scale to zero: idle applications stop and wake on the next request (opt-in per application)

**Data**
- One-click databases: PostgreSQL, MySQL, MariaDB, Redis, KeyDB, Dragonfly, MongoDB, ClickHouse
- Scheduled backups (cron) with retention, stored locally or in any S3-compatible bucket, with restore and upload
- A catalog of 380 one-click services (imported from the Coolify template catalog, see [NOTICE](NOTICE)), plus your own Compose stacks

**Networking and operations**
- Automatic HTTPS: a Traefik reverse proxy per server, wildcard domains, Let's Encrypt
- Per-application password protection and maintenance mode
- Server monitoring (CPU, RAM, disk over SSH), container health alerts, OS patch checks, Docker image management, web terminal
- Notifications: Discord, Slack, Telegram, ntfy, Pushover, e-mail (SMTP) and generic webhooks, with per-event filters
- Log drains: Loki, Axiom, New Relic, Fluent Bit (HTTP) and AWS CloudWatch

**Security**
- Secrets are encrypted at rest (AES-256-GCM), with key rotation
- Two-factor authentication (TOTP), passkeys (WebAuthn), optional 2FA enforcement per team
- Personal API tokens with scopes, expiry and IP allow-lists
- Audit log of who changed what

**Organisation**
- `Team → Project → Environment → Resource`, with shared variables, tags and a global search
- Single-admin by design: `/register` works once, there are no invitations
- The machine running `yeah` can register itself as the first deploy server

See [docs/roadmap.md](docs/roadmap.md) for the full status.

## Quick install (Ubuntu / Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash
```

One command: it installs Docker if missing, starts Postgres, Redis, the API, the worker, the WebSocket server and the dashboard with `docker compose`, and runs the database migrations. Details, requirements and updates: **[docs/installation.md](docs/installation.md)**.

**Want the panel off your production VPS?** Install only the control plane (on a home PC, a Raspberry Pi or a cheap VPS) and connect the VPS over SSH:

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash -s -- --control-plane-only
```

## Local development

```bash
git clone https://github.com/flazo0/yeah.git && cd yeah
cp .env.example .env
bun run dev:infra   # Postgres + Redis via docker compose
bun install
bun run db:migrate
bun run dev         # api :3000, worker, ws :3001, web :5173
```

Create your account at `http://localhost:5173/register`. Full guide: **[docs/development.md](docs/development.md)**.

## Repository layout

```
apps/
  api/      Elysia HTTP API, session auth, enqueues jobs
  worker/   BullMQ worker — the only part that talks SSH to your servers
  ws/       Bun WebSocket server — relays Redis pub/sub events to browsers
  web/      Vue 3 + Vite dashboard (Monaco for config, xterm.js for terminals)
  cli/      Command-line client for the CI API
packages/
  db/             Drizzle schema, migrations and client
  shared/         Types and pure logic shared by every app
  queue/          BullMQ queues and Redis pub/sub
  ssh/            SSH client (ssh2), used by the worker
  storage/        Thin wrapper over Bun's S3 client
  github/         GitHub App JWTs, installation tokens, webhook verification
  notifications/  Discord, Slack, Telegram, e-mail and webhook senders
  logdrains/      Log forwarding to Loki, Axiom, New Relic, Fluent Bit and CloudWatch
  templates/      The one-click service catalog
```

## Documentation

| Document | Contents |
|---|---|
| [docs/installation.md](docs/installation.md) | Production install, control-plane-only mode, tunnels, updates |
| [docs/development.md](docs/development.md) | Local setup, scripts, tests, conventions |
| [docs/architecture.md](docs/architecture.md) | Processes, domain model, deploy flow, events, queues |
| [docs/configuration.md](docs/configuration.md) | Environment variables and low-memory tuning |
| [docs/api.md](docs/api.md) | HTTP routes, WebSocket events, CI API and CLI |
| [docs/security.md](docs/security.md) | Security model: encryption, authentication, hardening |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common problems and fixes |
| [docs/guides/](docs/guides) | Multi-service environments, scaling Node/Bun apps |
| [docs/roadmap.md](docs/roadmap.md) | What works, what is unverified, what is planned |

Project policies: [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [CHANGELOG.md](CHANGELOG.md)

## Security

Please do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md) to report them privately. The security model is described in [docs/security.md](docs/security.md).

## License

MIT — see [LICENSE](LICENSE). Third-party attributions are in [NOTICE](NOTICE).
