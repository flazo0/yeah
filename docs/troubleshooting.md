# Troubleshooting

## 502 Bad Gateway

The proxy (Traefik) finds the container but cannot talk to it.

- Does the app listen on `0.0.0.0` (not only `127.0.0.1`) and on the **port configured** in the application?
- Is the container running? Check the Logs tab; a crash loop shows 502 between restarts.
- Is a healthcheck configured and failing? Traefik takes the container out of rotation until it is healthy.

## 503 Service Unavailable

No healthy container serves that domain: the app is stopped, a deployment is still running, or the router was not created. Check the application status and that the domain is saved (Domains tab). If maintenance mode is on for the application, a 503 maintenance page is the expected answer.

## 504 Gateway Timeout

The app took too long. Look for slow queries, external calls without a timeout, or CPU/memory limits that are too low (Resources tab).

## The first request after a while is slow

If sleep-when-idle is enabled for the application, the container was stopped and is being started by the waker; the first request waits for it. Disable sleeping in the application's *General* tab if that latency is not acceptable.

## Build killed by OOM (exit 137 / "Killed")

The build ran out of memory on the server. Options: add swap, build on another server (a remote build server), lower build parallelism (`NODE_OPTIONS=--max-old-space-size`), or use a bigger VPS. The panel warns you before a deployment when the server is overloaded.

## Firewall

Ports 80 and 443 must be open to the internet (Let's Encrypt uses port 80 for the HTTP challenge). Port 22 (SSH) must be reachable from the panel/worker. On providers with their own firewall (Hetzner, Oracle, AWS), open it there **and** in `ufw`.

## Let's Encrypt does not issue a certificate

- Does the domain's DNS point at the server's IP, and has it propagated? With Cloudflare, keep the record on "DNS only" for the first issuance.
- Is port 80 reachable from outside?
- Let's Encrypt rate limit (5 failures per hour per domain): wait before retrying.
- Check the certificate status on the server's Proxy page.

## GitHub token expired / a push does not trigger a deployment

Reconnect GitHub on the Sources page. For webhooks, check the repository's *Settings → Webhooks* for recent delivery errors (401 = different secret, 404 = wrong URL).

## Passkeys do not work

A passkey is bound to the address of the panel it was created on, and that address must be listed in `WEB_ORIGIN`. If you changed the domain, add it to `WEB_ORIGIN`, restart the API and register the passkey again.

## I lost my password (or my authenticator)

There is no e-mail reset: this is a single-admin panel, and whoever has root on the machine can already do anything. Run on the machine where the panel is installed:

```bash
sudo yeah reset-password                     # the only account, with a generated password
sudo yeah reset-password me@example.com      # when there is more than one account
sudo yeah reset-password --disable-2fa       # also turn off two-factor authentication (lost authenticator and recovery codes)
sudo YEAH_NEW_PASSWORD='a-long-password' yeah reset-password   # choose the password yourself
```

A generated password is printed once; change it in *Settings* after signing in. Every open session of that account is signed out. The password is never taken from the command line, so it does not end up in the shell history. If the `yeah` helper does not know `reset-password` (it is written when the panel is installed, and an update does not rewrite it), run the same thing directly:

```bash
cd /opt/yeah && docker compose -f docker-compose.prod.yml --env-file .env run --rm api bun run --cwd ../../packages/db reset-password
```

Passkeys are not touched.

## Restoring the panel's own database

*Settings → Panel backup* sends a daily `pg_dump` of the panel's database to your S3 storage, under `yeah-instance/yeah-YYYYMMDD-HHMMSS.sql.gz` (UTC). To restore it on a machine where the panel is installed:

1. Download the file you want from the storage.
2. Make sure the `.env` is the one the backup was made with. **The database holds secrets encrypted with `ENCRYPTION_KEY`; without that key a restored database cannot be read.** Keep a copy of `.env` somewhere safe, apart from the backups.
3. Stop the services that use the database, load the dump into an empty database, then start everything again:

```bash
cd /opt/yeah
docker compose -f docker-compose.prod.yml --env-file .env stop api worker ws
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"' < /dev/null
gunzip -c yeah-20260101-030000.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

The same dump command is what `yeah update` runs before an update (those copies stay on the host in `/root/yeah-backups`).

## Server shows as offline

The worker cannot open SSH. Check the IP and port, the key under Keys & Tokens, and that `sshd` accepts the key (`~/.ssh/authorized_keys`).

## `yeah update` says "UPDATE CANCELLED"

The disk is at 92% or more, or the pre-update database dump failed. Free up space (the Docker cleanup under the server's Maintenance tab helps) and retry. As a last resort, `YEAH_SKIP_DISK_CHECK=1` and `YEAH_BACKUP_BEFORE_UPDATE=0` skip the checks — only do that if you have your own backup.
