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

## Server shows as offline

The worker cannot open SSH. Check the IP and port, the key under Keys & Tokens, and that `sshd` accepts the key (`~/.ssh/authorized_keys`).

## `yeah update` says "UPDATE CANCELLED"

The disk is at 92% or more, or the pre-update database dump failed. Free up space (the Docker cleanup under the server's Maintenance tab helps) and retry. As a last resort, `YEAH_SKIP_DISK_CHECK=1` and `YEAH_BACKUP_BEFORE_UPDATE=0` skip the checks — only do that if you have your own backup.
