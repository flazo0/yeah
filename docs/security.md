# Security model

This document describes how `yeah` protects the secrets it holds and the accounts that use it. To report a vulnerability, follow [SECURITY.md](../SECURITY.md).

## What is at stake

`yeah` stores the SSH private keys of every managed server, database and S3 credentials, notification and log-drain credentials, and the environment files of your applications. Anyone who controls the panel controls those servers, so the control plane is the most sensitive part of your infrastructure.

## Trust model

- **Single admin.** `POST /auth/register` only works while no user exists. There is no invitation route, and the instance has no self-service sign-up.
- **Agentless.** Nothing from `yeah` runs resident on the managed servers. The worker connects over SSH, runs commands and disconnects.
- **Outbound only.** Connections always go from the panel to the server. The panel does not need to be reachable from the managed servers.

## Encryption at rest

These values use the `encryptedText` column type (`packages/db/src/encryption.ts`); the authoritative list is `SECRET_COLUMNS` in `packages/db/src/encryptExisting.ts`:

- server SSH private keys and Cloudflare tunnel tokens, stored SSH keys, application deploy keys,
- Git source tokens and webhook secrets, container registry passwords,
- database passwords and S3 secret access keys,
- notification credentials (webhook URLs, Telegram and Pushover tokens, SMTP passwords) and log-drain credentials,
- application and service `.env` content, shared variable values and file-volume contents,
- the TOTP secret of each user.

Scheme: AES-256-GCM, a random IV per value, stored as `enc:v1:<base64url(iv|tag|ciphertext)>`. The key is derived from `ENCRYPTION_KEY` with HMAC-SHA256. Encryption is transparent to the rest of the code: the column type encrypts on write and decrypts on read. Plain-text values from before encryption was enabled stay readable and are rewritten encrypted on the next API start (`encryptExistingSecrets`).

**Key rotation.**

1. Move the current key into `ENCRYPTION_KEY_PREVIOUS` (several keys are accepted, comma-separated) and set a new `ENCRYPTION_KEY`.
2. Restart the stack, then re-encrypt everything with the new key:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env run --rm api bun run --cwd ../../packages/db db:rekey
   ```

3. Only then remove the old key.

**Back up `ENCRYPTION_KEY`.** It is generated into `.env` by the installer. Without it, stored secrets cannot be read. Store the key and the database backups in different places, so one leak does not expose both. Installations created before `ENCRYPTION_KEY` existed fall back to `SESSION_SECRET` through `docker-compose.prod.yml`; rotate them as above.

## Authentication

- **Passwords** are hashed with argon2id (`Bun.password`).
- **Sessions** use an httpOnly, `SameSite=Lax` cookie, with the `Secure` flag whenever the panel origin is HTTPS.
- **Two-factor authentication (TOTP)** with recovery codes. An administrator can **require 2FA for the whole team**: members without it lose access to team data until they enable it.
- **Passkeys (WebAuthn).** Users can sign in with a platform authenticator or security key instead of password + 2FA. A passkey is bound to the panel address it was created on, which must be listed in `WEB_ORIGIN`. Challenges are single-use and expire in minutes.
- **Personal API tokens** (`yeah_…`) for the CI API: read or full permission, optional expiry and IP allow-list, stored hashed, and listed with their last use. A notification warns before a token expires.
- **GitHub App OAuth `state`** is signed (HMAC of `SESSION_SECRET`), expires in 10 minutes and is bound to the signed-in user who started the connection (`apps/api/src/lib/oauthState.ts`).

## Abuse protection

- **Rate limiting** (in memory, per IP using the `X-Real-IP` header set by nginx): sign-in and registration 10 per 5 minutes, GitHub webhooks 600 per minute, other mutations 120 per minute (`apps/api/src/lib/rateLimit.ts`). Behind a Cloudflare Tunnel the real visitor IP is read from `CF-Connecting-IP`, trusted only when the connection comes from Docker's internal network.
- **Pre-flight server check.** Deployments, rollbacks and database/service creation return 409 `server_overloaded` when the latest metric (up to 10 minutes old) shows disk or memory at 95% or more; the UI asks and repeats with `?force=true` if the user insists.
- **Circuit breaker** in the worker for metrics polling: five consecutive failures open the circuit, with a five-minute wait that doubles up to 30 minutes.
- **Safe shell construction.** Every value interpolated into a remote command goes through `shellQuote`; paths for the file browser are validated (absolute, no control characters, no `..`) and passed as arguments, never spliced into a shell string.

## Container file browser writes

The file browser of applications, services (per container) and databases can also edit text files, upload files, create folders and delete. Anyone who can use it can change what runs inside a container (configuration, scripts, a database's data directory), so it is **off by default**: reading works as before, writing needs the operator to set `FILE_BROWSER_WRITES=true` for the whole instance (there is no per-team switch). Rails:

- **Strict paths.** Absolute, canonical, no `..` or `.` segments, no control characters, at most 1024 characters (`normalizeBrowserPath`). `/`, `/proc`, `/sys`, `/dev` and `*.sock` files are never writable, and top-level folders cannot be deleted.
- **Only through `docker exec`.** Every action runs inside the target container with the path as a quoted positional argument (`shellQuote`), never spliced into a script. Symlinks therefore resolve inside the container's own filesystem and cannot reach the host. A bind mount is part of the container's view, though: writing through one writes to the host path behind it.
- **Staging.** Content is first written to a private (0600) temp file on the server and streamed in with `docker exec -i ... cat`, which keeps the owner and mode of an existing file; the temp file is removed afterwards.
- **Limits and binary detection.** The editor handles UTF-8 text up to 2 MB and refuses binary content (NUL bytes or invalid UTF-8). Uploads are capped by `FILE_BROWSER_UPLOAD_MAX_MB` (10 by default, at most 100) and refuse to replace a file unless asked.
- **Explicit confirmation.** Deleting needs the request to repeat the exact path as `confirm` (the UI asks first), and uploads over an existing file ask before replacing it.
- **Audit.** Writes appear as "Edited a file", "Uploaded a file", "Created a folder" and "Deleted a file or folder in the container" (deletes as warnings), with who, when and which resource. The path and content travel in the request body, which is never logged, so the audit log does not say *which* file changed.
- Writes are available to signed-in team members through the panel only; API tokens cannot use these routes.

## Auditability

Mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) are recorded in the audit log: who, when, what kind of change and on which resource. The description is built from the **request path only — never the request body**, so no secret can end up in it. Retention is `AUDIT_RETENTION_DAYS` (365 by default). Calls made through the token API (including its `/api/v1` form) are recorded with the token's name, and the MCP tools that change something (deploy, backup) are recorded too. Sign-ins, failed sign-in attempts (wrong password or two-factor code), passkey sign-ins and sign-outs are recorded in every team the person belongs to; failures show up as warnings. Rows carry the client IP when known. Failed attempts for an e-mail that has no account cannot be tied to a team and are not recorded.

Deployment logs can redact environment variable values (a per-application option), so secrets that tools echo during a build do not persist in the log.

## Operational safety

- `yeah update` refuses to run on a disk at 92% or more and takes a compressed database dump first (see [installation.md](installation.md#updating)).
- Re-provisioning the proxy snapshots `acme.json` (three copies are kept) before touching Traefik.
- Per-application password protection is HTTP basic auth enforced by Traefik; only the bcrypt hash is stored.
- The `SECURITY.md` hardening checklist summarizes what operators should do.

## WebSocket channel

The `ws` service refuses an upgrade without a valid `yeah_session` cookie (401) and, when `WEB_ORIGIN` is set, with a foreign `Origin` (403). Sessions are validated against the same `sessions` table as the API (`findSessionUserId` in `@yeah/db`); the service never reads encrypted columns. Each event is routed to the team that owns the resource it concerns (resolved from Postgres and cached for five minutes), and only sockets of members of that team receive it; events that cannot be attributed are dropped. Every 60 seconds each socket re-checks its session and team list and is closed (code 4401) if the session ended.

## Known gaps

- The WebSocket channel is authenticated, but membership changes and session revocation take up to 60 seconds to reach already-open sockets, and platform-operation events (self-update and host update logs) go to every signed-in user because they belong to the instance, not to a team. The channel is also not yet tested end to end (see [roadmap.md](roadmap.md#verification-status)).
- The installer serves the dashboard over plain HTTP by default; HTTPS in front of it is the operator's responsibility.
- Read-only token calls (`GET`) are not audited; only changes and authentication events are.
- Several security-relevant flows were tested with unit tests only; see the verification status in [roadmap.md](roadmap.md#verification-status).
