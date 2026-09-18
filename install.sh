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
# Não é uma porta óbvia (8080/8000/3000/9000/...) — só isso já tira o painel da maioria dos scans
# automatizados. Some com o PANEL_PATH aleatório gerado abaixo pra esconder de verdade.
DEFAULT_WEB_PORT=58943

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
  # a config). /dev/tty é o terminal de verdade por trás do pipe; sem ele (sessão sem terminal
  # de controle, ex. nohup/CI), abrir o arquivo falha (ENXIO) mesmo que `-r /dev/tty` diga que
  # é "legível" — por isso o teste real é tentar o próprio `read` e cair pro default se falhar.
  PUBLIC_HOST=""
  WEB_PORT=""
  if read -rp "Domínio ou IP público pra acessar o dashboard (deixe em branco pra localhost): " PUBLIC_HOST < /dev/tty 2>/dev/null; then
    read -rp "Porta pra expor o dashboard web [${DEFAULT_WEB_PORT}]: " WEB_PORT < /dev/tty 2>/dev/null || true
  else
    warn "Sem terminal interativo — usando localhost:${DEFAULT_WEB_PORT}. Edite $ENV_FILE depois se precisar de outro host/porta."
  fi
  PUBLIC_HOST=${PUBLIC_HOST:-localhost}
  WEB_PORT=${WEB_PORT:-$DEFAULT_WEB_PORT}

  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  SESSION_SECRET=$(openssl rand -hex 32)
  # Painel só responde sob esse caminho aleatório — qualquer outra URL na mesma porta não devolve
  # nada (ver apps/web/nginx.conf.template). Sem isso, mesmo numa porta incomum, quem achar a
  # porta aberta acha o painel de cara em "/".
  PANEL_PATH="/$(openssl rand -hex 8)"

  cat > "$ENV_FILE" <<EOF
POSTGRES_USER=yeah
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=yeah
SESSION_SECRET=${SESSION_SECRET}

API_PORT=3000
WS_PORT=3001
WEB_PORT=${WEB_PORT}

# Caminho aleatório sob o qual o painel responde de verdade (ver apps/web/nginx.conf.template) —
# gerado uma vez na instalação, nunca sobrescrito depois. Não perca essa URL.
PANEL_PATH=${PANEL_PATH}

# Usado pro CORS (casos fora do proxy — dev local, etc.) e pra montar a callback URL do GitHub App.
WEB_ORIGIN=http://${PUBLIC_HOST}:${WEB_PORT}

# Deixe em branco: o nginx do próprio container "web" já reverse-proxya /api e /ws pro api/ws
# internamente (apps/web/nginx.conf.template), então o frontend usa caminho relativo (mesma
# origem) e não precisa saber o host/IP público em tempo de build. Só preencha se for rodar api/ws
# num host ou porta diferente do dashboard (sem proxy compartilhado) — nesse caso rode
# 'docker compose build web' de novo depois de mudar.
VITE_API_URL=
VITE_WS_URL=

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
# `< /dev/null` é essencial aqui: "docker compose exec"/"run" tentam encaminhar o stdin do
# processo chamador pro container mesmo sem precisar dele, e ficam esperando ele fechar antes
# de retornar — sem isso, rodando via "curl | bash" (onde o stdin do script pode não fechar de
# forma confiável até o fim), essas chamadas travam pra sempre logo no primeiro loop.
for _ in $(seq 1 30); do
  docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U yeah < /dev/null >/dev/null 2>&1 && break
  sleep 2
done

log "Rodando migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api bun run --cwd ../../packages/db db:migrate < /dev/null

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
  *)
    echo "uso: yeah {update|logs [serviço]|restart|status|stop}"
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
log "Pronto! Acesse http://${PUBLIC_HOST_FINAL}:${WEB_PORT_FINAL}${PANEL_PATH_FINAL}/ e crie sua conta em /register."
warn "Guarde essa URL — o painel só responde nesse caminho (PANEL_PATH em $ENV_FILE); qualquer outra URL na mesma porta não devolve nada, de propósito."
log "Comandos: yeah update | yeah logs [serviço] | yeah restart | yeah status | yeah stop"
warn "Sem domínio real + TLS na frente ainda — coloque um Caddy/nginx com certificado se for expor na internet. Veja docs/INSTALLATION.md."
