# yeah

**Alternativa self-hosted e open-source ao Heroku / Netlify / Vercel / Coolify.** Conecte um servidor via SSH e faça deploy de aplicações, bancos de dados e serviços — com HTTPS automático, backup pra S3, deploy automático a cada push do GitHub, e zero agente rodando no servidor de destino.

Bun + TypeScript de ponta a ponta. Postgres, Redis/BullMQ pra filas, WebSocket dedicado pra tempo real, Vue 3 no frontend.

## Por que

A maioria das plataformas self-hosted ou consome muita máquina (agente pesado, várias camadas) ou é complexa demais pra rodar num VPS pequeno. O `yeah` é **agentless** (mesmo modelo do Coolify: só SSH, nada instalado no servidor de destino além do Docker que ele já tem) e usa Bun em todo o backend — driver Postgres nativo, WebSocket nativo, hash de senha nativo, cliente S3 nativo — pra rodar leve mesmo numa máquina de 1GB de RAM.

## Funcionalidades

- **Deploy de aplicações** via Git (URL manual ou GitHub App com auto-deploy em push), build via Dockerfile, log ao vivo no navegador
- **Bancos de dados um-clique**: PostgreSQL, MySQL, MariaDB, Redis, MongoDB
- **Catálogo de serviços um-clique**: Uptime Kuma, n8n, MinIO, RabbitMQ, Meilisearch, Ghost, Metabase, Portainer, Adminer, Redis Commander — qualquer imagem pública, além dos bancos
- **Backup agendado** (cron) com retenção configurável, local ou em qualquer S3-compatível (AWS, MinIO, R2, Spaces)
- **HTTPS automático**: proxy reverso Traefik por servidor, domínio wildcard, certificado Let's Encrypt — sem publicar porta manualmente
- **Monitoramento de servidor**: CPU/RAM/disco ao vivo (sem agente, só SSH), com alerta na transição pro limiar
- **Notificações**: Discord, Slack, Telegram, Email (SMTP — qualquer provedor), webhook genérico — deploy, backup, servidor caiu, uso de recursos, filtro por tipo de evento
- **Tela de atualizações**: versão da plataforma e das imagens Docker em uso vs. a mais recente — checagem manual, nada automático
- **Projetos organizados por time**: `Team → Project → Environment → Recurso` — mas a instância é **single-admin**: `/register` só funciona uma vez, sem convite nem forma de outra pessoa ganhar login nela
- **A própria máquina já entra como servidor**: `install.sh` gera e autoriza uma chave SSH pra ela mesma, então dá pra fazer o primeiro deploy sem cadastrar servidor nenhum manualmente — igual o "localhost" do Coolify
- **Painel opcionalmente escondível**: porta padrão não-óbvia, e um caminho secreto opt-in (`PANEL_PATH` no `.env`) pra quem quiser — qualquer URL fora dele para de responder
- **Tudo em tempo real**: WebSocket dedicado pra status de deploy, banco, serviço, backup, proxy e métricas

Veja `docs/ROADMAP.md` pro que ainda falta (incluindo paridade completa com Coolify) e `docs/DEVLOG.md` pro histórico de como cada peça foi construída e testada.

## Instalação rápida (Ubuntu/Debian)

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash
```

Um comando: instala Docker se faltar, sobe Postgres/Redis/API/worker/WS/dashboard via `docker compose`, roda as migrations. Detalhes, requisitos e como atualizar depois: **[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

## Desenvolvimento local

```bash
git clone https://github.com/flazo0/yeah.git && cd yeah
cp .env.example .env
bun run dev:infra   # Postgres + Redis via docker compose
bun install
bun run db:generate && bun run db:migrate
bun run dev          # api :3000, worker, ws :3001, web :5173
```

Crie sua conta em `http://localhost:5173/register`. Guia completo em **[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

## Estrutura

```
apps/
  api/     Elysia — HTTP API, autenticação por sessão, enfileira jobs
  worker/  BullMQ worker — única parte do sistema que fala SSH com os servidores dos usuários
  ws/      Bun WebSocket — repassa eventos do Redis pub/sub pros clientes conectados
  web/     Vue 3 + Vite + Tailwind — dashboard (Monaco pra config, xterm.js pra terminal)
packages/
  db/             Schema Drizzle + client (Postgres via driver nativo do Bun)
  shared/         Tipos TypeScript compartilhados entre todos os apps
  queue/          Filas/pub-sub BullMQ + Redis compartilhadas entre api/worker/ws
  ssh/            Cliente SSH (ssh2), usado só pelo worker
  storage/        Wrapper fino sobre o Bun.S3Client nativo
  github/         JWT do GitHub App, tokens de instalação, verificação de webhook
  notifications/  Envio pra Discord/Slack/Telegram/webhook genérico
```

Arquitetura completa (por que 4 processos, modelo de domínio, fluxo de deploy passo a passo, sistema de eventos): **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Como o sistema é montado, modelo de domínio, fluxo de deploy, design system |
| [docs/API.md](docs/API.md) | Referência de todas as rotas HTTP + eventos WebSocket |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Instalação em produção e desenvolvimento local, passo a passo |
| [docs/ROADMAP.md](docs/ROADMAP.md) | O que já funciona, o que falta, paridade com Coolify |
| [docs/DEVLOG.md](docs/DEVLOG.md) | Histórico de cada fase — o que foi testado e como |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Como rodar, convenções, antes de abrir PR |

## Nota de segurança

Segredos no Postgres (chaves SSH dos servidores, senhas de banco, chave secreta S3, senha SMTP, URLs de webhook/token de notificação e o `.env` de cada recurso) são criptografados em repouso com AES-256-GCM, usando a `ENCRYPTION_KEY` do `.env` (gerada pelo `install.sh`). **Guarde essa chave**: sem ela, o que já foi gravado não pode ser lido. Pra trocar a chave, mova a atual pra `ENCRYPTION_KEY_PREVIOUS` (aceita várias, separadas por vírgula) e gere uma nova. Login, criação e webhooks têm rate limit, e o `state` da conexão com o GitHub é assinado e expira em 10 minutos. Detalhes em `docs/ARCHITECTURE.md`.

## Licença

MIT — veja [LICENSE](LICENSE).
