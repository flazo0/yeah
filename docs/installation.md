# Installation

There are two ways to run `yeah`: **production** (one Ubuntu/Debian server, one command) and **local development** (to work on the code, see [development.md](development.md)).

## Production: Ubuntu / Debian, one command

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash
```

The script (`install.sh` in the repository root — plain bash, read it before running it) does the following:

1. Installs Docker and the Compose plugin if they are missing.
2. Clones the repository into `/opt/yeah` (or updates it if it already exists).
3. Asks for the public domain/IP and the dashboard port (the default is a non-obvious port, not 8080) and generates a `.env` with a random database password, session secret and encryption key. It never overwrites an existing `.env`.
4. Builds and starts `postgres`, `redis`, `api`, `worker`, `ws` and `web` with `docker-compose.prod.yml`.
5. Runs the database migrations.
6. Installs a `yeah` helper in `/usr/local/bin` (`yeah update`, `yeah logs`, `yeah restart`, `yeah status`, `yeah stop`).

When it finishes, open `http://<your-host>:<port>` and create your account at `/register`.

> **Back up `ENCRYPTION_KEY`.** It is generated into `/opt/yeah/.env`. Without it the secrets stored in the database (SSH keys, passwords, tokens) cannot be read. See [security.md](security.md#encryption-at-rest).

> **Optional secret path.** Set `PANEL_PATH` in `/opt/yeah/.env` (for example `PANEL_PATH=/a1b2c3d4`) and run `sudo yeah update`: the dashboard then only answers under that URL, and every other URL on the same port (including `/`) gets no response. It is an extra layer of obscurity on top of authentication, off by default. Details in [architecture.md](architecture.md#panel_path-an-optional-secret-path).

> **`/register` works once.** `yeah` is single-admin. As soon as the first account exists, `/register` stops working for good (it redirects to `/login`), and there is no invitation flow.

> **This machine becomes the first server.** Before generating `.env`, the script creates an SSH key and authorizes it in the host's `~/.ssh/authorized_keys`. When you create the admin account, the machine appears as "Local server" (status `connected`), so you can deploy without registering a server by hand. Use `--control-plane-only` to opt out.

> **No HTTPS at first.** The installer serves the dashboard over plain HTTP so the first login is simple. Once the panel runs on a server that has the proxy active, open *Settings → Panel domain*, enter a domain that points at the server and save: the panel is then served over HTTPS with a Let's Encrypt certificate through that server's Traefik (see below). When the panel is installed on a machine yeah does not manage (control-plane-only), use a reverse proxy such as [Caddy](https://caddyserver.com/), a Cloudflare Tunnel or Tailscale instead.

### A domain with HTTPS for the panel

1. Point a DNS **A record** (for example `panel.example.com`) at the server's public IP. Ports 80 and 443 must be open.
2. Make sure the proxy is active on that server (*Servers → the server → Proxy*) and that the Let's Encrypt e-mail is set there.
3. Open *Settings → Panel domain*, enter the domain, use **Check DNS**, then **Save and enable HTTPS**.

The certificate is requested the first time the domain is opened and can take a minute. The address you used before (the IP and port) keeps working as a fallback, and removing the domain from the same page undoes everything. Passkeys belong to one address, so a passkey created on the IP does not work on the domain: register a new one there.

How it works: the panel's web container joins the proxy network under the alias `yeah-panel-web`, and a file in the proxy's dynamic directory (`/opt/yeah-proxy/dynamic/yeah-panel.yml`) routes the domain to it. Nothing in `.env` changes. The panel also starts accepting `https://<domain>` as an origin (CORS, WebSocket, passkeys, terminal) and sets the session cookie as `Secure` for requests that arrive over HTTPS.

### Control plane only (panel separate from the servers)

`yeah` is agentless: the worker always talks to servers over SSH, so the panel does not need to run on the same machine as your apps. You can install **only the panel** on a home PC, a Raspberry Pi or a cheap VPS and connect the production VPS as a remote server. The production VPS then spends no RAM or CPU on the dashboard, the API, the panel's Postgres or Redis (the panel uses about 250 MB at rest).

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash -s -- --control-plane-only
```

(From a local clone: `sudo ./install.sh --control-plane-only`. Without the flag and on an interactive terminal, the installer asks "Will this machine also run the apps?" — answer `n`.)

In this mode **no SSH key is generated and the machine's `~/.ssh/authorized_keys` is not touched**; the panel starts with no server registered (there is no "Local server"). After creating the account:

1. Go to **Servers → Add server**.
2. Fill in the name, host/IP, port and SSH user of the production VPS and click **Generate new key**. The page generates an ed25519 pair, puts the private key in the form (it is stored encrypted in the database) and shows the command that authorizes the public key.
3. Run that command on the VPS (as the SSH user you chose) and click **Add server**. The status becomes `connected` and the VPS's Docker version appears.

The panel only needs **outbound** network access to the VPS's SSH port (the reverse is not needed), so it can sit behind NAT. Metrics, deployments, backups and the proxy work the same way, all over SSH.

Things to know in this mode:

- **Updating the panel** is `sudo yeah update` on the panel machine. On the *Updates* page the "Update platform" and "Update system" buttons disappear, because they act over SSH on a server marked as the platform host, and in this mode the panel does not run on any registered server.
- Deploy servers are patched on the servers themselves (or from the server's *Updates* tab).
- **Already installed with the local server and want to convert?** No reinstall needed: move or delete the resources on "Local server" and remove it under **Servers → (server) → Remove server** (this only removes it from the panel; nothing is deleted on the machine). To also stop authorizing its key, delete the `yeah-localhost` line from `~/.ssh/authorized_keys` and the `LOCALHOST_SSH_*` variables from `.env`.

#### Reaching the panel from anywhere: Cloudflare Tunnel

If the panel runs on a machine without a public IP (home network, CGNAT), you can expose it through a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — no open port and no router configuration:

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash -s -- --control-plane-only --cloudflare-tunnel-token=YOUR_TOKEN
```

1. In the Cloudflare dashboard (Zero Trust → Networks → Tunnels) create a tunnel and copy its token.
2. Add a *public hostname* (for example `panel.example.com`) pointing at the service `http://web:80`.
3. During the install, enter that hostname as the panel domain. The installer also starts the `cloudflared` container (the `tunnel` profile of `docker-compose.prod.yml`), stores the token in `.env`, binds the local port to `127.0.0.1` only, and uses `https://<hostname>` as the origin (so the session cookie gets the `Secure` flag).

The API rate limit uses the visitor's real IP: behind the tunnel nginx reads the `CF-Connecting-IP` header, but only when the connection comes from Docker's internal network — anyone hitting the exposed port directly cannot forge it.

#### Alternative: Tailscale

[Tailscale](https://tailscale.com/) creates a private network (a tailnet) between the machines you authorize, each with a stable `100.x.y.z` address and a MagicDNS name, with no open ports. Unlike a Cloudflare Tunnel it needs neither a public domain nor a Cloudflare account. `yeah` needs no special support: the panel and a managed server are both just "a machine with a host/IP", and Tailscale only changes which IP that is.

**Reach the panel without exposing it to the internet:**

1. Install Tailscale on the panel machine (`curl -fsSL https://tailscale.com/install.sh | sh && tailscale up`) and on every device that will open the panel.
2. Instead of `--cloudflare-tunnel-token`, set `WEB_BIND=<the machine's Tailscale IP>` in `.env` (or leave `0.0.0.0` and block the port in the firewall for any source outside Tailscale's `100.64.0.0/10` range) — see the `WEB_BIND` variable in `docker-compose.prod.yml`.
3. Open the panel by IP or MagicDNS name from any device with Tailscale on.

**Connect a managed server without exposing its SSH port:**

1. Install Tailscale on the server too (`tailscale up`).
2. Under **Servers → Add server**, enter the server's Tailscale IP (`100.x.y.z`) or MagicDNS name in the "Host" field instead of its public IP. The SSH port stays the same.
3. The worker connects over SSH as usual; the traffic simply never crosses the public internet, so port 22 does not have to be open to the world.

A Cloudflare Tunnel is better when you already have a domain and want a real public HTTPS link; Tailscale is better when only you (and your devices) need access. You can use both at once.

### Updating

```bash
sudo yeah update
```

Before updating, the helper refuses to continue when the disk is at 92% or more, and takes a compressed `pg_dump` of the panel database into `/root/yeah-backups` (the five most recent are kept). Set `YEAH_SKIP_DISK_CHECK=1` or `YEAH_BACKUP_BEFORE_UPDATE=0` to skip either check. It then pulls the latest `main`, rebuilds the images that changed and runs pending migrations.

> The helper in `/usr/local/bin/yeah` is written by `install.sh`. Installations made with an older installer get the new checks when you re-run `install.sh`; updates started from the panel's *Updates* page already include them.

### Logs, status, stopping

```bash
sudo yeah logs api      # follow one service
sudo yeah logs          # follow everything
sudo yeah status        # docker compose ps
sudo yeah stop          # stop everything without removing volumes
```

### Machine requirements

Running `postgres`, `redis`, `api`, `worker`, `ws` and `web` together works on a server with 1 vCPU / 1 GB of RAM (the memory limits in `docker-compose.prod.yml` add up to about 2 GB at the ceiling, but real usage at rest is much lower). The applications and databases you deploy run on the remote servers you register, so the machine running `yeah` does not need to scale with them. See [configuration.md](configuration.md#running-on-little-memory) for tuning.
