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
#   4. Builds and starts postgres, redis, api, worker, ws and web via docker compose.
#   5. Runs pending database migrations.
#   6. Installs a `yeah` CLI helper (update/logs/restart/status) to /usr/local/bin.
set -euo pipefail

REPO_URL="https://github.com/flazo0/yeah.git"
INSTALL_DIR="/opt/yeah"
COMPOSE_FILE="docker-compose.prod.yml"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERRO:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "roda como root (sudo ./install.sh)"

if ! grep -qiE "ubuntu|debian" /etc/os-release 2>/dev/null; then
  warn "esse instalador foi feito pra Ubuntu/Debian — seguindo mesmo assim, mas sem garantias em outra distro."
fi

# ---------------------------------------------------------------------------
log "Verificando Docker..."
if ! command -v docker >/dev/null 2>&1; then
  log "Docker não encontrado, instalando via get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  log "Docker já instalado ($(docker --version))."
fi

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose (plugin v2) não encontrado — instale o Docker novamente, ele já vem com o plugin nas versões atuais."
fi

# ---------------------------------------------------------------------------
log "Verificando git..."
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }

# ---------------------------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "yeah já está em $INSTALL_DIR — atualizando..."
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" reset --hard --quiet origin/main
else
  log "Clonando yeah em $INSTALL_DIR..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---------------------------------------------------------------------------
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  log ".env já existe — não vou sobrescrever (apague o arquivo se quiser gerar um novo)."
else
  log "Gerando .env de produção..."
  # Rodando via "curl | bash", stdin é o próprio script sendo transmitido — um "read" comum
  # consumiria as linhas seguintes do script como se fossem resposta do usuário (corrompendo
  # a config). /dev/tty é o terminal de verdade por trás do pipe; sem ele (script 100% não
  # interativo, ex. CI), cai direto nos valores padrão em vez de travar ou ler lixo.
  if [ -r /dev/tty ]; then
    read -rp "Domínio ou IP público pra acessar o dashboard (deixe em branco pra localhost): " PUBLIC_HOST < /dev/tty
    read -rp "Porta pra expor o dashboard web [8080]: " WEB_PORT < /dev/tty
  else
    warn "Sem terminal interativo — usando localhost:8080. Edite $ENV_FILE depois se precisar de outro host/porta."
    PUBLIC_HOST=""
    WEB_PORT=""
  fi
  PUBLIC_HOST=${PUBLIC_HOST:-localhost}
  WEB_PORT=${WEB_PORT:-8080}

  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  SESSION_SECRET=$(openssl rand -hex 32)

  cat > "$ENV_FILE" <<EOF
POSTGRES_USER=yeah
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=yeah
SESSION_SECRET=${SESSION_SECRET}

API_PORT=3000
WS_PORT=3001
WEB_PORT=${WEB_PORT}

# CORS allowlist — precisa bater com de onde o navegador acessa o dashboard.
WEB_ORIGIN=http://${PUBLIC_HOST}:${WEB_PORT}

# Embutidas no build do frontend (Vite) — mude e rode 'docker compose build web' de novo se
# trocar de domínio depois.
VITE_API_URL=http://${PUBLIC_HOST}:3000
VITE_WS_URL=ws://${PUBLIC_HOST}:3001

# GitHub App (opcional) — veja .env.example pra passo a passo de como cadastrar.
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY_BASE64=
GITHUB_APP_WEBHOOK_SECRET=
EOF
  chmod 600 "$ENV_FILE"
  log ".env gerado com senha de banco e segredo de sessão aleatórios."
fi

# ---------------------------------------------------------------------------
log "Buildando e subindo os containers (isso demora um pouco na primeira vez)..."
export YEAH_COMMIT
YEAH_COMMIT=$(git -C "$INSTALL_DIR" rev-parse HEAD)
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# ---------------------------------------------------------------------------
log "Aguardando o Postgres ficar saudável..."
for _ in $(seq 1 30); do
  docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U yeah >/dev/null 2>&1 && break
  sleep 2
done

log "Rodando migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api bun run --cwd ../../packages/db db:migrate

# ---------------------------------------------------------------------------
log "Instalando o helper 'yeah' em /usr/local/bin..."
cat > /usr/local/bin/yeah <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/yeah
case "${1:-}" in
  update)
    git fetch --quiet origin
    git reset --hard --quiet origin/main
    export YEAH_COMMIT
    YEAH_COMMIT=$(git rev-parse HEAD)
    docker compose -f docker-compose.prod.yml --env-file .env up -d --build
    docker compose -f docker-compose.prod.yml --env-file .env run --rm api bun run --cwd ../../packages/db db:migrate
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
  *)
    echo "uso: yeah {update|logs [serviço]|restart|status|stop}"
    exit 1
    ;;
esac
HELPER
chmod +x /usr/local/bin/yeah

# ---------------------------------------------------------------------------
WEB_PORT_FINAL=$(grep -oP '^WEB_PORT=\K.*' "$ENV_FILE" || echo 8080)
PUBLIC_HOST_FINAL=$(grep -oP '^WEB_ORIGIN=http://\K[^:]*' "$ENV_FILE" || echo localhost)

echo
log "Pronto! Acesse http://${PUBLIC_HOST_FINAL}:${WEB_PORT_FINAL} e crie sua conta em /register."
log "Comandos: yeah update | yeah logs [serviço] | yeah restart | yeah status | yeah stop"
warn "Sem domínio real + TLS na frente ainda — coloque um Caddy/nginx com certificado se for expor na internet. Veja docs/INSTALLATION.md."
