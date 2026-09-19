# Arquitetura

## Visão geral

`yeah` é um plano de controle (control plane) que orquestra servidores remotos via SSH — ele nunca roda a aplicação do usuário, só manda o servidor remoto rodar via Docker. Isso é o mesmo modelo agentless do Coolify: você aponta um servidor com uma chave SSH, e o `yeah` cuida do resto (deploy, provisionamento de banco, backup, proxy reverso) mandando comandos por SSH.

```
┌─────────────┐      HTTP       ┌──────────┐     enfileira jobs     ┌────────┐
│   web (Vue)  │ ───────────────▶│   api    │ ───────────────────────▶│ Redis  │
└─────────────┘                 │ (Elysia) │                          │(BullMQ)│
       ▲                         └────┬─────┘                          └───┬────┘
       │ WebSocket                    │ lê/escreve                         │ processa
       │                              ▼                                    ▼
┌─────────────┐   pub/sub Redis  ┌──────────┐                        ┌──────────┐
│      ws      │◀─────────────────│ Postgres │                        │  worker  │
└─────────────┘                  └──────────┘                        └────┬─────┘
                                                                            │ SSH
                                                                            ▼
                                                                    ┌───────────────┐
                                                                    │ servidor do    │
                                                                    │ usuário (Docker)│
                                                                    └───────────────┘
```

## Por que 4 processos separados

- **`api`** (Elysia) — só HTTP. Nunca fala SSH diretamente com o servidor do usuário (com duas exceções deliberadas e documentadas no código: download de backup e teardown na exclusão — ambos são operações síncronas e limitadas que o navegador já está esperando, não vale a pena um job + polling só pra isso).
- **`worker`** (BullMQ) — a única parte do sistema que fala SSH com os servidores dos usuários. Se cair, os deploys enfileiram e esperam; a API continua respondendo.
- **`ws`** — processo dedicado só pra WebSocket. Assina um canal Redis (`SERVER_EVENTS_CHANNEL`) onde `api` e `worker` publicam eventos, e repassa pro navegador certo. Separado da API pra não competir por conexões/threads com requisições HTTP normais.
- **`web`** — SPA Vue 3, fala com `api` via fetch e com `ws` via WebSocket nativo.

Essa separação existe pra robustez, não performance prematura: um deploy travado no `worker` não derruba a API nem trava outros usuários vendo o dashboard.

## Bun em vez de Node — onde isso importa de verdade

- **Driver Postgres nativo** (`drizzle-orm/bun-sql`) — sem `pg`/`postgres.js` como dependência de runtime (só como devDependency do `drizzle-kit` CLI, que precisa de um driver próprio pra introspecção).
- **`Bun.password`** (argon2id) pra hash de senha — sem `bcrypt`/`argon2` nativo compilado.
- **`Bun.S3Client`** — cliente S3 nativo, funciona com qualquer serviço S3-compatível (AWS, MinIO, R2, Spaces) passando `endpoint`. Zero dependência de `@aws-sdk/*`.
- **WebSocket nativo** (`Bun.serve({ websocket: ... })`) no `ws`.
- **`node:crypto`** ainda é usado onde faz sentido (assinar JWT do GitHub App com RS256, HMAC de webhook) — Bun tem compat total com a API do Node aqui, não precisou de lib de JWT.

## Pacotes compartilhados (`packages/`)

| Pacote | Usado por | O que faz |
|---|---|---|
| `db` | todos | Schema Drizzle + client Postgres |
| `shared` | todos | Tipos TypeScript + `DATABASE_ENGINES` + `SERVICE_CATALOG` + `shellQuote`/`PROXY_NETWORK_NAME` (zero dependência pesada — de propósito, pra lógica pura tipo `docker run` de cada job poder ser testada sem carregar `ssh2`) |
| `queue` | api, worker, ws | Definições de fila/pub-sub BullMQ + Redis |
| `ssh` | worker | Cliente SSH (ssh2) — só o worker importa isso |
| `storage` | api, worker | Wrapper fino sobre `Bun.S3Client` |
| `github` | api, worker | JWT do GitHub App, token de instalação, verificação de webhook |
| `notifications` | worker | Envio pra Discord/Slack/Telegram/Email (SMTP, via `nodemailer`)/webhook genérico — best-effort, nunca lança |

## Modelo de domínio

```
User ──┬── TeamMember ──── Team ──┬── Server (SSH, por time — compartilhado entre projetos)
        │                          ├── S3Storage (por time — destino de backup)
        │                          ├── GithubInstallation (0 ou 1 por time)
        │                          ├── NotificationChannel (por time — Discord/Slack/Telegram/webhook)
        │                          └── Project ──── Environment ──┬── Application
        │                                                          ├── Database ──┬── BackupSchedule
        │                                                          │               └── BackupExecution
        │                                                          └── Service (catálogo — Uptime Kuma, n8n, MinIO...)
        └── Session (cookie)
```

- **Team → Project → Environment → Recurso** é a mesma hierarquia do Coolify. Todo time novo ganha um projeto `Default` com ambiente `production` automaticamente — nunca existe um "beco sem saída" sem lugar pra colocar um recurso.
- **`User`/`TeamMember`/papéis existem, mas `yeah` é single-admin de propósito** — `POST /auth/register` só funciona enquanto não existe usuário nenhum (`hasAnyUser()` em `apps/api/src/routes/auth.ts`), e não há rota de convite (removida — nunca teve frontend, e servia só pra uma segunda pessoa ganhar login, exatamente o que está bloqueado). O modelo de time continua existindo porque todo recurso é escopado por `teamId`, não porque mais de um usuário é esperado.
- **A própria máquina onde o `yeah` roda já entra como o primeiro `Server`** — no registro da conta de admin (a única), `createLocalhostServerIfConfigured()` (`apps/api/src/lib/localhostServer.ts`) insere um `Server` apontando pra `host.docker.internal` usando uma chave SSH que o `install.sh` gera e já autoriza em `~/.ssh/authorized_keys` do host. O `worker` alcança isso via `extra_hosts: host-gateway` (`docker-compose.prod.yml`) — é a única peça do stack que fala SSH, então é a única que precisa desse mapeamento. Sem `LOCALHOST_SSH_PRIVATE_KEY_BASE64` no `.env` (ex.: instalação anterior a essa feature), esse passo é pulado silenciosamente.
- **Server** é do time, não do projeto — um servidor físico é compartilhado entre vários projetos/ambientes, igual no Coolify.
- **Application.domain** nulo = porta publicada direto no host (`-p porta:porta`). Setado (manual ou derivado do `wildcardDomain` do servidor) = roteado via Traefik, sem publicar porta.
- **Database.username/databaseName** são nuláveis porque Redis não tem esses conceitos — veja `DATABASE_ENGINES` em `packages/shared/src/types.ts` pra saber quais campos cada motor usa.
- **BackupSchedule.storageId** nulo = dump fica no disco do servidor remoto. Setado = sobe pro S3 e apaga a cópia local.
- **Service** segue a mesma forma de Application/Database (nome, servidor, ambiente, domínio opcional), mas a imagem/porta/env-template vêm de uma entrada estática do catálogo (`packages/shared/src/serviceCatalog.ts`) em vez de um build de repositório ou um motor de banco embutido no código.
- **Server.cpuPercent/memPercent/diskPercent/metricsCheckedAt** são a última leitura do job periódico `server-metrics` (a cada 60s, todo servidor `connected`) — não é uma série histórica, só o snapshot mais recente.
- **Application/Database/Service.memoryLimitMb/cpuLimit** (`resourceLimitColumns()` em `packages/db/src/schema/columns.ts`) são nuláveis — `null` nos dois significa sem limite (comportamento padrão). Quando setados, viram `--memory=<mb>m`/`--cpus=<cpu>` no `docker run` via `resourceLimitFlags()` (`packages/shared/src/types.ts`).

## Fluxo de um deploy, passo a passo

1. Usuário clica "Deploy" → `POST .../deploy` cria uma linha em `deployments` (status `queued`) e enfileira um job no BullMQ (`application-deploy`).
2. `worker` pega o job, conecta via SSH no servidor da aplicação.
3. Escreve o `.env` da aplicação via SFTP.
4. Clona ou atualiza o repo (`git clone` ou `fetch` + `reset --hard`) — se a aplicação usa GitHub App, minta um token de instalação fresco antes (válido só 1h, nunca fica guardado) e faz `git remote set-url origin` com o token embutido antes de cada fetch/clone.
5. `docker build` a partir do `Dockerfile` do repo.
6. Remove o container anterior (`docker rm -f`, tolera não existir).
7. Sobe o novo: com domínio → junta a rede `yeah-proxy-net` e ganha labels do Traefik; sem domínio → publica a porta direto no host.
8. Cada linha de output dos comandos acima é publicada no Redis (`deployment.log`) e repassada pelo `ws` pro navegador em tempo real via xterm.js.
9. Ao final, atualiza `deployments.status` e `applications.status`, publica `deployment.status`.

O mesmo padrão (job assíncrono → SSH → log em tempo real → status final) se repete pra provisionamento de banco, backup e provisionamento de proxy.

## Sistema de eventos em tempo real

Um único canal Redis (`SERVER_EVENTS_CHANNEL`) carrega todos os tipos de evento, multiplexados por um discriminated union (`WsServerEvent` em `packages/shared/src/types.ts`):

```ts
type WsServerEvent =
  | { type: "server.status"; serverId; status; dockerVersion? }
  | { type: "server.proxy"; serverId; proxyStatus }
  | { type: "server.metrics"; serverId; cpuPercent; memPercent; diskPercent }
  | { type: "deployment.log"; deploymentId; line }
  | { type: "deployment.status"; deploymentId; status }
  | { type: "database.status"; databaseId; status }
  | { type: "service.status"; serviceId; status }
  | { type: "backup.status"; executionId; scheduleId; status };
```

`api`/`worker` publicam, `ws` assina e repassa por WebSocket puro (sem Socket.IO) pra todo cliente conectado. O frontend (`apps/web/src/lib/ws.ts`) mantém uma única conexão WebSocket compartilhada e distribui eventos pra quem estiver escutando (`wsClient.on(callback)`).

## Filas (BullMQ)

Oito filas, cada uma com seu próprio par de conexões Redis dedicadas (uma pra consumir jobs, outra só pra publicar eventos — evita que uma conexão em modo "block" pra pegar jobs atrapalhe publicações):

| Fila | Job data | O que faz |
|---|---|---|
| `server-check` | `{ serverId }` | Testa conexão SSH, atualiza status/versão do Docker |
| `application-deploy` | `{ deploymentId }` | O fluxo de deploy descrito acima |
| `database-provision` | `{ databaseId }` | `docker run` do motor certo (Postgres/MySQL/MariaDB/Redis/MongoDB) |
| `database-backup` | `{ scheduleId, manual? }` | Dump + upload S3 opcional + retenção. Agendado via **BullMQ Job Scheduler** (`upsertJobScheduler`/`removeJobScheduler`) — não tem scheduler próprio |
| `proxy-provision` | `{ serverId }` | Sobe o Traefik no servidor com config de ACME |
| `service-provision` | `{ serviceId }` | `docker run` da imagem do catálogo, com volume nomeado se a entrada pedir persistência |
| `server-metrics` | `{}` | Job de sistema, único, agendado uma vez no boot do worker (`ensureServerMetricsScheduler`, a cada 60s) — a cada tick, percorre todo servidor `connected` e lê `/proc/stat`+`/proc/meminfo`+`df` por SSH |
| `tls-check` | `{}` | Job de sistema, único, agendado uma vez no boot do worker (`ensureTlsCheckScheduler`, a cada 24h) — conecta via `node:tls` (sem SSH) em todo domínio de `Application`/`Service` em uso e alerta se faltar ≤14 dias pro certificado expirar |

Notificações (`packages/notifications`) não têm fila própria — são disparadas inline, fire-and-forget, direto de dentro dos jobs acima (`deployApplication`, `backupDatabase`, `checkServer`, `serverMetrics`) via o helper `apps/worker/src/lib/notify.ts`. Uma falha ao enviar (webhook fora do ar, token errado) é logada e engolida — nunca derruba o job que a disparou. Cada canal pode filtrar por `NotificationChannel.events` (`text[]`, nullable — `null` = recebe todo `NotificationEventType`); `notifyTeam(teamId, event, ...)` exige o tipo do evento e filtra os canais antes de despachar.

## Proxy reverso — dois níveis diferentes, não confundir

1. **Por servidor de usuário** (`provisionProxy.ts`, Traefik): cada servidor pode ativar seu próprio Traefik, que roteia as *aplicações do usuário* deployadas nele. É o worker que sobe isso via SSH.
2. **Do próprio `yeah`** (produção, via `docker-compose.prod.yml` + `install.sh`, nginx): o container `web` já embute um nginx que reverse-proxya `/api/*` e `/ws` pros containers `api`/`ws` internamente (`apps/web/nginx.conf`) — `api`/`ws` ficam só em `127.0.0.1` no host, nunca expostos direto. Só a porta do `web` precisa estar alcançável de fora. Isso também resolve o frontend nunca precisar saber seu próprio host/IP público em tempo de build (`lib/api.ts`/`lib/ws.ts` usam caminho relativo). Se você quiser HTTPS/domínio próprio na frente disso, é *infra de quem hospeda o `yeah`* (Caddy/nginx externo, ver `docs/INSTALLATION.md`) — coisa separada do Traefik do item 1, que é *feature do produto*.

### `PANEL_PATH` — caminho secreto opcional pro painel

Desligado por padrão — o dashboard responde em `/` como qualquer app normal. Quem quiser uma camada extra de obscuridade pode setar `PANEL_PATH` no `.env` (ex.: `/a1b2c3d4`) e rodar `sudo yeah update`: o dashboard passa a só responder sob esse caminho, e qualquer outra URL na mesma porta (incluindo `/`) recebe `return 444` do nginx (conexão fechada, nem uma resposta HTTP válida). Uma única variável alimenta tudo quando setada: o `base` do Vite (`vite.config.ts`, via `VITE_BASE_PATH`), a base do Vue Router (`createWebHistory(import.meta.env.BASE_URL)`), o prefixo relativo de `lib/api.ts`/`lib/ws.ts`, e o `location` do nginx — reescrito no boot do container por `apps/web/docker-entrypoint-panel-path.sh` (um hook de `/docker-entrypoint.d/` da própria imagem oficial do nginx) só quando `PANEL_PATH` não está vazio; do contrário o script não faz nada e fica valendo o `nginx.conf` simples baked na imagem. É uma camada de obscuridade em cima da autenticação real que já existe — não a substitui, e não é o padrão porque a maioria não precisa disso.

## Padrão de exceção "a API nunca fala SSH direto"

Documentado com comentário no código em cada ocorrência (`servers.ts`, `databases.ts`, `applications.ts`, `services.ts`). As únicas exceções:

- **Download de backup**: leitura síncrona e limitada via SFTP — o navegador já está esperando o arquivo, rotear por um job + endpoint de polling só adicionaria latência sem ganho nenhum.
- **Exclusão de Application/Database/Service**: teardown do container (e volume, no caso de banco/serviço com persistência) via SSH antes de apagar a linha do Postgres. Se o SSH falhar (servidor offline, chave errada), a exclusão segue em frente mesmo assim — o cascade do Postgres cuida do resto, e não faz sentido travar o usuário só porque não conseguimos limpar o container remoto.

## Segurança conhecida (pré-produção)

- `servers.private_key` e `databases.password` ficam em texto puro no Postgres. Aceitável pro estágio atual; precisa de criptografia em repouso (libsodium sealed box ou KMS) antes de qualquer deploy real com dados sensíveis.
- `github/install-url`'s `state` é o `teamId` puro, sem assinatura — um TODO no código já marca isso: devia ser um token assinado e de curta duração antes de produção.
- Nada disso é bloqueante pra self-host num ambiente confiável/interno, mas é o primeiro item de segurança a resolver antes de expor publicamente pra usuários que você não controla.

## Design system

Frontend portado do projeto **Savvy** do autor (`savvy/src/views` e `savvy/src/public/css/app.css` — não faz parte deste repositório, é referência de design usada durante o desenvolvimento). Paleta vermelha (`--red-50..900`) definida duas vezes em `apps/web/src/styles/main.css` — uma vez em `:root` (light), outra em `.dark`, com a rampa do dark deliberadamente invertida pra ler bem contra preto. Fontes (Google Sans Code + Material Symbols Outlined) auto-hospedadas em `apps/web/public/fonts/`, baixadas de mirrors open-source no GitHub — nunca carregadas do CDN do Google.

Organização de telas segue o padrão do Coolify (abas + sub-menu nas telas de detalhe, grade de cards na listagem de recursos) — ver `docs/DEVLOG.md` pra detalhes de cada tela.
