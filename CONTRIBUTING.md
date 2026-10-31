# Contributing

Thanks for helping improve `yeah`. This document explains how to set up the project, what we check before merging, and the conventions we follow.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Language

Everything in this repository is written in **English**: code, identifiers, comments, commit messages, documentation, error messages and the default UI language. Translations of the dashboard live in `apps/web/src/locales/` (`en.json` is the source of truth; every key must exist in every locale).

## Setup

See [docs/development.md](docs/development.md) for the full guide. In short:

```bash
cp .env.example .env
bun run dev:infra
bun install
bun run db:migrate
bun run dev
```

## Before opening a pull request

```bash
bun run typecheck
bun test
```

- `typecheck` runs `tsc --noEmit` in every package and `vue-tsc --noEmit` for the dashboard.
- `test` runs the unit test suite (`bun:test`, no extra dependencies). It covers pure logic: command builders, parsers, validation, crypto helpers, routing config. It does **not** cover end-to-end flows or anything that needs a real Postgres, Redis, SSH server or Docker daemon.
- If your change touches the worker (SSH / Docker behaviour), please test it against a disposable real server and say so in the pull request. Do not claim a feature is verified if it was only unit-tested.

### Writing tests

- Test files sit next to the code as `<name>.test.ts`.
- If the logic you want to test lives in a file that imports `@yeah/ssh` (even only for an unrelated function), extract the pure part into a `<name>.commands.ts` file without that import. Importing `@yeah/ssh` loads all of `ssh2`, which behaves unreliably when several test files share one `bun test` process. `apps/worker/src/jobs/*.commands.ts` shows the pattern.
- `test/setup.ts` (loaded through `bunfig.toml`) defines fake `DATABASE_URL`, `REDIS_URL` and `SESSION_SECRET`. The Postgres and Redis clients are lazy, so importing a module that uses them does not need running infrastructure.

### Linux and macOS note

If `bun run typecheck` fails with a wall of `Cannot find module '*.vue'` errors, that is a known Bun problem when it launches `vue-tsc` on Linux. Run it with Node instead: `node apps/web/node_modules/vue-tsc/bin/vue-tsc.js --noEmit`. The `Dockerfile` already does this for production builds.

## Repository layout

```
apps/       api, worker, ws, web, cli
packages/   db, shared, queue, ssh, storage, github, notifications, logdrains, templates
docs/       documentation
scripts/    maintenance scripts (for example the template importer)
```

A new package (`packages/<name>`) follows the same skeleton: a `package.json` whose `main` / `types` point to `./src/index.ts`, and a `tsconfig.json` extending `../../tsconfig.base.json`. Copy an existing package.

## Conventions

- **Comments explain why, not what.** Add one only when the reason is not obvious from the code (a non-obvious decision, a workaround, a hidden invariant).
- **Migrations are immutable.** Never edit a committed migration. Change the schema in `packages/db/src/schema/*.ts` and run `bun run db:generate`.
- **API routes:** every authenticated endpoint checks the session first (`getUserFromSessionId`), then team membership or resource ownership (`assertMember`). Copy the pattern from a neighbouring route.
- **The API does not run long SSH jobs.** Long or periodic work belongs in the worker, through a queue. The API only makes short, synchronous SSH calls where the browser is already waiting (file downloads, listings, teardown on delete); keep any new one short and bounded.
- **Pure logic goes in `packages/shared`** (or a `*.commands.ts` file) so it can be unit tested without infrastructure.
- **Never put secrets in logs, errors, audit entries or URLs.** The audit log stores request paths only.
- **Anything new should be optional for the user** and off by default unless there is a strong reason.
- **Frontend:** Tailwind v4 with CSS tokens in `apps/web/src/styles/main.css`; follow the design notes in [docs/architecture.md](docs/architecture.md). Every user-visible string goes through vue-i18n.

## Commits and pull requests

- Keep pull requests focused; explain the motivation and how you verified the change.
- Write commit messages in the imperative mood ("Add passkey login", not "Added passkey login").
- Update the relevant document in `docs/` and `CHANGELOG.md` when behaviour changes.

## Reporting bugs and requesting features

Open an issue using the templates. For a roadmap item, link the relevant section of [docs/roadmap.md](docs/roadmap.md).
