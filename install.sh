#!/usr/bin/env bash
# yeah — installer for Ubuntu/Debian servers.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash
# or, from a local clone:
#   sudo ./install.sh
#
# What this does:
#   1. Installs Docker + the Compose plugin if they're missing.
#   2. Clones (or updates) yeah into /opt/yeah.
#   3. Generates a production .env with random secrets — never overwrites an existing one.
#      Pass --control-plane-only to install just the panel (this machine is not a deploy target).
#   4. Builds and starts postgres, redis, api, worker, ws and web via docker compose.
#   5. Runs pending database migrations.
#   6. Installs a `yeah` CLI helper (update/logs/restart/status) to /usr/local/bin.
set -euo pipefail

REPO_URL="https://github.com/flazo0/yeah.git"
INSTALL_DIR="/opt/yeah"
COMPOSE_FILE="docker-compose.prod.yml"
# Not an obvious port (8080/8000/3000/9000/...) — that alone keeps the panel out of most automated
# scans. Combine it with a random PANEL_PATH (see below) to really hide it.
DEFAULT_WEB_PORT=58943

log()  { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# --- Options --------------------------------------------------------------------------------
# When running via "curl | sudo bash", pass options like this:  ... | sudo bash -s -- --control-plane-only
# Environment variables work too (YEAH_CONTROL_PLANE_ONLY=1, YEAH_CLOUDFLARE_TUNNEL_TOKEN=...).
CONTROL_PLANE_ONLY="${YEAH_CONTROL_PLANE_ONLY:-}"
CF_TUNNEL_TOKEN="${YEAH_CLOUDFLARE_TUNNEL_TOKEN:-}"

usage() {
  cat <<'USAGE'
usage: install.sh [options]

  --control-plane-only            Install only the panel: this machine does NOT become a deploy server (no SSH
                                  key is generated and ~/.ssh/authorized_keys is left alone). The servers that
                                  will run the apps are added later from the "Servers" page, over SSH.
  --cloudflare-tunnel-token=TOKEN Also start a cloudflared container that exposes the panel through a
                                  Cloudflare Tunnel (no public IP or open port). The public hostname is set
                                  up in the Cloudflare dashboard, pointing at http://web:80.
  -h, --help                      Show this help.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --control-plane-only) CONTROL_PLANE_ONLY=1 ;;
    --cloudflare-tunnel-token=*) CF_TUNNEL_TOKEN="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $arg (see --help)" ;;
  esac
done

# Prints the .env contents to stdout from the already-defined variables (PUBLIC_HOST, WEB_PORT,
# POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, CONTROL_PLANE_ONLY, CF_TUNNEL_TOKEN and, in full
# mode, LOCALHOST_SSH_PRIVATE_KEY_BASE64). It lives in a function so it can be tested without running the
# whole installer (test/install.test.ts sources this file with YEAH_INSTALL_SOURCE_ONLY=1).
render_env() {
  local web_origin="http://${PUBLIC_HOST}:${WEB_PORT}"
  # Behind a tunnel the public origin is https on the tunnel hostname, with no port.
  [ -n "$CF_TUNNEL_TOKEN" ] && web_origin="https://${PUBLIC_HOST}"

  cat <<EOF
POSTGRES_USER=yeah
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=yeah
SESSION_SECRET=${SESSION_SECRET}

# Encrypts at rest (AES-256-GCM) the SSH keys, database/S3/SMTP passwords and resource .env files in Postgres.
# KEEP THIS KEY SAFE: without it the stored secrets cannot be read. To rotate it, move the current value
# to ENCRYPTION_KEY_PREVIOUS (several are accepted, comma-separated) and generate a new one here.
ENCRYPTION_KEY=${ENCRYPTION_KEY}
ENCRYPTION_KEY_PREVIOUS=

API_PORT=3000
WS_PORT=3001
WEB_PORT=${WEB_PORT}

# Optional: leave blank to serve the panel at "/" (default). Set a path (e.g. /a1b2c3d4) to make the
# panel answer only under that URL — anything else on the same port (including "/") returns nothing.
# After changing it, run 'sudo yeah update'.
PANEL_PATH=

# Used for CORS (cases outside the proxy — local dev, etc.) and to build the GitHub App callback URL.
WEB_ORIGIN=${web_origin}

# Leave blank: the "web" container's own nginx already reverse-proxies /api and /ws to api/ws
# internally (apps/web/nginx.conf.template), so the frontend uses relative paths (same origin) and
# does not need to know the public host/IP at build time. Only fill these in if api/ws run on a
# different host or port than the dashboard (no shared proxy) — then run
# 'docker compose build web' again after changing them.
VITE_API_URL=
VITE_WS_URL=

# GitHub App (optional) — see .env.example for how to register one, step by step.
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY_BASE64=
GITHUB_APP_WEBHOOK_SECRET=

EOF

  if [ "$CONTROL_PLANE_ONLY" = "1" ]; then
    cat <<'EOF'
# "Control plane only" mode (--control-plane-only): this machine is NOT a deploy server. No SSH key
# was generated here or authorized in ~/.ssh/authorized_keys, and the panel starts with no server
# registered. Add the VPSs that will run the apps under "Servers" → "Add server".
# (To turn this installation into "panel + local server" later, see docs/installation.md.)
EOF
  else
    cat <<EOF
# Key generated just for this — already authorized in this machine's ~/.ssh/authorized_keys. Used to
# register this machine as a deploy server as soon as the admin account is created
# (see apps/api/src/lib/localhostServer.ts). Delete the four lines below if you do not want that.
LOCALHOST_SSH_PRIVATE_KEY_BASE64=${LOCALHOST_SSH_PRIVATE_KEY_BASE64}
LOCALHOST_SSH_HOST=host.docker.internal
LOCALHOST_SSH_PORT=22
LOCALHOST_SSH_USER=root
EOF
  fi

  if [ -n "$CF_TUNNEL_TOKEN" ]; then
    cat <<EOF

# Cloudflare Tunnel: the cloudflared container ("tunnel" profile in docker-compose.prod.yml) connects out
# to Cloudflare and serves the panel — no public IP or open port. In the Cloudflare dashboard, point the
# public hostname at http://web:80. The panel port is bound to 127.0.0.1 only, and the visitor's real IP
# comes from the CF-Connecting-IP header (trusted only when the connection comes from Docker's internal network).
COMPOSE_PROFILES=tunnel
CLOUDFLARE_TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
TRUST_CF_CONNECTING_IP=1
WEB_BIND=127.0.0.1
EOF
  fi
}

# Only load the functions above — used by the tests.
if [ "${YEAH_INSTALL_SOURCE_ONLY:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

[ "$(id -u)" -eq 0 ] || die "run as root (sudo ./install.sh)"

if ! grep -qiE "ubuntu|debian" /etc/os-release 2>/dev/null; then
  warn "this installer targets Ubuntu/Debian — continuing anyway, but there are no guarantees on other distros."
fi

# ---------------------------------------------------------------------------
log "Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found, installing via get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  log "Docker already installed ($(docker --version))."
fi

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose (plugin v2) not found — reinstall Docker, current versions ship with the plugin."
fi

# ---------------------------------------------------------------------------
log "Checking git..."
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }

# ---------------------------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "yeah is already in $INSTALL_DIR — updating..."
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" reset --hard --quiet origin/main
else
  log "Cloning yeah into $INSTALL_DIR..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---------------------------------------------------------------------------
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  log ".env already exists — not overwriting it (delete the file to generate a new one)."
else
  log "Generating the production .env..."
  # When running via "curl | bash", stdin is the script itself being streamed — a plain "read"
  # would consume the following script lines as if they were the user's answer (corrupting the
  # config). /dev/tty is the real terminal behind the pipe; without it (a session with no controlling
  # terminal, e.g. nohup/CI), opening the file fails (ENXIO) even if `-r /dev/tty` says it is
  # "readable" — so the real test is to try the `read` itself and fall back to the default on failure.
  PUBLIC_HOST=""
  WEB_PORT=""
  if read -rp "Domain or public IP to reach the dashboard (leave blank for localhost): " PUBLIC_HOST < /dev/tty 2>/dev/null; then
    read -rp "Port to expose the web dashboard [${DEFAULT_WEB_PORT}]: " WEB_PORT < /dev/tty 2>/dev/null || true
    if [ -z "$CONTROL_PLANE_ONLY" ]; then
      ANSWER=""
      printf '\n%s\n%s\n' "Where will the panel run?" "  Y = on this same machine, which also hosts the apps (simplest)  |  n = separate panel: only the panel here, the apps stay on other VPSs (saves RAM/CPU on the app server)" >&2
      read -rp "Will this machine also run the apps (deploy server)? [Y/n]: " ANSWER < /dev/tty 2>/dev/null || true
      case "$ANSWER" in [nN]*) CONTROL_PLANE_ONLY=1 ;; esac
    fi
    if [ -z "$CF_TUNNEL_TOKEN" ]; then
      read -rp "Cloudflare Tunnel token to expose the panel without an open port (optional, Enter to skip): " CF_TUNNEL_TOKEN < /dev/tty 2>/dev/null || true
    fi
  else
    warn "No interactive terminal — using localhost:${DEFAULT_WEB_PORT}. Edit $ENV_FILE afterwards if you need another host/port."
  fi
  PUBLIC_HOST=${PUBLIC_HOST:-localhost}
  WEB_PORT=${WEB_PORT:-$DEFAULT_WEB_PORT}
  CONTROL_PLANE_ONLY=${CONTROL_PLANE_ONLY:-0}

  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  SESSION_SECRET=$(openssl rand -hex 32)
  ENCRYPTION_KEY=$(openssl rand -hex 32)

  LOCALHOST_SSH_PRIVATE_KEY_BASE64=""
  if [ "$CONTROL_PLANE_ONLY" = "1" ]; then
    log "Control-plane-only mode: this machine does not become a deploy server (no SSH key generated)."
  else
    # Registers this machine as the first deploy server — without it the user would have to add
    # "localhost" by hand before being able to make a first deployment. The worker (running in a
    # container) reaches it through host.docker.internal, and the api inserts the row into the database
    # as soon as the admin account is created (see createLocalhostServerIfConfigured in
    # apps/api/src/lib/localhostServer.ts) — it cannot be done here yet because no team/user exists
    # until sign-up on the web page.
    log "Generating an SSH key to register this machine as a deploy server..."
    SSH_KEY_PATH="$INSTALL_DIR/.yeah_localhost.key"
    if [ ! -f "$SSH_KEY_PATH" ]; then
      ssh-keygen -t ed25519 -N "" -f "$SSH_KEY_PATH" -C "yeah-localhost" -q
    fi
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
    touch ~/.ssh/authorized_keys
    if ! grep -qF "$(cat "${SSH_KEY_PATH}.pub")" ~/.ssh/authorized_keys 2>/dev/null; then
      cat "${SSH_KEY_PATH}.pub" >> ~/.ssh/authorized_keys
      chmod 600 ~/.ssh/authorized_keys
    fi
    LOCALHOST_SSH_PRIVATE_KEY_BASE64=$(base64 -w0 "$SSH_KEY_PATH")
  fi

  render_env > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log ".env generated with a random database password and session secret."
fi

# ---------------------------------------------------------------------------
log "Building and starting the containers (this takes a while the first time)..."
export YEAH_COMMIT
YEAH_COMMIT=$(git -C "$INSTALL_DIR" rev-parse HEAD)
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# ---------------------------------------------------------------------------
log "Waiting for Postgres to become healthy..."
# `< /dev/null` is essential here: "docker compose exec"/"run" try to forward the caller's stdin
# to the container even when it is not needed, and wait for it to close before returning —
# without it, when running via "curl | bash" (where the script's stdin may not reliably close until
# the end), these calls hang forever on the very first loop.
for _ in $(seq 1 30); do
  docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U yeah < /dev/null >/dev/null 2>&1 && break
  sleep 2
done

log "Running migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api bun run --cwd ../../packages/db db:migrate < /dev/null

# ---------------------------------------------------------------------------
log "Installing the 'yeah' helper into /usr/local/bin..."
cat > /usr/local/bin/yeah <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/yeah
case "${1:-}" in
  update)
    # Before updating: refuse on a nearly full disk and back up the database (skip with YEAH_SKIP_DISK_CHECK=1 / YEAH_BACKUP_BEFORE_UPDATE=0).
    (
      set -o pipefail;
      used=$(df --output=pcent / | tail -1 | tr -dc 0-9);
      if [ "${YEAH_SKIP_DISK_CHECK:-0}" != 1 ] && [ "${used:-0}" -ge 92 ]; then echo "UPDATE CANCELLED: the disk is at ${used}%. Free up space (Docker cleanup) or use YEAH_SKIP_DISK_CHECK=1."; exit 1; fi;
      if [ "${YEAH_BACKUP_BEFORE_UPDATE:-1}" != 0 ]; then
      PGU=$(grep -E "^POSTGRES_USER=" .env | cut -d= -f2-); PGD=$(grep -E "^POSTGRES_DB=" .env | cut -d= -f2-);
      mkdir -p /root/yeah-backups; f=/root/yeah-backups/yeah-$(date +%Y%m%d-%H%M%S).sql.gz;
      if docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres pg_dump -U "${PGU:-yeah}" "${PGD:-yeah}" < /dev/null | gzip > "$f" && [ -s "$f" ]; then
      echo "database backup saved to $f"; ls -1t /root/yeah-backups/yeah-*.sql.gz | tail -n +6 | xargs -r rm -f;
      else rm -f "$f"; echo "UPDATE CANCELLED: the database backup could not be made. Use YEAH_BACKUP_BEFORE_UPDATE=0 to skip it."; exit 1; fi; fi
    )
    git fetch --quiet origin
    git reset --hard --quiet origin/main
    export YEAH_COMMIT
    YEAH_COMMIT=$(git rev-parse HEAD)
    docker compose -f docker-compose.prod.yml --env-file .env up -d --build
    # The update recreated the web container: when the panel has its own domain, put it back on the proxy network.
    web=$(docker ps -q --filter label=com.docker.compose.service=web --filter "label=com.docker.compose.project.working_dir=$PWD" | head -n 1)
    if [ -f /opt/yeah-proxy/dynamic/yeah-panel.yml ] && [ -n "$web" ] && docker network inspect yeah-proxy-net >/dev/null 2>&1; then
      docker network disconnect yeah-proxy-net "$web" >/dev/null 2>&1 || true
      docker network connect --alias yeah-panel-web yeah-proxy-net "$web" || true
    fi
    docker compose -f docker-compose.prod.yml --env-file .env run --rm api bun run --cwd ../../packages/db db:migrate < /dev/null
    ;;
  logs)
    shift
    docker compose -f docker-compose.prod.yml logs -f --tail=200 "$@"
    ;;
  restart)
    docker compose -f docker-compose.prod.yml --env-file .env restart
    ;;
  status)
    docker compose -f docker-compose.prod.yml ps
    ;;
  stop)
    docker compose -f docker-compose.prod.yml stop
    ;;
  reset-password)
    # Lost password: yeah reset-password [email] [--disable-2fa]   (YEAH_NEW_PASSWORD=... to choose it; otherwise one is generated)
    shift
    docker compose -f docker-compose.prod.yml --env-file .env run --rm -e YEAH_NEW_PASSWORD api bun run --cwd ../../packages/db reset-password "$@" < /dev/null
    ;;
  *)
    echo "usage: yeah {update|logs [service]|restart|status|stop|reset-password [email] [--disable-2fa]}"
    exit 1
    ;;
esac
HELPER
chmod +x /usr/local/bin/yeah

# ---------------------------------------------------------------------------
WEB_PORT_FINAL=$(grep -oP '^WEB_PORT=\K.*' "$ENV_FILE" || echo "$DEFAULT_WEB_PORT")
PUBLIC_HOST_FINAL=$(grep -oP '^WEB_ORIGIN=http://\K[^:]*' "$ENV_FILE" || echo localhost)
PANEL_PATH_FINAL=$(grep -oP '^PANEL_PATH=\K.*' "$ENV_FILE" || echo "")

echo
log "Done! Open http://${PUBLIC_HOST_FINAL}:${WEB_PORT_FINAL}${PANEL_PATH_FINAL}/ and create your account at /register."
if [ -n "$PANEL_PATH_FINAL" ]; then
  warn "Keep this URL — the panel only answers on that path (PANEL_PATH in $ENV_FILE); any other URL on the same port returns nothing, on purpose."
fi
if grep -q '^LOCALHOST_SSH_PRIVATE_KEY_BASE64=.' "$ENV_FILE"; then
  log "This machine is registered as the first deploy server (\"Local server\") as soon as you create the account."
else
  log "Control-plane-only install: no deploy server yet. After creating the account, go to Servers → Add server and connect the VPS that will run the apps (the page generates the SSH key and shows the command to authorize it)."
fi
if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.' "$ENV_FILE"; then
  log "Cloudflare Tunnel active: point the public hostname at http://web:80 in the Cloudflare dashboard. The local port only listens on 127.0.0.1."
fi
log "Commands: yeah update | yeah logs [service] | yeah restart | yeah status | yeah stop | yeah reset-password"
warn "No real domain + TLS in front yet — put Caddy/nginx with a certificate in front if you expose this to the internet. See docs/installation.md."
