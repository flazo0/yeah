# Development

How to run `yeah` locally, the scripts you will use, and how to test changes. Contribution rules are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Requirements

- [Bun](https://bun.sh) 1.3.x (the Dockerfile and CI pin `1.3.14`; Bun 1.4.x currently breaks `.vue` module resolution in `vue-tsc`)
- Docker (only for the development Postgres and Redis)
- Node.js 22 (only to run `vue-tsc` on Linux, see below)

## Setup

```bash
git clone https://github.com/flazo0/yeah.git
cd yeah
cp .env.example .env          # adjust if needed
bun run dev:infra              # starts Postgres + Redis with docker compose
bun install
bun run db:migrate             # first time, and after pulling new migrations
bun run dev                    # api :3000, worker, ws :3001, web :5173
```

Create an account at `http://localhost:5173/register`; it gets a personal team automatically. Stop the development infrastructure with `bun run dev:infra:down`.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Starts api, worker, ws and web in parallel |
| `bun run typecheck` | `tsc --noEmit` in every package and `vue-tsc --noEmit` for the dashboard |
| `bun test` | Runs the unit test suite |
| `bun run db:generate` | Generates a migration from the Drizzle schema changes |
| `bun run db:migrate` | Applies pending migrations |
| `bun run db:studio` | Opens Drizzle Studio (a GUI for Postgres) |
| `bun run --cwd packages/db db:rekey` | Re-encrypts every stored secret with the current `ENCRYPTION_KEY` (after rotating it) |
| `bun run --cwd packages/db reset-password [email] [--disable-2fa]` | Sets a new password for an account (generated, or `YEAH_NEW_PASSWORD`) and signs it out everywhere |

Generating a migration without a database: `DATABASE_URL=postgres://x:x@localhost/x bun run db:generate --name <name>` from `packages/db`. Never edit a migration that was already committed.

## Typechecking the dashboard on Linux

If `bun run typecheck` prints a wall of `Cannot find module '*.vue'` errors, Bun is launching `vue-tsc` in a way that fails on Linux. Run it with Node instead:

```bash
node apps/web/node_modules/vue-tsc/bin/vue-tsc.js --noEmit
```

## GitHub App (optional)

Only needed if you work on the GitHub integration. `.env.example` has the full walkthrough: which fields to fill in at `github.com/settings/apps/new`, and how to produce `GITHUB_APP_PRIVATE_KEY_BASE64` from the `.pem` GitHub gives you.

## Tests

`bun test` runs `bun:test` suites that live next to the code. They cover pure logic — command builders, parsers, validators, crypto helpers, routing configuration, template consistency — and a few components that talk to local fakes (for example the scale-to-zero waker against a fake Docker API).

They do **not** cover end-to-end flows or anything needing real Postgres, Redis, an SSH server or a Docker daemon. For those, test by hand and record in your pull request what you actually exercised.

## Testing against a real server

The worker needs a real SSH + Docker target to test deployments and provisioning; mocking that is not useful. Two options:

- **A disposable VPS** (preferred for anything that touches networking, Traefik, certificates or systemd). Use an isolated Docker Compose project name, take a database dump before updating a panel that holds data, and tear everything down afterwards.
- **A local container** with `openssh-server` and the Docker CLI, with the host's `docker.sock` mounted. The `docker run` / `docker build` commands the worker sends over SSH then run on your host's daemon. Only worth it if you change worker code, and be careful: it acts on your real Docker daemon.

Do not run the full end-to-end flow on a machine whose Docker you care about.

## Project conventions

See [CONTRIBUTING.md](../CONTRIBUTING.md#conventions). The most important ones:

- Pure logic lives in `packages/shared` or in `*.commands.ts` files, so it can be unit tested without infrastructure.
- Long or periodic SSH work belongs in the worker, through BullMQ.
- Every user-visible string goes through vue-i18n; add the key to `en.json` and every other locale.
