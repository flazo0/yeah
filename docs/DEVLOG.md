# Devlog

Registro cronológico do que foi construído, testado e decidido em cada fase — escrito durante o desenvolvimento, em primeira pessoa, como histórico de decisões (não como documentação de referência; pra isso veja `docs/ARCHITECTURE.md` e `docs/API.md`).

## Fase 0 — Fundação

- Auth por sessão (cookie + tabela `sessions`), times com papéis (owner/admin/member), convites
- Cadastro de servidor com chave SSH, checagem de conexão assíncrona (API enfileira → worker executa SSH → Postgres atualizado → evento no Redis → `ws` repassa pro navegador em tempo real)
- Dashboard com tema claro/escuro persistido, editor Monaco pro campo de chave privada, terminal xterm.js (eco local — exec real por SSH veio depois, junto com deploy)

## Fase 1 — Deploy de aplicações

`app/Actions/Application` do Coolify traduzido pro nosso pipeline:

- Recurso `Application`: repo + branch + servidor + porta + variáveis de ambiente (`.env` bruto, editor Monaco)
- Deploy real via `worker`: conecta por SSH, `git clone`/`fetch+reset` incremental, `docker build`, `docker rm -f` do container anterior, `docker run` com `--env-file` — testado de ponta a ponta contra um alvo SSH+Docker real (não é mock)
- Log de build em tempo real no navegador via xterm.js, transmitido pelo `ws` (mesmo canal `deployment.log`/`deployment.status` que já existia desde a Fase 0) e persistido em `deployments.log` pra sobreviver a um reload
- Histórico de deploys por aplicação

Ainda faltando: só suporta `buildPack: dockerfile` (sem Nixpacks/Railpack/Compose/estático).

## GitHub App

Conecta um App do GitHub por time pra escolher repositório numa lista em vez de colar URL, e faz auto-deploy a cada push:

- `packages/github`: assina o JWT do App (RS256, via `node:crypto`, sem lib de JWT), troca por um token de instalação (válido 1h, renovado a cada deploy — nunca fica guardado), lista repositórios da instalação, e verifica assinatura HMAC de webhook em tempo constante (`timingSafeEqual`)
- Tela "GitHub" na sidebar: mostra se o servidor tem um App configurado (env vars) e, se sim, um botão "Conectar GitHub" que abre a página de instalação do App; `GET /github/callback` recebe a volta do GitHub e salva a instalação (`github_installations`, uma por time)
- `Application` ganhou `githubRepo`/`githubInstallationId` — no formulário de nova aplicação, com o GitHub conectado aparece um seletor "URL manual" vs "Repositório do GitHub" com a lista de repos de verdade
- Deploy usa um token de instalação fresco embutido na URL de clone (`git remote set-url origin` antes de cada fetch, pra nunca reusar um token de 1h atrás)
- `POST /webhooks/github` verifica a assinatura, e em todo `push` casa `installationId` + `githubRepo` + `branch` pra disparar deploy automático nas aplicações certas

**Testado sem precisar de conta real do GitHub**: gerei um par de chaves RSA descartável e confirmei que o JWT assinado bate certinho (header/claims/assinatura verificados com a chave pública correspondente), testei a verificação HMAC do webhook com casos válido/inválido/adulterado, e simulei uma instalação + aplicação direto no Postgres pra confirmar que um webhook de `push` real dispara o deploy certo (e que branch errada não dispara).

**O que só dá pra testar com uma conta de verdade**: cadastrar o App em si (`github.com/settings/apps/new` é uma ação manual, sem API pra automatizar), o fluxo de instalação/callback ponta a ponta, e listar repositórios reais. Veja `.env.example` pra passo a passo de como cadastrar e quais variáveis preencher.

## Fase 2 — Bancos de dados + backups

Modelado em cima do que o Coolify de produção realmente faz (ver `docs/coolify-research.md`):

- Recurso `Database` com 5 motores — **PostgreSQL, MySQL, MariaDB, Redis, MongoDB** (`packages/shared` tem `DATABASE_ENGINES` com imagem/porta padrão e quais campos cada motor usa; Redis não tem usuário nem "database" nomeado, os outros quatro têm): provisiona via `docker run` na hora com o comando certo por motor, senha gerada, status ao vivo via `ws`
- Agendamento de backup por cron (`backup_schedules`, disparado via **BullMQ Job Scheduler** — não tem scheduler próprio) com timezone, timeout e 3 regras de retenção independentes (nº de backups / dias / GB — a primeira que bater dispara a limpeza)
- Worker roda o dump certo por motor via SSH (`pg_dump`, `mysqldump`, `mariadb-dump`, `redis-cli --rdb`, `mongodump --archive --gzip`), salva comprimido em `/opt/yeah-backups/<databaseId>/`, mede o tamanho, aplica retenção (apaga arquivo remoto + linha do banco) **antes** de avisar o navegador — achei uma condição de corrida real nisso (avisar antes da limpeza rodar mostrava um backup por 1-2s que já ia sumir)
- Download de um backup específico (API lê o arquivo via SFTP e devolve como anexo) e "Backup agora" manual
- Testado de ponta a ponta contra servidores reais (rig SSH+Docker descartável): Postgres (4 backups reais, confirmando que a retenção `retentionCount: 3` apaga o mais antigo do Postgres e do disco), Redis (provisiona + `--rdb` dump) e MySQL (provisiona + `mysqldump`) — MariaDB e MongoDB seguem o mesmo padrão de código dos dois acima
- Editar um agendamento existente (`PUT .../backup-schedule/:scheduleId`) sem precisar apagar e recriar — `upsertJobScheduler` do BullMQ re-registra pelo mesmo id, então muda cron/timezone/retenção in-place
- Excluir `Application`/`Database` (`DELETE .../applications/:id`, `DELETE .../databases/:id`): remove o container (e o volume, no caso de banco) via SSH — mesma exceção documentada de "a API não SSHa direto" que já valia pra download de backup — desregistra o agendamento do BullMQ antes de apagar a linha (senão o cron ficava batendo pra sempre num banco que não existe mais) e segue com a exclusão mesmo se a limpeza remota falhar (servidor offline, chave errada etc.) já que o cascade do Postgres cuida do resto. Achei esse cenário real testando: duas sessões antigas tinham deixado agendamentos órfãos rodando contra servidores que não existem mais (erro `ECONNREFUSED` todo dia à meia-noite) — `DELETE` neles confirmou que o job some do Redis de verdade (sem chave `bull:database-backup:repeat` sobrando)
- Frontend: card de recurso tem um botão de excluir (aparece no hover, "clique de novo pra confirmar" em 3s); telas de detalhe de app/banco têm o mesmo botão no header

### Backup em S3

Nova entidade `S3Storage` (por time, tela "Armazenamento" na sidebar: nome, endpoint opcional, região, bucket, chaves, testar conexão), agendamento aponta pra um destino (`storageId` nulo = disco do servidor, igual antes). Usa `Bun.S3Client` nativo (zero dependência nova — mesmo espírito do driver Postgres/WS/hash de senha nativos do Bun) tanto na API (URL pré-assinada pro download, delete direto) quanto no worker (upload depois do dump, delete na limpeza de retenção). O dump ainda roda no servidor remoto via SSH; o worker lê o arquivo por SFTP, sobe pro S3 e apaga a cópia temporária de lá — S3 vira a fonte de verdade, não fica duplicado.

Testado de ponta a ponta com um MinIO local fazendo de S3: criei destino → testei conexão → agendamento com destino S3 → rodei backup (dump + upload confirmados via `mc ls` no bucket) → baixei pelo link pré-assinado (gzip íntegro) → apaguei a execução (sumiu do bucket) → rodei retenção com `retentionCount: 1` (o backup antigo saiu do S3, só o novo ficou).

## Estrutural: Project / Environment

A hierarquia é `Team → Project → Environment → Recurso (Application | Database)`, igual ao Coolify:

- Todo time novo ganha um projeto `Default` com um ambiente `production` automaticamente (no registro e na criação manual de time) — nunca existe um "beco sem saída" sem lugar pra colocar um recurso
- `applications`/`databases` têm `environment_id` (FK obrigatória) além do `team_id`
- Rotas: `/teams/:teamId/projects/:projectId/environments/:environmentId/applications` (mesma ideia pra `databases`) — `servers` continuam no nível do time (compartilhados entre projetos, igual ao Coolify)
- Frontend: `/teams/:teamId` é a lista de Projetos; Servidores em `/teams/:teamId/servers`; a tela de Recursos por ambiente mostra Aplicações e Bancos de dados juntos, igual à tela "Resources" do Coolify
- Testado de ponta a ponta pela hierarquia nova: registro → projeto/ambiente automáticos → servidor → app + banco dentro do ambiente → deploy real → backup real, tudo funcionando

## Fase 5 — Proxy reverso + HTTPS automático

- Cada servidor pode ativar um Traefik (`servers.proxy_status`: inactive/provisioning/active/error, mais `wildcardDomain` e `acmeEmail` configuráveis na tela Servidores) — o worker escreve a config estática via SFTP e sobe o container com o socket do Docker montado (`providers.docker`) e `certificatesResolvers.letsencrypt` via desafio HTTP
- `Application` ganhou `domain` (opcional) — sem domínio explícito, com o proxy ativo, o domínio vira `<slug-do-nome>.<wildcardDomain>` automaticamente; com domínio (custom ou derivado), o deploy não publica mais a porta direto no host — o container entra na rede `yeah-proxy-net` e ganha labels do Traefik (`traefik.enable`, `traefik.http.routers.<container>.rule=Host(...)`, `tls.certresolver=letsencrypt`) em vez de `-p porta:porta`. Sem domínio nenhum, continua publicando a porta direto (comportamento antigo)
- Testado de ponta a ponta com o rig SSH+Docker descartável: ativei o proxy, dei deploy numa app sem domínio explícito (derivou `e2e-proxytest.apps.e2e-test.local` sozinho), confirmei as labels certas no container, bati HTTP na porta 80 (redirecionou 301 pra https) e HTTPS na 443 com o Host certo (serviu o conteúdo real do container) — e confirmei que a porta do container não ficou publicada no host (`docker inspect` mostrando `"80/tcp":null`), resolvendo de vez o problema de colisão de porta

**Achado real do ambiente de teste**: o Traefik `v3.5` não conseguia listar containers no Docker Desktop de teste (erro `API returned a 400`) — o client Docker embutido no Traefik v3 não negocia bem com uma engine muito nova (API 1.55). `v2.11` funciona perfeitamente com a mesma engine e tem a mesma config estática, então é o que está fixado no worker. Isso é uma incompatibilidade de ambiente local — fica documentado caso apareça em produção com uma engine muito nova.

**Não testável localmente**: emissão real de certificado Let's Encrypt precisa de domínio público de verdade apontando pro servidor com porta 80 alcançável da internet (desafio HTTP-01) — no teste local o Traefik caiu pro certificado autoassinado interno dele mesmo, que é o comportamento correto quando a validação ACME não consegue confirmar o domínio.

## Organização de telas no padrão Coolify

Mesma identidade visual do design system (ver `docs/ARCHITECTURE.md`), mas com a estrutura de navegação do Coolify (baseada na análise em `docs/coolify-research.md`):

- Listagem de recursos por ambiente (`EnvironmentPage.vue`): cards de recurso (`.resource-card`/`.resource-cards`) com um `.status-dot` colorido em vez de tabela — igual à grade "Resources" do Coolify
- Telas de detalhe (`ApplicationDetailPage.vue`, `DatabaseDetailPage.vue`): abas no topo (`.detail-tabs`/`.detail-tab` — Deployments/Configuration na aplicação, Backups/Configuration no banco) e, dentro de Configuration, um sub-menu lateral (`.detail-layout`/`.detail-subnav`) separando Geral de Variáveis de ambiente

## Empacotamento público — repo, instalador, documentação

Primeira vez que o projeto saiu do disco local: `git init`, `.gitignore` excluindo `coolify/`, `savvy/` (projetos de referência, não fazem parte do `yeah`) e **`docs/coolify-research.md`** (as notas de pesquisa citavam o domínio real de produção e nomes de conta do GitHub do autor — infra real de empresa, não pertence num repo público; o conteúdo útil já tinha sido incorporado nos outros docs de forma genérica). Repositório público criado em `github.com/flazo0/yeah` — havia um repo privado antigo com o mesmo nome (projeto não relacionado, de 2025); apagado com autorização explícita antes de reusar o nome.

- **`install.sh`**: instalador Ubuntu/Debian de um comando só — instala Docker se faltar, clona/atualiza em `/opt/yeah`, gera `.env` de produção com segredos aleatórios (nunca sobrescreve um existente), sobe tudo via `docker compose`, roda migrations, instala um helper `yeah` (`update`/`logs`/`restart`/`status`/`stop`) em `/usr/local/bin`. Validado só com `bash -n` (checagem de sintaxe) — não rodei num Ubuntu de verdade, deixei isso explícito.
- **`Dockerfile` multi-stage + `docker-compose.prod.yml`**: uma imagem base compartilhada (instala o monorepo inteiro uma vez), com targets `api`/`worker`/`ws`/`web` — o `web` builda a SPA e serve via nginx (`apps/web/nginx.conf`, com fallback de rota pra funcionar com o Vue Router em modo history). `YEAH_COMMIT` é passado como build arg (o `install.sh` captura `git rev-parse HEAD` antes de buildar) — sem isso a tela de Atualizações não teria como saber qual commit está rodando, já que a imagem não carrega `.git`.
- **Documentação completa**: `docs/ARCHITECTURE.md` (visão geral, modelo de domínio, fluxo de deploy, filas), `docs/API.md` (referência de toda rota HTTP + eventos WS), `docs/INSTALLATION.md`, `docs/ROADMAP.md`, `CONTRIBUTING.md`, `LICENSE` (MIT). O README antigo (que também servia de diário de bordo) virou este arquivo — o README agora é só a porta de entrada.

## Catálogo de serviços, notificações, monitoramento de servidor e tela de atualizações

Construído numa rodada sem parar pra testar cada peça no rig SSH+Docker (autorização explícita do usuário: "vai criando e desenvolvendo sem testes por enquanto") — validação foi typecheck do monorepo inteiro + smoke test via `curl` direto na API (sem servidor real conectado), não o ciclo completo de E2E que as fases anteriores tiveram.

- **Catálogo de serviços** (`packages/shared/src/serviceCatalog.ts`): 10 entradas (Uptime Kuma, n8n, MinIO, RabbitMQ, Meilisearch, Ghost, Metabase, Portainer, Adminer, Redis Commander) — cada uma com imagem, porta, template de `.env` e path de volume opcional. Nova entidade `Service` segue a mesma forma de `Application`/`Database` (nome, servidor, ambiente, domínio opcional via o mesmo mecanismo de proxy), mas o worker (`provisionService.ts`) só faz `docker run` da imagem do catálogo — sem clone/build.
- **Notificações** (`packages/notifications`): Discord (embed), Slack (texto formatado), Telegram (MarkdownV2, com escape de caracteres especiais) e webhook genérico — todas best-effort (nunca lançam, só logam e retornam `false`). Testei a assinatura sem precisar de conta/canal real: CRUD completo via `curl` (criar, listar, testar contra uma URL que não existe → falha graciosa, `false`, sem crashar; toggle; deletar).
- **Monitoramento de servidor** (`serverMetrics.ts`, job de sistema agendado uma vez no boot do worker): lê `/proc/stat` (CPU, comparando duas amostras com 1s de intervalo), `/proc/meminfo` (RAM) e `df -P /` (disco) — escolhido deliberadamente em vez de `top` porque o formato desses arquivos é do kernel, idêntico entre busybox e coreutils (parsing de `top` varia entre os dois). Alerta só na *transição* pra cima do limiar (90% CPU/RAM, 85% disco), não em todo tick — evita spam enquanto o servidor fica sustentado no limite.
- **Tela de Atualizações**: versão da plataforma via `YEAH_COMMIT` vs HEAD do `main` no GitHub; tags de imagem via Docker Hub. Achei um bug real testando: a primeira versão comparava contra "a tag mais recentemente empurrada" (`ordering=last_updated`), que pra imagens como `traefik` retornava variantes tipo `windowsservercore-ltsc2025` — corrigido filtrando por tags com a mesma forma da atual (mesmo prefixo `v`, mesmo sufixo não-numérico) e comparando os números de versão de verdade.
- Achado real do smoke test: criar um serviço apontando pra um servidor cujo rig SSH não estava mais no ar corretamente foi pro status `error` sem derrubar o worker nem os outros jobs (incluindo o próprio `server-metrics` rodando em paralelo) — confirma que o padrão de isolamento de falha por job já estabelecido nas fases anteriores se mantém aqui.

## Limites de recurso por container

Primeiro item da lista de robustez a sair depois do empacotamento público — `--memory`/`--cpus` configuráveis por `Application`/`Database`/`Service`, pra um container sem limite não conseguir mais consumir a máquina inteira e derrubar os outros.

- `packages/db/src/schema/columns.ts`: helper `resourceLimitColumns()` (`memoryLimitMb: integer`, `cpuLimit: real`, ambos nullable) espalhado nas três tabelas via spread — evitou triplicar as mesmas duas colunas.
- `packages/shared/src/types.ts`: `ResourceLimits` interface + `resourceLimitFlags()`, que vira `--memory=<mb>m --cpus=<cpu>` (com espaço à direita) quando algum limite está setado, ou string vazia quando os dois são `null` — os três jobs do worker (`deployApplication.ts`, `provisionDatabase.ts`, `provisionService.ts`) injetam isso direto no `docker run`.
- Rotas de API: os três `POST` de criação aceitam `memoryLimitMb`/`cpuLimit` opcionais; cada recurso ganhou `PUT .../limits` pra editar depois. Bancos reenfileira o provisionamento na hora (o processor já recria o container idempotentemente) — aplicações e serviços aplicam no próximo deploy/redeploy, igual ao padrão que domínio/env já seguem.
- **Achado real**: o schema TypeBox do Elysia (`t.Optional(t.Number())`) rejeita `null` explícito — só aceita "campo ausente". Como o frontend manda `null` pra "sem limite" (em vez de omitir o campo), a validação falhava em silêncio. Corrigido trocando pra `t.Optional(t.Nullable(t.Number()))` nas seis rotas que tocam esses campos.
- Testado contra banco real (não só typecheck): subi o Postgres/Redis de dev, apliquei a migration `0009_far_mesmero.sql`, confirmei as colunas via `psql`, subi a API e testei via `curl` contra dados reais de uma sessão existente — criar aplicação com limites, editar pra outro valor, e limpar mandando `null` explícito, os três casos retornando o DTO certo.


## Notificações com filtro por tipo de evento

Segundo item da lista de robustez — até aqui todo canal ativo recebia todo tipo de alerta; agora dá pra escolher por canal (ex.: só falhas críticas no Telegram, tudo no Discord).

- `notification_channels.events` (`text[]`, nullable): `null` = todos os tipos (comportamento anterior, preservado pra canais já existentes); setado = só os tipos listados.
- `NotificationEventType` (`packages/shared/src/types.ts`): união fechada com os seis tipos que os jobs do worker já disparavam (`deploy.success`, `deploy.failed`, `backup.failed`, `server.down`, `server.reconnected`, `server.metrics`) — mais `NOTIFICATION_EVENT_LABELS` pros rótulos em português no frontend.
- `notifyTeam()` (`apps/worker/src/lib/notify.ts`) ganhou um parâmetro `event` obrigatório; o filtro vira `channel.events === null || channel.events.includes(event)`. Todo call site (`deployApplication`, `backupDatabase`, `checkServer`, `serverMetrics`) passou a informar o tipo certo.
- Frontend (`NotificationsPage.vue`): checkboxes de evento no formulário de criação e um editor inline por canal (`tune` → marca/desmarca → salva) — nenhum marcado equivale a `null` (todos).
- Testado contra banco real: criei um canal só com `deploy.failed`+`backup.failed`, outro sem filtro (`null`), editei o filtro do primeiro pra `server.down` e depois limpei de volta pra `null` — os quatro casos retornando o formato certo.

