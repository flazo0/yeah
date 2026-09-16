# Referência da API

Base URL em dev: `http://localhost:3000`. Autenticação por cookie de sessão httpOnly (`SESSION_COOKIE`) — não há tokens Bearer. Todas as rotas autenticadas retornam `401` sem cookie válido e `403` se o usuário não for membro do time (`assertMember`).

Convenção de erro: `{ "error": "mensagem" }` com o status HTTP correspondente. Sucesso geralmente `{ "ok": true }` ou o recurso serializado (`{ "server": {...} }`, etc.) — os shapes exatos (`*Dto`) estão em `packages/shared/src/types.ts`.

## Auth (`/auth`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password (≥8), name? }` | Cria usuário + time pessoal + projeto/ambiente `Default`/`production` automáticos. Seta cookie de sessão |
| POST | `/auth/login` | `{ email, password }` | Seta cookie de sessão |
| POST | `/auth/logout` | — | Destrói a sessão |
| GET | `/auth/me` | — | Usuário autenticado atual (`null` se não logado) |

## Times (`/teams`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `/teams` | — | Times do usuário logado, com o papel dele em cada um |
| POST | `/teams` | `{ name }` | Cria time (usuário vira `owner`) + projeto/ambiente padrão |
| POST | `/teams/:teamId/invitations` | `{ email, role? }` | Convida (precisa ser `owner`/`admin`) |
| POST | `/teams/invitations/:token/accept` | — | Aceita convite pendente |

## Servidores (`/teams/:teamId/servers`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `/teams/:teamId/servers` | — | Lista servidores do time |
| POST | `/teams/:teamId/servers` | `{ name, host, port?, sshUser?, privateKey }` | Cadastra servidor (status inicial `pending`) |
| POST | `/teams/:teamId/servers/:serverId/test-connection` | — | Enfileira checagem SSH assíncrona (`server-check`) — resultado chega via WS (`server.status`) |
| PUT | `/teams/:teamId/servers/:serverId/domain` | `{ wildcardDomain?, acmeEmail? }` | Configura domínio wildcard e e-mail do Let's Encrypt |
| POST | `/teams/:teamId/servers/:serverId/proxy` | — | Enfileira provisionamento do Traefik (`proxy-provision`) — resultado via WS (`server.proxy`) |

## Armazenamento S3 (`/teams/:teamId/storages`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `/teams/:teamId/storages` | — | Lista destinos S3 do time (sem `secretAccessKey`) |
| POST | `/teams/:teamId/storages` | `{ name, endpoint?, region?, bucket, accessKeyId, secretAccessKey }` | Cria destino (`endpoint` vazio = AWS S3 real) |
| POST | `/teams/:teamId/storages/:storageId/test-connection` | — | Escreve e apaga um objeto marcador — síncrono, sem worker |
| DELETE | `/teams/:teamId/storages/:storageId` | — | Remove o destino (agendamentos que apontavam pra ele voltam pra "storage_id = null" via FK `ON DELETE SET NULL`) |

## GitHub App

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `/teams/:teamId/github` | — | `{ configured, installation }` — se o servidor tem `GITHUB_APP_*` e se o time já conectou |
| GET | `/teams/:teamId/github/install-url` | — | URL de instalação do App no GitHub |
| GET | `/github/callback` | query: `installation_id, state, setup_action` | Callback do GitHub — salva a instalação e redireciona pro dashboard |
| GET | `/teams/:teamId/github/repos` | — | Lista repositórios da instalação conectada (minta token de instalação na hora) |
| DELETE | `/teams/:teamId/github` | — | Desconecta (não desinstala o App no lado do GitHub) |
| POST | `/webhooks/github` | raw body + header `X-Hub-Signature-256` | Recebe push events, casa `installationId`+`repo`+`branch` e dispara deploy |

## Projetos e ambientes (`/teams/:teamId/projects`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `/teams/:teamId/projects` | — | Lista projetos com `environmentCount` |
| POST | `/teams/:teamId/projects` | `{ name, firstEnvironmentName? }` | Cria projeto + primeiro ambiente (default `"production"`) |
| GET | `/teams/:teamId/projects/:projectId` | — | Detalhe do projeto |
| GET | `/teams/:teamId/projects/:projectId/environments` | — | Lista ambientes com `applicationCount`/`databaseCount` |
| POST | `/teams/:teamId/projects/:projectId/environments` | `{ name }` | Cria ambiente |

## Aplicações (`/teams/:teamId/projects/:projectId/environments/:environmentId/applications`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `.../applications` | — | Lista aplicações do ambiente |
| POST | `.../applications` | `{ name, serverId, repoUrl? \| githubRepo?, branch?, port? }` | Cria (exatamente um de `repoUrl`/`githubRepo`) |
| GET | `.../applications/:id` | — | Detalhe |
| PUT | `.../applications/:id/env` | `{ envContent }` | Substitui o `.env` bruto (aplica no próximo deploy) |
| PUT | `.../applications/:id/domain` | `{ domain? }` | Seta/limpa domínio customizado |
| GET | `.../applications/:id/deployments` | — | Histórico (últimos 20) |
| GET | `.../applications/:id/deployments/:deploymentId` | — | Um deploy específico (com log completo) |
| POST | `.../applications/:id/deploy` | — | Enfileira deploy (`application-deploy`) |
| DELETE | `.../applications/:id` | — | Remove container remoto via SSH (best-effort) e apaga a linha (cascade em `deployments`) |

## Bancos de dados (`/teams/:teamId/projects/:projectId/environments/:environmentId/databases`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `.../databases` | — | Lista bancos do ambiente |
| POST | `.../databases` | `{ name, serverId, engine?, image?, port?, username?, databaseName? }` | Cria e enfileira provisionamento. `engine` default `postgresql`; ver `DATABASE_ENGINES` pra defaults por motor |
| GET | `.../databases/:id` | — | Detalhe |
| GET | `.../databases/:id/backup-schedule` | — | Agendamento atual (ou `null`) |
| POST | `.../databases/:id/backup-schedule` | `{ cron, timezone?, timeoutSeconds?, retentionCount?, retentionDays?, retentionSizeGb?, storageId? }` | Cria (409 se já existir um) |
| PUT | `.../databases/:id/backup-schedule/:scheduleId` | mesmos campos, todos opcionais | Edita in-place (cron/timezone/retenção/destino) sem apagar e recriar |
| DELETE | `.../databases/:id/backup-schedule/:scheduleId` | — | Remove o agendamento e desregistra o job scheduler do BullMQ |
| POST | `.../databases/:id/backup-schedule/:scheduleId/run-now` | — | Dispara backup manual |
| GET | `.../databases/:id/backup-executions` | — | Últimas 50 execuções |
| GET | `.../databases/:id/backup-executions/:executionId/download` | — | Local: stream via SFTP. S3: redirect 302 pra URL pré-assinada |
| DELETE | `.../databases/:id/backup-executions/:executionId` | — | Apaga o arquivo (S3 ou remoto) e a linha |
| DELETE | `.../databases/:id` | — | Remove container + volume remoto via SSH (best-effort), desregistra agendamento do BullMQ, apaga a linha (cascade) |

## WebSocket (`ws`, porta separada — `WS_PORT`)

Conecta em `ws://<host>:<WS_PORT>`. Sem autenticação própria — o socket só recebe eventos já públicos-pro-usuário-logado no sentido de que o frontend filtra por IDs que ele já tem carregados na tela (não há canal privado por usuário ainda; ver `docs/ROADMAP.md`). Mensagens são o JSON de `WsServerEvent` (ver `docs/ARCHITECTURE.md`).
