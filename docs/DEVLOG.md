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


## Alerta de certificado TLS perto de expirar

Terceiro item da lista de robustez — o Traefik renova sozinho via Let's Encrypt, mas até aqui não existia nenhuma checagem própria avisando se essa renovação falhou silenciosamente.

- **Job de sistema `tls-check`** (`apps/worker/src/jobs/tlsCheck.ts`), agendado uma vez no boot do worker (`ensureTlsCheckScheduler`, a cada 24h — certificado não precisa de checagem em minutos, diferente de `server-metrics`). Percorre todo domínio em uso (`applications.domain`/`services.domain` não-nulos) e conecta via `node:tls` na porta 443 pra ler `getPeerCertificate().valid_to` — **sem SSH**, é uma conexão TLS direta pro domínio público, igual qualquer monitor externo de certificado faria (diferente de todo o resto do worker, que só fala com os servidores via SSH).
- Alerta (`tls.expiring`, novo tipo de evento) quando faltam 14 dias ou menos pra expirar — `error` se já expirou/expira hoje, `warning` caso contrário. Domínio inalcançável (DNS não propagado, firewall) só loga e segue pro próximo — não é motivo de alerta por si só, já que pode ser transitório.
- **Testado com domínio real** (não dava pra usar o rig SSH+Docker descartável, já que TLS de verdade exige Let's Encrypt público): rodei a lógica de `checkExpiry` contra `github.com` e confirmei que o `valid_to`/dias restantes batem certinho, e contra um domínio inexistente pra confirmar que o erro (`ENOTFOUND`) é capturado sem derrubar o job.


## Primeiro teste real em VPS — três bugs reais encontrados e corrigidos

Ganhei acesso a uma VPS Ubuntu 24.04 de verdade (Hostinger) e rodei o `install.sh` exatamente como um usuário real rodaria — `curl -fsSL .../install.sh | sudo bash`. Isso nunca tinha sido testado de ponta a ponta antes (só `bash -n`), e encontrou três bugs reais que só apareciam fora do ambiente de desenvolvimento:

**Bug 1 — `read` interativo quebra sob `curl | bash`.** Rodando o one-liner documentado, o `WEB_PORT` do `.env` gerado virou literalmente o texto de um comentário do próprio script (`# ---...`), e o `docker compose` falhou com `invalid hostPort`. Causa: quando o script roda via `curl | bash`, o stdin do processo bash É o restante do próprio script sendo transmitido pelo pipe — um `read` comum não bloqueia esperando o usuário, ele consome as PRÓXIMAS LINHAS DO SCRIPT como se fossem a resposta. Corrigido lendo de `/dev/tty` (o terminal de verdade por trás do pipe) com fallback silencioso pros defaults quando não há terminal — e não basta testar com `[ -r /dev/tty ]` (isso só olha permissão do arquivo, retorna verdadeiro mesmo sem terminal de controle, ex. processo destacado via `nohup`); o teste real é tentar o `read` e deixar o próprio exit code cair no `else`.

**Bug 2 — Bun no Linux quebra o `vue-tsc` silenciosamente.** Com o installer corrigido, o build da imagem `web` falhava com dezenas de `TS2307: Cannot find module` — para TODO import de `.vue` do projeto, inclusive relativos (`./App.vue`). Isolei rodando só o estágio `web-build` repetidamente (cache dos layers anteriores tornou cada iteração rápida): não era arquivo faltando (conferido byte a byte no clone), não era hoisting de dependência (`@vue/language-core`/`@volar/typescript` resolvem beleza, testei adicionando como devDependency explícita e não mudou nada), não era versão do Bun (1.3.14 = mesma da máquina local, 1.4.2 = mesmo bug), não era Alpine vs Debian (glibc reproduz igual musl). O teste decisivo: rodar o **mesmo** `vue-tsc` instalado, no **mesmo** container, sob Node.js de verdade em vez do binário do Bun — zero erros, `exit 0`. Ou seja: o Bun, ao executar o script do `vue-tsc` via seu próprio engine JS no Linux, faz o plugin de linguagem do Vue (que ensina o TypeScript a reconhecer `.vue` como módulo) falhar silenciosamente — sem crash, só finge que `.vue` não existe. No Windows isso não acontece porque o Bun gera um `.exe` nativo pros binários em `node_modules/.bin` (mecanismo totalmente diferente do symlink+shebang usado no Linux/Mac). Corrigido no `Dockerfile` chamando os `.bin` diretamente (`./node_modules/.bin/vue-tsc -b && ./node_modules/.bin/vite build`) depois de instalar `nodejs` via `apk` só no estágio `web-build` — isso deixa o SO honrar o shebang `#!/usr/bin/env node` de cada script, sem depender do Bun pra executá-los. Documentado em `CONTRIBUTING.md` pra quem for rodar `bun run typecheck` num Mac/Linux e tomar um susto com uma parede de erros falsos.

**Bug 3 — `docker compose exec`/`run` travam esperando o stdin fechar.** Com os dois bugs acima corrigidos, o script ainda travava (sem erro, sem sair, pra sempre) logo depois de "Aguardando o Postgres ficar saudável...". Causa: `docker compose exec`/`run` encaminham o stdin do processo chamador pro container mesmo quando o comando não precisa dele (`pg_isready`, a própria migration), e ficam esperando esse stdin fechar antes de retornar — se o stdin do script não fecha de forma confiável (o que pode variar dependendo de como exatamente o `curl | bash` é invocado), essa espera nunca termina. `< /dev/null` na checagem de saúde do Postgres e na chamada de migration (script principal e o helper `yeah update`) resolve de vez, sem depender do stdin do processo pai.

Depois dos três fixes, `curl -fsSL .../install.sh | sudo bash` completo (Docker, clone, `.env`, build de todas as imagens, `docker compose up`, migrations, helper `yeah`) rodou do início ao fim numa VPS real de 1 vCPU / 3.8GB RAM sem nenhuma intervenção manual — confirmado batendo no dashboard (`curl http://localhost:8080` → 200) e no `yeah status` depois.


## Bug crítico de deploy: URL da API embutida errada no build

Depois de conseguir instalar de ponta a ponta na VPS de teste, o usuário reportou que o dashboard carregava mas não fazia nada — sem tela de registro, sem nada. Causa: `VITE_API_URL`/`VITE_WS_URL` são embutidas no bundle do frontend **em tempo de build**, como URL absoluta — e como a instalação rodou sem terminal interativo, `PUBLIC_HOST` caiu no default `localhost`, então o JS estático literalmente tentava chamar `http://localhost:3000` a partir do **navegador de quem acessa**, nunca o servidor de verdade. Qualquer instalação sem domínio real (a maioria) ficaria assim.

**Fix estrutural, não só um patch pro `.env`**: o nginx do próprio container `web` passou a reverse-proxyar `/api` e `/ws` pros containers `api`/`ws` internamente (`apps/web/nginx.conf`), e o frontend passou a usar caminho relativo (mesma origem) como padrão em vez de precisar saber seu próprio host público em tempo de build (`lib/api.ts`, `lib/ws.ts`). Vantagem colateral: só a porta do `web` precisa estar exposta na internet — `api`/`ws` já ficavam só em `127.0.0.1`, agora isso é reforçado por não ter mais razão nenhuma pra abrir aquelas portas externamente.

## Painel escondido — caminho aleatório + porta não-óbvia

Pedido direto do usuário depois de testar: o painel não pode ficar num endereço óbvio. Com o fix acima (tudo já passando por uma porta só), ficou barato adicionar uma segunda camada:

- `install.sh` gera um `PANEL_PATH` aleatório (`/$(openssl rand -hex 8)`) a cada instalação nova, e trocou o default de `WEB_PORT` de `8080` pra uma porta não-óbvia.
- Uma variável só alimenta tudo: o `base` do Vite (`vite.config.ts`), a base do Vue Router (`createWebHistory(import.meta.env.BASE_URL)`), o prefixo relativo de `lib/api.ts`/`lib/ws.ts`, e o roteamento do nginx.
- `nginx.conf` virou `nginx.conf.template` — o próprio entrypoint da imagem oficial do nginx faz `envsubst` nele usando a env var `PANEL_PATH` a cada boot do container (não precisa rebuildar a imagem pra trocar o caminho).
- Qualquer URL fora do `PANEL_PATH` recebe `return 444` — conexão fechada, nem uma resposta HTTP válida. Testado de ponta a ponta na VPS: `/` e caminhos chutados não respondem nada, o caminho certo serve o dashboard, `/api`/`/ws` funcionam através dele, registro completo funcionando.
- É uma camada de obscuridade em cima da autenticação real, não substitui ela.

## Single-admin de propósito + servidor local automático

Dois pedidos do usuário depois de comparar com o Coolify: (1) `/register` sempre disponível não devia existir — devia funcionar só a primeira vez, depois só login; (2) a própria máquina onde o `yeah` roda devia entrar sozinha como servidor de deploy, sem precisar cadastrar nada manualmente.

- **Registro trava depois da primeira conta**: `hasAnyUser()` em `apps/api/src/routes/auth.ts` bloqueia `POST /auth/register` (403) assim que existe qualquer usuário; `GET /auth/setup-status` expõe isso pro frontend decidir entre mostrar `/register` ou `/login`. Removidas as rotas de convite de time (`/teams/:teamId/invitations`, `/teams/invitations/:token/accept`) — nunca tiveram frontend, e existiam só pra uma segunda pessoa ganhar login, exatamente o que estava sendo travado.
- **Servidor local automático**: `install.sh` gera uma chave SSH e já autoriza ela em `~/.ssh/authorized_keys` do host, guardando a chave privada (base64) e o endereço no `.env`. Quando a conta de admin é criada, `createLocalhostServerIfConfigured()` insere um `Server` apontando pra `host.docker.internal:22` e já enfileira a checagem de conexão. O `worker` (única peça do stack que fala SSH) alcança o host via `extra_hosts: host-gateway` no `docker-compose.prod.yml`.
- **Testado de ponta a ponta na VPS real**: instalação limpa → chave gerada e presente em `authorized_keys` → registro via `curl` → segunda tentativa de registro barrada (403) → `select * from servers` mostrando `Servidor local`, `host.docker.internal`, status `connected`, com a versão do Docker do host detectada certinha pelo `server-check` do worker.


## Caminho secreto do painel virou opt-in

O usuário testou e não gostou de ter um hash aleatório na URL por padrão — pediu pra tirar isso e deixar opcional. Revertido: `install.sh` não gera mais `PANEL_PATH` sozinho (fica em branco, dashboard responde em `/` normalmente); quem quiser a camuflagem seta `PANEL_PATH` no `.env` manualmente e roda `yeah update`. A porta não-óbvia como default continua (isso não foi criticado).

Reestruturado pra suportar os dois modos de verdade em vez de só fingir suportar: `nginx.conf.template` (sempre ativo, tinha o defeito de tratar `PANEL_PATH=/` como um caso degenerado que nunca foi testado) virou `nginx.conf` simples de novo + um script `docker-entrypoint-panel-path.sh` que roda como hook `/docker-entrypoint.d/` do próprio nginx: sem `PANEL_PATH` setado, não faz nada (usa o `nginx.conf` baked na imagem); com `PANEL_PATH` setado, reescreve `conf.d/default.conf` pro modo com prefixo + `return 444` no resto. Dois caminhos de código separados em vez de um template tentando cobrir os dois casos com interpolação de variável vazia.


## Primeira suíte de testes automatizados

Até aqui a validação era só `bun run typecheck` + teste manual (rig SSH+Docker descartável ou `curl` direto). O usuário pediu pra finalmente escrever os testes de verdade — comecei pela lógica pura que já causou bug real ou é crítica pra segurança, já que é onde um teste automatizado paga o investimento mais rápido:

- **`compareVersionParts`/`parseVersionTag`** (`apps/api/src/routes/updates.ts`): trava o bug real que já apareceu (Docker Hub retornando `windowsservercore-ltsc2025` como "última versão" do `traefik`).
- **`shellQuote`**: teste de injeção de comando de verdade (`'; rm -rf / #` como input) e um teste de round-trip que decodifica a escapagem POSIX pra confirmar que reproduz o valor original, em vez de fixar uma string exata (mais robusto a mudanças no estilo de escape).
- **`buildRunCommand`** dos três jobs de provisionamento (`deployApplication`, `provisionDatabase` — 5 motores, `provisionService`): cobre os limites de recurso, labels do Traefik, quoting seguro de senha com aspas simples.
- **JWT do GitHub App**: gera um par de chaves RSA descartável na hora (`generateKeyPairSync`) e verifica a assinatura de verdade com `createVerify`, incluindo um teste que confirma que um payload adulterado falha a verificação.
- **HMAC do webhook do GitHub**: assinatura válida/inválida/corpo adulterado/header ausente/tamanho errado.
- **Hash de senha** (`Bun.password` com argon2id): confirma salt aleatório (duas chamadas pra mesma senha geram hashes diferentes, ambos verificam).
- **Notificações**: `escapeMarkdown` do Telegram e o dispatch de `sendNotification` com `fetch` mockado (`bun:test`'s `mock()`).

**Achado real durante a configuração**: rodar a suíte inteira (`bun test`, todos os arquivos no mesmo processo) quebrava de forma não-determinística — um erro `console.log.bind is not a function` vindo de dentro do polyfill WASM do `ssh2` (poly1305, usado pra um algoritmo de assinatura que a lib nem usa na maioria das conexões). Isolei: `shellQuote` morava no mesmo arquivo que importa `ssh2` (`packages/ssh/src/index.ts`), e as funções `buildRunCommand`/`resolveDomain` dos jobs do worker moravam nos mesmos arquivos que `connectSsh`/`execStream` — testar essa lógica pura, mesmo sem nunca chamar SSH de verdade, carregava o `ssh2` inteiro no processo de teste, e alguma interação entre múltiplos arquivos de teste no mesmo processo deixava o polyfill instável. Corrigido extraindo tudo isso pra arquivos sem dependência de `@yeah/ssh`: `shellQuote` virou parte de `@yeah/shared` (zero dependência pesada, é só uma função de string), e cada job de provisionamento ganhou um `<nome>.commands.ts` irmão com só a lógica pura, reexportado pelo arquivo original pra não quebrar nenhum import existente.

**Infra de teste**: `bunfig.toml` + `test/setup.ts` define `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` falsos antes de qualquer teste rodar — os clients do Postgres (`drizzle-orm/bun-sql`) e Redis (`ioredis`) são preguiçosos (não conectam de verdade só de serem construídos), confirmado testando na mão antes de assumir isso, então dá pra importar qualquer módulo que os usa sem precisar de Postgres/Redis reais rodando.

123 testes, 0 falhas, roda em ~1.2s.


## Notificações por email (SMTP)

Pedido direto do usuário: alerta por email era o que mais fazia falta na lista de canais. Implementado como um canal novo (`email`) no mesmo esquema já existente (Discord/Slack/Telegram/webhook), não como sistema separado:

- **SMTP genérico**, não uma API proprietária — funciona com Gmail, SES, SendGrid, Postfix próprio, qualquer coisa que fale SMTP, igual o Coolify faz. Usa `nodemailer` (única dependência nova do projeto que não tem alternativa nativa do Bun — não existe cliente SMTP built-in).
- Campos novos em `notification_channels`: `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password`, `smtp_from`, `email_to` — mesma ressalva de segurança já existente pra `servers.private_key` (senha em texto puro, TODO de criptografia em repouso).
- **Email com cara de produto, não texto cru do SMTP**: HTML com faixa de cor por nível (info/aviso/erro), badge, título, corpo — mais fallback em texto puro pros clientes que não renderizam HTML. Título/corpo passam por `escapeHtml` antes de entrar no template (o conteúdo pode ser nome de repo, mensagem de erro etc. — nunca confiável o suficiente pra injetar direto no HTML).
- **Achado real testando contra a API de verdade**: a validação `format: "email"` do Elysia pro campo `smtpFrom` rejeitava o formato `"Nome <email@dominio.com>"` — comum e válido pra cabeçalho De, só não é um endereço de email "puro". Corrigido pra validação solta (`minLength: 1`) tanto em `smtpFrom` quanto `emailTo`, deixando o SMTP de verdade validar o endereço na hora de enviar.
- **Testado de ponta a ponta duas vezes**: primeiro isolado (`sendNotification` direto, conta de teste descartável do Ethereal, confirmando negociação STARTTLS + auth + entrega), depois através da API de verdade rodando local (criar canal → `POST .../test` → email aceito pelo servidor SMTP) — achando o bug de validação nesse segundo teste, que o primeiro (chamada direta, sem passar pela validação do Elysia) não pegaria.

