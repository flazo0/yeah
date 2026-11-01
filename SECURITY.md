# Security Policy

`yeah` holds SSH keys, database credentials and API tokens for the servers it manages, so we take vulnerability reports seriously.

## Supported versions

`yeah` is pre-1.0 and ships from the `main` branch. Only the latest commit on `main` receives security fixes. Update with `sudo yeah update` (see [docs/installation.md](docs/installation.md#updating)).

| Version | Supported |
|---|---|
| `main` (latest) | Yes |
| Anything older | No — please update first |

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub's private vulnerability reporting:

1. Open <https://github.com/flazo0/yeah/security/advisories/new>.
2. Describe the problem, the affected component and how to reproduce it.

If you cannot use GitHub's form, open a minimal public issue that says only "security contact requested" (no details) and a maintainer will arrange a private channel.

Please include:

- the commit or version you tested,
- the component (`api`, `worker`, `ws`, `web`, `install.sh`, a template, ...),
- a proof of concept or clear reproduction steps,
- the impact you believe it has.

### What to expect

| Step | Target |
|---|---|
| Acknowledgement of your report | within 3 working days |
| Initial assessment and severity | within 7 days |
| Fix or mitigation for confirmed issues | depends on severity; critical issues are prioritised over everything else |
| Public disclosure | after a fix is available, coordinated with you |

We will credit reporters in the advisory unless you ask us not to.

## Scope

In scope:

- the API, worker, WebSocket server and dashboard in this repository,
- `install.sh` and the `yeah` helper it installs,
- the Docker Compose files and default configuration,
- the one-click service templates in `packages/templates` (for example, a template that ships an unsafe default),
- secret handling: encryption at rest, sessions, API tokens, 2FA and passkeys.

Out of scope:

- vulnerabilities in third-party software that a template installs (report those upstream),
- problems that require an attacker to already hold the instance admin's session or the `ENCRYPTION_KEY`,
- findings on instances that were deliberately exposed without TLS (the installer serves plain HTTP by default; see the hardening notes),
- denial of service through resource exhaustion on a deliberately undersized machine,
- missing security headers or best-practice suggestions without a demonstrable impact.

## Security model in short

- **Single admin.** `/register` works once; there is no invitation flow.
- **Agentless.** The control plane connects to your servers over SSH; nothing is installed on them beyond Docker.
- **Secrets at rest.** SSH keys, database and S3 passwords, notification credentials and resource `.env` files are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Losing that key means losing the stored secrets.
- **Authentication.** Argon2id password hashes, httpOnly session cookies, optional TOTP 2FA, optional passkeys, optional per-team 2FA enforcement, rate limiting on login and mutations.
- **Auditability.** Mutating requests, API-token calls and sign-in events are recorded in an audit log (request path only — never request bodies).

The full description is in [docs/security.md](docs/security.md).

## Hardening checklist for operators

- Put the dashboard behind HTTPS (a reverse proxy such as Caddy, or a Cloudflare Tunnel / Tailscale — see the installation guide).
- Back up `ENCRYPTION_KEY` and the Postgres database separately; store them in different places.
- Enable 2FA (or a passkey) on the admin account, and require it for the team.
- Keep the panel's own server patched; the Updates page reports pending security updates.
- Restrict API tokens with the `read` permission and an IP allow-list wherever possible.
- Set `PANEL_PATH` if you want an extra layer of obscurity (it is not a substitute for authentication).
