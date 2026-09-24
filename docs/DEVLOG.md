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


## Breadcrumb de navegação nas páginas de ambiente e recurso

O usuário pediu explicitamente pra estudar como o Coolify estrutura as telas (visitou a própria instância de produção dele, `dash.esc-software.com`, e tirou prints) porque achava a exibição atual do `yeah` inferior. Comparando lado a lado: a hierarquia de navegação (`Project → Environment → Application/Database/Service`) já era estruturalmente igual — o gap real era informacional, não de rota. O Coolify mostra, no topo de toda página de recurso, uma trilha clicável tipo "Projeto › ambiente › NomeDoRecurso (servidor) ● Rodando", e o `yeah` só tinha o título estático da página.

Primeiro passo concreto: endpoint novo `GET /teams/:teamId/projects/:projectId/environments/:environmentId` retornando `{ project, environment }`, e um componente `Breadcrumb.vue` que busca isso e renderiza como links clicáveis. Adicionado na página de ambiente (`Default › production`) e nas três páginas de detalhe de recurso, com o nome do recurso como último item não-clicável (`:current`). Verificado no navegador contra o banco de dev de verdade — a trilha aparece corretamente acima do cabeçalho "Recursos".

Prints de projetos/clientes reais do Coolify do usuário não entraram em nenhum commit nem doc pública — só a estrutura de navegação foi usada como referência.

A granularidade da sub-navegação de "Configuration" (Coolify tem itens de menu lateral separados pra Persistent Storage, Webhooks, Preview Deployments, Rollback etc.) fica registrada no roadmap como o próximo passo dessa frente, condicionada a cada feature correspondente já existir de verdade.


## `bun --cwd <dir> run <script>` não executa o script

Achado tentando subir o stack local (`bun run dev`) só pra testar visualmente o breadcrumb acima. Todo script de dev/banco do `package.json` raiz usava `bun --cwd apps/api run dev` (flag `--cwd` antes do subcomando `run`) — nesse Bun 1.3.14, isso não roda o script: imprime a ajuda da CLI e lista os scripts disponíveis, silenciosamente, sem erro. Bug real, não só uma preferência de estilo — afetava o fluxo de dev documentado inteiro (`bun run dev`, `db:generate`, `db:migrate`, `db:push`, `db:studio`).

Corrigido invertendo a ordem: `bun run --cwd apps/api dev` (`--cwd` depois do `run`) funciona certinho. Confirmado subindo o stack completo (api:3000, worker, ws:3001, web:5174) com sucesso.

**Segundo bug atrás do primeiro**: consertar a ordem fez os scripts rodarem de verdade pela primeira vez — o que expôs um segundo problema que o primeiro bug vinha escondendo. Rodando de verdade, `bun run dev`/`db:migrate`/etc. quebravam com `DATABASE_URL is not set`: o carregamento automático de `.env` do Bun só olha o cwd do próprio processo, e `--cwd apps/api` muda esse cwd pra dentro do subpacote — o `.env` da raiz (o único que existe no projeto) nunca era lido. Corrigido adicionando `--env-file=../../.env` (relativo a cada subpacote — `apps/*` e `packages/db` ficam exatamente dois níveis abaixo da raiz) em cada `bun run --cwd`. Testado de ponta a ponta: `bun run db:migrate` aplicando migração de verdade e `bun run dev` subindo os quatro processos com `DATABASE_URL`/`REDIS_URL` reais, sem nenhuma variável de ambiente setada manualmente fora do `.env`.


## Armazenamento persistente pra aplicações

Coolify tem uma aba "Persistent Storage" — volume nomeado do Docker + caminho no container, sobrevive a redeploy. `Database` e `Service` já tinham isso de graça (caminho fixo do motor de banco ou do catálogo de serviços), mas `Application` (deploy via Dockerfile) não tinha nenhum jeito de persistir nada — um gap real, e também a primeira feature de verdade pra preencher a sub-navegação de Configuração mais granular que o roadmap já registrava como pendente.

Tabela nova `application_volumes` (nome + caminho, uma linha por volume). O nome do volume Docker de verdade nunca é guardado — é derivado do id da linha (`yeah-vol-<id>`, em `volumeFlags()` no `@yeah/shared`), uma fonte de verdade só. Rotas `GET`/`POST`/`DELETE` em `/applications/:id/volumes`; `deployApplication` busca os volumes da aplicação e passa pro `buildRunCommand`, que já tinha o padrão de `resourceLimitFlags` pra seguir. Remover um volume (ou a aplicação inteira) tenta remover o volume Docker de verdade via SSH síncrona, mesma exceção deliberada já usada pro teardown do container — falha em silêncio se o container ainda tiver montado (remove de verdade no próximo deploy) ou o servidor estiver fora do ar.

Aba nova "Armazenamento" na sub-navegação de Configuração da aplicação. Testado de ponta a ponta contra a API/banco de dev reais: criar aplicação descartável → adicionar volume → aparece na lista → remover → sumiu → excluir a aplicação (limpa os volumes junto).


## Rollback de deploy com um clique

Próximo item do roadmap de paridade com Coolify: o histórico de deploys já existia, faltava o botão de "voltar pra essa versão". A pergunta de design era como saber PRA QUAL commit voltar, já que hoje o `yeah` builda sempre a partir do HEAD da branch, sem guardar imagem nenhuma (não tem registry) — rollback de verdade só é possível se a gente souber exatamente qual commit cada deploy passado buildou.

Solução: cada deploy passou a resolver `git rev-parse HEAD` (via SSH, depois do checkout, antes do build) e gravar o resultado na própria linha de `deployments` (coluna `commit_sha`). Rollback vira só reusar essa mesma coluna do outro lado: a rota `POST .../deployments/:id/rollback` cria uma linha de deploy NOVA já com `commitSha` pré-preenchido com o commit do deploy alvo, e enfileira no mesmo job/worker de sempre — zero fila nova, zero tipo de job novo. O worker olha se a linha já veio com `commitSha` setado; se sim, faz `git reset --hard <sha>` em vez de `git reset --hard origin/<branch>`. `git reset --hard` funciona igual com um SHA cru ou uma ref de branch, e funciona igual com o repo em HEAD destacado (de um rollback anterior) ou numa branch normal — não precisou de nenhum passo extra de re-attach.

**Achado ao escrever o teste manual**: sem registry, "rollback" aqui significa re-clonar/re-buildar do zero a partir daquele commit específico, não reusar uma imagem já buildada — mais lento que o rollback do Coolify (que reusa a imagem), mas honesto sobre a limitação atual (registry privado com push automático já tá no roadmap de paridade) e correto pro caso de uso: o Dockerfile pode ter mudado desde então, então rebuildar do commit exato é o comportamento certo de qualquer forma.

Testado de ponta a ponta pela API de verdade: forcei duas linhas de deploy "success" com commit falso via SQL, chamei o rollback pela UI, confirmei que a linha nova nasce com o `commitSha` certo, entra na fila, e o worker de verdade tenta a conexão SSH real com ele — falhando só porque o servidor de teste desse ambiente de dev é um SSH fake inalcançável (mesma falha que um deploy normal teria aqui). Testado também que a rota rejeita rollback pra deploy que não existe (404) e pra deploy que não terminou com sucesso (400).


## Pesquisa nova no código-fonte do Coolify + reestruturação de navegação da Application

Pedido direto do usuário: analisar o Coolify de novo, dessa vez o código-fonte de verdade (`github.com/coollabsio/coolify`) e a documentação oficial, não só a instância de produção que já tinha sido explorada antes (a maior parte do que aquela pesquisa achou já tinha virado feature). Rodei uma pesquisa em paralelo (fork) enquanto confirmava com o usuário o que ele queria dizer com "aquela parada de lang" — resposta: idioma da interface (i18n), não detecção de linguagem de build. Achado que confirma isso: o Coolify tem 20 arquivos de tradução em `lang/*.json`, incluindo `pt.json` e `pt-br.json`.

**O achado estrutural mais importante**: cada sub-seção de configuração de recurso no Coolify (Domains, Advanced, Environment Variables, Persistent Storage, Source, Servers, Scheduled Tasks, Webhooks, Preview Deployments, Healthcheck, Rollback, Resource Limits, Resource Operations, Metrics, Analytics, Tags, Danger) é uma **rota própria do Laravel**, não uma aba em memória. Isso bate exatamente com a reclamação do usuário de que a estrutura do `yeah` tá confusa — o `ApplicationDetailPage.vue` de antes tinha `activeTab`/`activeConfigTab` como `ref`s locais: trocar de aba não mexia na URL, não dava pra compartilhar link de uma sub-seção específica, e voltar no navegador não funcionava do jeito esperado.

**Reestruturação aplicada em Application** (referência pro que falta fazer em Database/Service): o antigo componente monolítico (~530 linhas, dono de tudo — log de deploy, histórico, rollback, domínio, limites, variáveis de ambiente, volumes) virou:
- `layouts/ApplicationLayout.vue`: busca a aplicação uma vez, renderiza breadcrumb/cabeçalho/abas/sub-nav, e disponibiliza `app`, `basePath`, `error`, `reloadApp` pras rotas filhas via `provide`/`inject` (`composables/useApplicationContext.ts`).
- Quatro páginas em `pages/application/`, cada uma só com sua própria responsabilidade e seu próprio fetch: `ApplicationDeploymentsPage`, `ApplicationGeneralPage`, `ApplicationEnvPage`, `ApplicationStoragePage`.
- Router: `/apps/:id` redireciona pra `/apps/:id/deployments`; `/general`, `/env`, `/storage` são rotas filhas de verdade.

**Detalhe não-óbvio**: o botão "Deploy" mora no cabeçalho compartilhado (visível em qualquer sub-página), mas precisa "aparecer" na página de Deployments depois de clicado — mesmo quando o usuário já tá nela (sem re-montar o componente) ou quando ele tá em outra sub-página (aí precisa navegar). Resolvido com um sinal reativo (`lastDeployment` no contexto compartilhado): a página de Deployments observa esse ref via `watch()` pra pegar o deploy novo sem remontar; quando a navegação troca de rota, o `onMounted` de sempre já busca o histórico atualizado — os dois caminhos convergem sem duplicar lógica.

Testado no navegador contra a API/banco de dev reais: clique de aba muda a URL (`/general`, `/env`, `/storage`), botão voltar do navegador funciona corretamente entre sub-páginas, reload direto numa URL profunda (ex. `.../env`) renderiza a página certa sem passar pela home, e clicar em "Deploy" estando numa página de Configuração navega pra Deployments e mostra o log ao vivo.

Documentação também reescrita (`docs/ROADMAP.md`) com o levantamento novo: seção dedicada de reestruturação de navegação, seção de i18n, e vários gaps que a pesquisa anterior não tinha achado (backup por aplicação como feature de primeira classe, histórico de execução de scheduled tasks, healthcheck configurável, dashboard inicial com widgets, analytics de tráfego, limpeza automática de Docker).


## Reestruturação de navegação — Database e Service

Repetiu o mesmo padrão da Application (ver entrada anterior) pros outros dois tipos de recurso, fechando a reestruturação de navegação inteira:

- **Database**: `DatabaseLayout.vue` + `pages/database/{DatabaseBackupsPage,DatabaseGeneralPage}.vue`. Rotas `/databases/:id/backups` (padrão) e `/general`. A sub-navegação de Configuration hoje só tem "Geral" — fica como um link único por enquanto, cresce quando Advanced/Webhooks/etc. forem implementados de verdade (já documentado no roadmap pra não criar aba vazia antes da hora).
- **Service**: `ServiceLayout.vue` + `pages/service/{ServiceGeneralPage,ServiceEnvPage}.vue`. Rotas `/services/:id/general` (padrão) e `/env`. Service nunca teve um top-level tab (não tem histórico de deploy) — só o `detail-layout` com sub-nav direto, então o layout ficou mais simples que o de Application.

Mesmo mecanismo de contexto compartilhado (`provide`/`inject` via `composables/use{Database,Service}Context.ts`) que a Application já usava — nenhuma ideia nova aqui, só replicação do padrão já validado.

Testado de ponta a ponta contra API/banco de dev reais: criei um banco e um serviço descartáveis, confirmei que `/databases/:id` e `/services/:id` redirecionam pro filho padrão, e que clicar nas sub-abas muda a URL e renderiza o conteúdo certo — nos dois tipos de recurso.


## Dashboard inicial de verdade

Último item da leva de achados da pesquisa nova do Coolify: hoje logar cai direto em "Times", uma lista de times sem visão geral nenhuma. Como o `yeah` é single-admin, essa lista é literalmente um card só pra quase todo mundo — puro atrito na frente do que a pessoa realmente quer ver.

Pedido explícito do usuário foi "faz o essencial", então escopei pro mínimo que já entrega valor real em vez de tentar replicar os três widgets do Coolify (`ActiveDeployments`, `ServerMetricsChart`, `TrafficAnalytics`) de uma vez — o gráfico histórico depende de série temporal que ainda não existe (item separado no roadmap de Robustez), e traffic analytics é baixa prioridade.

O que entrou: endpoint novo `GET /teams/:teamId/overview` (contagem de aplicações/bancos/serviços/servidores + os últimos 8 deploys cruzando todas as aplicações do time, cada contagem e o join numa query só, sem N+1) renderizado no `/dashboard` pro time principal do usuário — cards de contagem, tabela de deploys recentes, e lista de servidores com status + barras de CPU/RAM/disco (reaproveitando o mesmo `metricBarClass()` que a página de Servidores já tinha). A lista de times e o formulário de criar time continuam embaixo, intactos, pro caso raro de mais de um time.

**Achado ao implementar**: o CSS `.stat-card`/`.stat-value`/`.stat-hint` já existia em `main.css` desde uma sessão bem anterior — comentado como preparado pra esse tipo de widget — mas nenhum componente usava. Primeira vez que esse CSS entra em uso de verdade.

Testado contra a API/banco de dev reais: criei uma aplicação descartável, disparei um deploy (falhou por causa do servidor de teste inalcançável, esperado), e confirmei que `/teams/:id/overview` já refletia a contagem nova e o deploy na hora — tanto direto no endpoint quanto renderizado no dashboard.


## Botões de verdade na tela de Atualizações

Pedido direto do usuário: a tela de Atualizações só dizia o que tava desatualizado, nunca fazia nada — tinha que ter botão pra atualizar a plataforma, os pacotes do sistema, e as imagens Docker, ou tudo de uma vez.

**O caso difícil foi "atualizar a plataforma"**: o comando (`git pull` + `docker compose up -d --build` + migrations) recria os próprios containers `api`/`worker` que estão rodando o job que dispara esse comando — incluindo o worker que segura a conexão SSH. Uma execução síncrona normal teria a conexão morta no meio, com o `docker compose` possivelmente interrompido antes de terminar. Solução: o comando roda destacado no host (`nohup ... & disown`, saída redirecionada pra um arquivo de log) e retorna quase na hora; um job de poll separado — reenfileirado com delay via BullMQ, cujo estado mora no Redis, independente de qualquer processo de worker específico — reconecta do zero a cada tick pra ler o crescimento do arquivo de log e checar um marcador de conclusão. Isso sobrevive exatamente ao restart do worker que ele mesmo tá esperando acontecer.

**"Atualizar sistema"** (apt-get update/upgrade) é o caso fácil — não mexe nos containers do yeah, então roda síncrono numa exec SSH só, igual um deploy de aplicação.

**Atualizar imagem** por recurso (ou "Atualizar tudo") reusa exatamente o mecanismo que a rota de limites de recurso já usava pra aplicar mudança: bumpa a tag da imagem no banco e reenfileira o job de provisionamento (idempotente, já recria o container do jeito certo). A rota `GET .../updates/images` mudou de "uma linha por imagem única" pra "uma linha por recurso" — cada linha vira uma ação de verdade em vez de só um dado exibido.

Tabela nova `platform_operations` (`kind`: `platform_update`|`system_update`, sem `teamId` — é uma instância só, não faz sentido escopar por time) e coluna nova `servers.is_platform_host`, setada `true` só pelo `createLocalhostServerIfConfigured` — os dois botões atuam sempre nesse servidor específico, nunca num servidor gerenciado qualquer, sem ambiguidade possível.

**Achado real ao ligar tudo isso**: `updates.ts` passou a importar `../lib/queue` (pra enfileirar as operações novas) — e `updates.test.ts` importa funções puras direto de `updates.ts`, então esse import novo fez os testes começarem a instanciar conexões reais de BullMQ/ioredis (com o `REDIS_URL` falso de teste) só de carregar o módulo. A conexão falha de verdade (porta fechada), e o erro assíncrono estourava mais tarde na suíte, depois de outro teste já ter mexido em `console.error` sem restaurar — exatamente a classe de bug "`console.error is not a function`" já documentada aqui antes, só que numa superfície nova. Corrigido com o mesmo padrão já usado nos jobs do worker: lógica pura isolada em arquivo próprio sem import pesado (`updates.pure.ts` pras funções de versão, `platformOperation.commands.ts` pros comandos SSH), então o teste importa só a parte pura.

Testado de ponta a ponta contra API/worker/banco de dev reais: os dois tipos de operação tentam conectar SSH no host da plataforma, falham direito com mensagem clara quando não tem nenhum configurado (estado esperado desse ambiente de dev), o log persiste e atualiza ao vivo via WS, e o guard de "só uma operação por vez" rejeita corretamente uma segunda tentativa enquanto a primeira roda. Atualização de imagem testada com um banco descartável: tag trocada, provisionamento disparado de novo (falhando só no servidor de teste inalcançável, igual todo outro job nesse ambiente).


## Componentes de configuração compartilhados + dashboard no estilo "Root Team"

Duas frentes pedidas na sequência pelo usuário, ambas continuando a reestruturação de UI/UX.

**Componentes compartilhados**: `DomainCard.vue` e `ResourceLimitsCard.vue` (`apps/web/src/components/`) substituem o "Domínio"/"Limites de recurso" que Application, Database e Service reimplementavam cada um do seu jeito (código quase idêntico, só o texto de confirmação e a URL do PUT mudavam). Cada componente é autocontido — recebe o valor atual + a URL do PUT + os textos como props, cuida do próprio estado de salvar/salvo, e emite `saved`/`error` pro pai aplicar o resultado sem precisar ir buscar o recurso inteiro de novo. `DatabaseGeneralPage.vue` só usa o de limites (banco não tem domínio); Application e Service usam os dois.

**Dashboard "Root Team"**: pedido direto do usuário — ele atualizou o Coolify de produção dele (`dash.esc-software.com`) e pediu pra visitar de novo e copiar a estrutura atualizada, com "nossa personalidade" (não copiar cores/marca, só o padrão estrutural). Achado principal revisitando: o Coolify sempre tem um time padrão ("Root Team", visível e editável em Team → General) e a troca/criação de time mora num dropdown pequeno no topbar ("Root Team ⌄ / Dashboard ⌄"), não é uma ação de destaque no corpo do dashboard — bem diferente do `yeah`, que tinha um card "Criar novo time" full-width bem na frente, natural de sobrar já que o `yeah` é single-admin (quase sempre existe só um time mesmo).

Replicado com a nossa cara: `TeamSwitcher.vue` novo — substitui o nome do time no breadcrumb do topbar por um botão com dropdown (lista os times do usuário, marca o atual com check, "Novo time" abre um formulário inline sem fechar o menu). Reaproveita o CSS `.account-menu-*` que o menu de conta já usava, mesma casca visual. `DashboardPage.vue` perdeu a lista de times/formulário de criar time e ganhou uma grade "Projetos" (preview + link "Ver todos", mesmo card da `ProjectsPage.vue`) — junto com os cards de contagem e servidores que já existiam, fica estruturalmente muito perto do Dashboard real do Coolify. Sidebar também ganhou seções (Infraestrutura / Integrações / Sistema) em vez de uma lista única, espelhando a divisão Workspace/Infrastructure/Manage de lá.

**Bug real achado no meio do caminho**: o formulário inline de "Novo time" fechava sozinho assim que clicado, mesmo o clique caindo dentro do dropdown. Causa: o listener de "clique fora" checava `root.contains(event.target)` — mas o próprio clique no botão "Novo time" troca esse botão pelo formulário via `v-if` (o alvo do clique deixa de existir na árvore antes do evento terminar de borbulhar até o `document`), e `.contains()` num nó desanexado sempre retorna falso, então o menu se fechava sozinho interpretando isso como "clique fora". Corrigido trocando pra `event.composedPath()`, que é capturado no momento do disparo do evento e continua válido mesmo se o DOM mudar depois — padrão mais robusto pra esse tipo de "fechar ao clicar fora" sempre que o clique em si pode mexer no próprio menu.

**Achado à parte, sobre a ferramenta de teste**: o clique simulado por mouse do Claude in Chrome falhou silenciosamente duas vezes seguidas num botão dentro do dropdown, mesmo nas coordenadas certas (confirmado via zoom e `getBoundingClientRect`) — só funcionou disparando o evento de clique direto via JS no console. Isolei que não era bug do app (a lógica funciona perfeita via evento real), reportei como feedback da ferramenta.

Testado de ponta a ponta contra API/banco de dev reais: criei um time novo pelo switcher (formulário inline, disparo de evento real via JS pra contornar a instabilidade do clique simulado), confirmei que navega pro time novo com o switcher mostrando ele como atual, e limpei depois.


## Ícones demorando (achado: fonte de 4MB)

Usuário reportou: ícones demoram muito pra aparecer, precisa atualizar a página duas vezes pra ficar certo. Achado: `MaterialSymbolsOutlined.woff2` (usado em praticamente toda tela, desde o sidebar) pesava **3.98 MB** — o arquivo variável completo do Google, com 4 eixos (FILL/wght/GRAD/opsz) multiplicados por ~6600 ícones do conjunto inteiro. Combinado com `font-display: block` (janela de ~3s invisível antes do fallback), num cache frio o download de 4MB frequentemente não termina a tempo — daí o "preciso atualizar 2x": só funcionava porque na segunda vez o arquivo já tava no cache do navegador.

O CSS (`.material-symbols-outlined`) já fixa todo ícone do app numa única variação (`FILL 0, wght 400, GRAD 0, opsz 24`) — os eixos variáveis nunca são usados de verdade em lugar nenhum. Re-gerei o arquivo como uma instância estática nessa variação exata (`fontTools.varLib.instancer MaterialSymbolsOutlined.woff2 FILL=0 wght=400 GRAD=0 opsz=24`), mantendo o conjunto de ícones inteiro (sem subsetting por nome) — **386 KB**, renderização idêntica, e sem precisar mexer de novo toda vez que alguém adicionar um ícone novo num template.

**Tentei subsetting primeiro** (cortar pra só os ~48 ícones que o app usa hoje, o que teoricamente chegaria a uns 60-100 KB) — não deu certo de forma limpa: essa fonte usa um mecanismo de substituição contextual encadeada (`rlig`/`rclt`) em vez de uma tabela de ligadura simples, e o fechamento de closure do `fonttools` ou cortava ícones que deveriam ter sobrevivido, ou puxava de volta 90% da fonte inteira tentando preservar as regras. Instanciar sozinho (sem subsetting) já resolveu o problema real (tamanho) sem esse risco — trade-off consciente: mantém a fonte inteira "future-proof" em vez de mais 100-200 KB de economia com uma etapa de build frágil.

De brinde, achei e corrigi duas imprecisões no CSS enquanto investigava: `font-feature-settings: "liga"` (a fonte só declara `"rlig"` — sempre foi um no-op silencioso, só não quebrava nada porque `rlig` já vem ligado por padrão no navegador) e `font-weight: 100 700` no `@font-face` (sobra da fonte variável, sem sentido numa instância estática).

Testado no navegador: `curl` confirma os 386 KB servidos, e todo ícone testado (sidebar, dashboard, notificações) renderiza igual, sem glifo quebrado ou faltando.


## Tema escuro como padrão + grade de recursos unificada

Continuação direta do pedido do usuário de aproximar o `yeah` do Coolify — duas mudanças menores, mas de alto impacto visual imediato.

**Tema escuro por padrão**: `theme.ts` decidia o tema inicial olhando `prefers-color-scheme` do SO quando não havia preferência salva. Painéis self-hosted (Coolify incluso) quase sempre abrem escuro por padrão — trocado pra isso: sem `localStorage` salvo, abre escuro; o toggle continua funcionando normal e o que for escolhido ali passa a persistir do mesmo jeito de antes. Aproveitei pra recalibrar a paleta `.dark` — era preto puro numa escala só (`--bg: #000`, `--surface: #0a0a0a`, `--surface-2: #161616`), virou um sistema de 3 camadas mais claras e escalonadas (`--bg: #19191b`, `--surface: #212124`, `--surface-2: #2a2a2e`), inspirado no design token real do Coolify (`--color-app`/`--color-panel`/`--color-surface`/`--color-raised`, todos valores OKLCH próximos entre si) — sidebar, topbar e card agora se distinguem por camada em vez de tudo se misturar num preto só.

**Grade de recursos unificada**: `EnvironmentPage.vue` renderizava três seções (`Aplicações`/`Bancos de dados`/`Serviços`), cada uma com sua própria grade, mais três formulários de criação completos sempre visíveis numa `grid-3` no rodapé — um layout de admin-CRUD clássico, bem diferente do Coolify real, que trata "criar recurso" como um fluxo à parte (catálogo pesquisável dividido em Applications/Databases/Services) em vez de formulários permanentes na tela principal. Reestruturado: a página agora mostra uma única grade mista (`resources` computed, junta os três tipos, ordena por nome), e o botão "Novo recurso" no cabeçalho leva pra `ResourceNewPage.vue` (rota nova `.../environments/:id/new`) — um seletor de 3 categorias em cima (mesmo visual de card usado nos outros lugares, `.resource-kind-tile`, ativo destacado com borda accent) que revela o formulário certo embaixo ao escolher. Os três formulários em si são os mesmos de antes, só movidos pra lá.

`DATABASE_ENGINES` (em `packages/shared/src/types.ts`) não tem campo `icon` por engine, diferente do `SERVICE_CATALOG` — não criei um agora (ícone genérico `database` pra todos os motores no seletor) pra não inventar taxonomia nova sem necessidade real; fica como gap pequeno pra revisitar se algum dia a grade precisar diferenciar visualmente os motores.

Testado de ponta a ponta contra API/banco de dev reais: criei um banco de dados pelo fluxo novo (`/new` → tile "Banco de dados" → formulário → `POST`), confirmei o redirect pra página de detalhe do recurso criado, voltei pra `EnvironmentPage.vue` e vi ele aparecer na grade unificada com ícone/status/badge corretos, apaguei via API de teste (o botão de excluir por hover do card teve o mesmo problema de clique simulado já documentado antes com o Claude in Chrome — contornado resolvendo o elemento certo via `find` em vez de coordenada). Confirmei visualmente o tema escuro padrão limpando `localStorage` e recarregando. `bun test` (139 testes) e `vue-tsc --noEmit` passando depois de tudo.


## Pesquisa grande: Coolify + Dokploy, gap analysis pro roadmap

Usuário pediu uma rodada de pesquisa bem mais profunda que as anteriores: não só documentação, mas o código-fonte de dois projetos concorrentes (clonou `./coolify` e `./dokploy` localmente, ambos gitignored), a documentação oficial dos dois (`coolify.io/docs`, `docs.dokploy.com`), e uma revisita à instância real de produção do Coolify pra olhar especificamente o layout de "New Resource" e a listagem de recursos de um ambiente — porque o cerne da reclamação dele era **layout**, não paleta/ícone ("o css de cores e afins os icones e tals [...] tá top [...] mas eu to falando da porra do layout").

Rodei 4 forks em paralelo (`Agent` com `subagent_type: "fork"`) pra não poluir o contexto principal com o research bruto: digest da doc do Coolify, digest da doc do Dokploy, arqueologia de código do Coolify (Laravel), arqueologia de código do Dokploy (Next.js+tRPC). Enquanto isso, explorei ao vivo a instância real (`/sources`, `/project/.../new`, `/projects`) e investiguei nosso próprio `install.sh`/`localhostServer.ts` pra responder a pergunta mais estrutural do pedido: dá pra rodar o painel `yeah` separado da VPS gerenciada, sem gastar recurso dela?

**Achados que mudam o roadmap de verdade** (detalhe completo em `docs/ROADMAP.md`, notas cruas com nome de instância real em `docs/coolify-research.md`/`docs/dokploy-research.md`, ambos gitignored):

1. **"Rodar o painel separado da VPS" já é ~90% possível hoje, sem saber.** `apps/api/src/lib/localhostServer.ts` já só registra o "servidor local" se `LOCALHOST_SSH_PRIVATE_KEY_BASE64` existir no ambiente — o worker já trata todo alvo de deploy como remoto via SSH, nunca assume socket Docker local. A lacuna real é só o `install.sh` sempre gerar essa chave e escrever essas env vars sem opção de pular. Confirmado que nem o Coolify real resolve isso de primeira classe (registra um servidor `id=0` fixo no host de instalação) — mas o **Dokploy documenta oficialmente um modo "UI only"** (~250MB RAM, instalação separada dos servidores gerenciados) exatamente como o usuário pediu. E, ao contrário do que o Coolify precisou resolver na reescrita v5 dele (agente por host via gRPC pra atravessar NAT — achado da arqueologia de código, `docs/v5/architecture/adr/` no repo deles), o nosso caso não tem problema de NAT: a conexão sempre parte do painel pra uma VPS com IP público, então SSH normal já resolve, sem precisar copiar esse modelo de agente.
2. **Achado de segurança real, não hipotético**: a arqueologia do Dokploy achou o `TODO(security)` que já existe no nosso próprio `packages/db/src/schema/servers.ts:16` (`privateKey` em texto puro) e trouxe de volta uma implementação de referência direta — envelope AES-256-GCM versionado (`packages/server/src/lib/encryption.ts` do Dokploy). Já era um item conhecido do roadmap, mas agora tem um desenho concreto pra seguir em vez de "criptografar de algum jeito". Achado à parte: nem o Coolify criptografa tudo (o `client_secret`/`webhook_secret` do GitHub App dele fica em texto puro) — não é motivo pra copiar essa lacuna.
3. **Dois candidatos de reescrita de arquitetura de médio prazo**, ambos vindos da arqueologia do Dokploy: (a) trocar `shellQuote` + comando shell string por `dockerode` (Docker Engine API real) tunelado sobre o mesmo SSH que já usamos — zero risco de escaping, streaming nativo; (b) Docker Swarm de nó único por servidor (não é clustering real, só ativa `docker service`/rolling-update/healthcheck nativos da própria Docker API) em vez de `docker run` puro. Os dois entram como itens de avaliação, não troca imediata — invisíveis pro usuário final, mas reduzem risco de bug de longo prazo.
4. **O diagnóstico de "layout horrível" não é estético, é falta de modo tabela.** Revisitando a instância real: toda listagem que pode crescer (recursos de um ambiente, projetos) no Coolify tem os dois modos — grade E tabela (colunas Resource/Type/Status/**Domain**/Server/Tags, busca/filtro/ordenação/paginação), com tabela como padrão. O `yeah` hoje só tem grade de cards em todo lugar, que funciona com poucos itens e degrada rápido com muitos — exatamente o cenário de microsserviços que o usuário citou como prioridade. Virou uma seção nova no roadmap (`🖥️ Reformulação de layout`) com plano sequenciado: componente de tabela reaproveitável primeiro, depois breakpoints mobile de verdade na sidebar/topbar, depois um shell de página compartilhado entre Application/Database/Service.
5. Também achado, sem virar código ainda: o fluxo "New Resource" do Coolify não abre formulário pra banco/serviço — cria na hora com valores padrão e já leva pra tela de configuração (confirmado tanto ao vivo quanto no Livewire `Project/Resource/Create` do código-fonte). Nosso `ResourceNewPage.vue` (recém-criado nessa mesma sessão) ainda abre formulário completo pros três tipos — candidato a simplificar depois.

Reescrevi `docs/ROADMAP.md` de forma bem mais completa a partir disso: seções novas de arquitetura (painel separado + Docker Engine API), uma seção de layout dedicada respondendo diretamente à reclamação do usuário, seção de paridade com Dokploy ao lado da de paridade com Coolify já existente, e a seção de segurança atualizada com a referência concreta de criptografia. Esse turno foi só pesquisa e documentação — nenhuma mudança de código, por pedido explícito do usuário ("cria documento com tudo isso... cria um roadmap novo com tudo isso").



## Fase 1 (começo): base responsiva + `ResourceTable`

Primeiro pedaço da reformulação de layout do `docs/ROADMAP.md`.

**Sidebar como drawer**: abaixo de 900px a sidebar antes simplesmente sumia (`display: none` a 640px) — no celular não existia navegação nenhuma. Agora vira gaveta off-canvas (`position: fixed`, `translateX(-100%)`), aberta por um botão hambúrguer novo no topbar, com backdrop clicável e fechando sozinha ao trocar de rota (`watch` em `route.fullPath`). No mobile o topbar mostra só o `TeamSwitcher` — o breadcrumb da própria página já cobre o resto e não cabia.

**`ResourceTable.vue`** (novo, `components/`): listagem reaproveitável de recursos com busca, filtros (tipo/status/servidor), ordenação, paginação (10/25/50) e toggle lista/grade — a preferência de visualização e o tamanho de página persistem em `localStorage`. Lista é o padrão; colunas Recurso (ícone + nome + detalhe), Tipo, Status, **Domínio** (link clicável, já vinha no DTO de app/serviço e só faltava exibir), Servidor, excluir com o mesmo "clique duas vezes". Abaixo de 720px cada linha vira um card empilhado com rótulos por coluna (`td::before { content: attr(data-label) }`) em vez de tabela com scroll lateral. `EnvironmentPage.vue` agora só monta as linhas e delega tudo pra ele. Também: `.detail-tabs` ganhou `overflow-x: auto` (abas de recurso passavam da tela no celular).

**Teste**: renderizei o app num iframe de 390px (a janela do Chrome não redimensiona o viewport via automação) com 4 recursos de teste (2 bancos, 1 app, 1 serviço, apagados depois): drawer abre/fecha, cards empilhados, busca filtra, toggle de grade persiste. Varri 12 rotas a 390px procurando overflow horizontal de página — nenhuma estoura (as tabelas de Servidores e Atualizações extrapolam só dentro do próprio `.table-wrap` com scroll, ainda a converter pro padrão de cards).

**Achado à parte**: depois que `./coolify` e `./dokploy` foram clonados na raiz, `bun test` passou a varrer os testes deles (355 testes, 100+ falhando) e o número "139 testes" que eu vinha citando estava inflado por isso — o nosso é **113 testes em 12 arquivos**. `bunfig.toml` agora tem `pathIgnorePatterns` pra ignorar `coolify/`, `dokploy/` e `savvy/`.


## Fase 0: segurança e fundação

Fechei a Fase 0 do roadmap inteira.

**Criptografia em repouso.** Novo tipo de coluna `encryptedText` (`packages/db/src/encryption.ts`, Drizzle `customType`): AES-256-GCM com IV aleatório por valor, formato `enc:v1:<base64url(iv|tag|ciphertext)>`, chave derivada por HMAC-SHA256 de `ENCRYPTION_KEY` (desenho copiado do envelope do Dokploy). Como cifra na escrita e decifra na leitura dentro do próprio tipo, **nenhuma rota nem job precisou mudar** — só as definições de schema. Colunas cobertas: `servers.private_key`, `databases.password`, `s3_storages.secret_access_key`, `notification_channels.{url, telegram_bot_token, smtp_password}` (a URL de webhook do Discord/Slack carrega o próprio token) e `{applications,services}.env_content` (`.env` de cada recurso costuma ter segredo). Migration `0015` só alarga as colunas pra `text` (o texto cifrado é maior que os `varchar(255)`). Rotação: chaves antigas em `ENCRYPTION_KEY_PREVIOUS`, separadas por vírgula; `decrypt` tenta todas.

**Instalações existentes.** A API roda `encryptExistingSecrets` no start: seleciona (via `sql` cru, pra não passar pelo decoder) as linhas ainda sem o prefixo `enc:v1:` e reescreve cada uma pelo tipo cifrado — idempotente, e uma linha que falha só é logada e tentada de novo no próximo start. Como o `yeah update` roda `up -d --build` *antes* das migrations, o código novo já lê linhas antigas em texto puro sem problema (valor sem prefixo passa direto). O `docker-compose.prod.yml` passa `ENCRYPTION_KEY` pra `api` **e** `worker` (o worker não recebia `SESSION_SECRET`, então usar ele como fallback direto quebraria a leitura no worker); instalação antiga sem a variável cai em `${ENCRYPTION_KEY:-${SESSION_SECRET}}`, e o `install.sh` novo gera uma `ENCRYPTION_KEY` própria. Em produção sem chave, `encryptSecret` recusa em vez de gravar em texto puro.

**`state` do OAuth do GitHub App** virou token assinado (HMAC do `SESSION_SECRET`), com expiração de 10 min e amarrado ao usuário logado que iniciou (`apps/api/src/lib/oauthState.ts`); o callback exige assinatura válida, sessão do mesmo usuário e membro do time. Antes era o `teamId` puro.

**Rate limit** em memória (`lib/rateLimit.ts`, um hook `onRequest` só): login/registro 10 por 5 min por IP, webhook do GitHub 600/min, qualquer outra escrita 120/min, leituras sem limite. IP vem do `X-Real-IP` que o nginx sobrescreve (a API só escuta em 127.0.0.1 em produção). Responde 429 com `Retry-After`.

**Pré-checagem de servidor.** Deploy, rollback e criação de banco/serviço devolvem `409 server_overloaded` se a última métrica (até 10 min) mostra disco ou memória em 95%+. A UI (`postConfirmingOverload` em `lib/api.ts`) pergunta e repete com `?force=true` — barra por padrão, mas o usuário decide.

**Circuit breaker** (`apps/worker/src/lib/circuitBreaker.ts`) no polling de métricas: 5 falhas seguidas abrem o circuito, espera de 5 min dobrando até 30, uma tentativa de prova depois do cooldown. Na prática o `server-metrics` batia num servidor morto a cada 60s pra sempre e enchia o log. Sobre o item "job que falha não re-tenta pra sempre": conferi que nenhum job disparado pelo usuário tem `attempts` no BullMQ (padrão é 1 tentativa), então esse risco não existia neles — o breaker cobre o único caso real, os jobs repetíveis.

**Testado contra API/banco/worker de dev reais.** Os dois servidores de teste tinham a chave SSH em texto puro; no start da API, log `encrypted 2 plaintext secret(s) at rest` e o banco passou a mostrar `enc:v1:...` (593 e 583 caracteres). Depois disso o `test-connection` e o job de provisionamento (worker) seguiram lendo a chave e chegando até a conexão SSH — e um dos servidores voltou `connected`, o que só acontece se a chave foi decifrada de verdade. Banco criado depois grava a senha cifrada (87 caracteres). Guard: com disco simulado em 97%, deploy e criação de banco → 409, `?force=true` → 200 e deploy na fila. Rate limit: 10 logins errados dão 401 e o 11º e o 12º dão 429. Compose validado com `docker compose config` nos dois casos (só `SESSION_SECRET` e com `ENCRYPTION_KEY` explícita). `bun test`: 138 testes (eram 113) — novos cobrem criptografia (round-trip, IV único, chave errada, adulteração, rotação, produção sem chave), assinatura/expiração do state, rate limiter, circuit breaker e a regra de sobrecarga. Recursos de teste apagados depois.

**Não testado de ponta a ponta**: o fluxo real de instalar o GitHub App (o dev não tem App configurado — a assinatura/expiração está coberta só por teste unitário) e o `confirm()` da UI de sobrecarga (só a API foi exercitada).


## Fase 1 (resto): telas, catálogo, fontes, busca global

Fechei a maior parte da Fase 1 que tinha ficado pra trás depois da base responsiva. Perguntado pelo usuário por que eu não tinha feito: eu tinha parado na tabela de recursos porque o pedido seguinte foi a Fase 0.

**Peças compartilhadas** (`components/`): `StatusBadge` + `lib/status.ts` (uma tabela só decide a cor de qualquer status do app, no lugar dos mapas `statusBadge` que cada página tinha), `PageState` (carregando/erro/vazio), `ViewToggle`, `ListPager` (tamanhos de página configuráveis) e `Modal`. `ResourceTable` foi refeita em cima delas. `ResourceDetailShell` virou o cabeçalho único de Aplicação/Banco/Serviço (breadcrumb, título, status, excluir com confirmação em dois cliques, abas, sub-navegação); os três `*Layout.vue` perderam o markup e a lógica de confirmação de exclusão duplicada.

**Projetos**: grade ou lista, busca, ordenação (nome/recentes/mais recursos), paginação e "Novo projeto" em modal. A API passou a devolver `resourceCount` (soma de apps+bancos+serviços via subquery) pra mostrar "1 env · N recursos" no card.

**Servidores**: a tela era uma pilha de cards por servidor (tabela, proxy, métricas e terminal de cada um, tudo na mesma página). Agora a lista mostra status, proxy e barras de CPU/RAM/disco ao vivo, e cada servidor tem tela própria (`ServerLayout`, abas Geral / Proxy / Recursos / Terminal) e `/servers/new` pro formulário de adicionar.

**Catálogo "Novo recurso"**: busca, filtro de categoria, seletor de servidor de destino, seções Aplicações / Bancos / Serviços com cards (ícone, nome, imagem, descrição, Docs / Website / Deploy). Banco e serviço são criados com o clique, com valores padrão, e já caem na tela do recurso — mesmo padrão do Coolify (lá clicar no card *é* a criação). Só aplicação Git abre um modal (nome, repositório, branch, porta). Pra isso `DATABASE_ENGINES` ganhou `icon`/`description`/`website`/`docsUrl` e o `SERVICE_CATALOG` ganhou `website`/`docsUrl`.

**Fontes**: `GithubPage` virou `SourcesPage` (tabela Fonte/Provedor/Status, "Nova fonte" com GitHub e GitLab "em breve") e `SourceDetailPage` (abas Geral / Permissões / Recursos). A aba Recursos vem de um endpoint novo, `GET /teams/:teamId/github/resources`, que lista as aplicações que usam a fonte — o que quebra se você desconectar. `/github` redireciona pra `/sources`.

**Time, Configurações, busca**: página Time (renomear, novo time; `PUT /teams/:teamId` novo), Configurações (tema, versão da plataforma, conta), sidebar reagrupada em Workspace / Infraestrutura / Gerenciar, botão de recolher a sidebar no desktop e busca global `Ctrl+K` (`GET /teams/:teamId/search`: projetos, servidores, apps, bancos, serviços e páginas, com `ILIKE` escapando `%`/`_` do que o usuário digita).

**Testado no navegador contra API/banco de dev reais**: criei um PostgreSQL pelo catálogo (1 clique → tela do banco com o shell novo, 2 abas, subtítulo certo) e excluí pelo botão do shell; lista/grade de servidores, as 4 abas do servidor, `/servers/new`, Fontes (aviso de "GitHub App não configurado" e redirect de `/github`), Configurações, renomear o time (e voltar) refletindo no topbar, palette `Ctrl+K` (busca "e2e" achou os 2 servidores, Enter navegou, Esc fechou) e a sidebar recolhida (64px, lembrada). Varredura de overflow horizontal a 390px em 10 telas: nenhuma estoura a página. `vue-tsc`, `tsc` da API e 138 testes ok.

**Não testado**: fluxo real de conexão do GitHub App (dev sem App), criar aplicação pelo modal do catálogo, o atalho `/` de foco na busca, a tela a 768px, e a aba Recursos/Permissões da fonte (sem instalação pra abrir). **Pendências da Fase 1** (no roadmap): migrar `PageState`/`StatusBadge` pras telas antigas (Dashboard, Notificações, Armazenamento, Atualizações, deploys), sidebar completa (Terminal, Destinations, Shared Variables, Keys & Tokens, Tags — dependem de features de fases futuras), e o gráfico histórico no dashboard (depende da série temporal da Fase 5).

**Efeito colateral**: quase todo o tempo de teste esbarrou em aba de navegador em segundo plano (`visibilityState: hidden`), que estrangula `setTimeout` e faz screenshots estourarem timeout — scripts longos precisam rodar em segundo plano com a aba trazida pra frente por um screenshot.


## Fase 1: fechamento

Fechei os itens que ficaram abertos na Fase 1 — o roadmap não tem mais caixa desmarcada nela.

**Estados e status padronizados.** `StatusBadge` ganhou um segundo modo (`kind="job"`): pra deploy, backup e operação da plataforma, `running` é "em andamento" (amarelo) e `queued` é "esperando" (cinza); pra recurso/servidor, `running`/`connected` é verde. Foi o ponto que quase quebrou a migração — uma tabela única de cores teria pintado todo deploy em andamento de verde. Dashboard, aba de deploys, backups e Atualizações trocaram os mapas locais por ele; todas as telas (Notificações, Armazenamento, Projeto, Atualizações e os quatro layouts + `ResourceTable`) passaram a usar `PageState` no carregando.

**Descrição do time** (coluna `teams.description`, migration `0016`, campo na página Time). **Cards de projeto** ganharam "+" (vai direto pro catálogo do ambiente se o projeto tem um só; senão pra tela de ambientes) e engrenagem, visíveis no hover — e sempre visíveis em tela de toque (`@media (hover: none)`). Não fiz botão "Settings" de ambiente (não existe nada pra configurar num ambiente ainda) nem logos reais das tecnologias (ficaram os ícones genéricos).

**Movido de fase, não largado**: a sidebar completa depende de features que não existem (Terminal, Destinations, Shared Variables, Keys & Tokens, Tags) — cada uma entra na sidebar junto da própria feature em vez de virar link pra página vazia; o gráfico histórico do dashboard passou pro item de série temporal da Fase 5.

**Testado contra API/banco de dev reais**: "+" do card levou pro `/new` do ambiente; a tecla `/` focou a busca da lista; criar aplicação pelo modal do catálogo (nome + URL) abriu a tela da aplicação com o shell e as duas abas, e excluir pelo botão do shell voltou pra lista; a descrição do time gravou e limpou pela tela (a API também respondeu certo direto); Dashboard, Atualizações, Notificações, Armazenamento e Projeto renderizam com o `StatusBadge`/`PageState` novos. Varredura de overflow horizontal a **768px** em 12 telas: nenhuma estoura (a 390px já tinha sido feita). `vue-tsc`, `tsc` e 138 testes passam.

**Falhas do meu teste, não do app**: dois resultados "errados" na primeira rodada (aplicação não criada, descrição `null`) eram o script de teste lendo o estado antes da aba em segundo plano terminar — refeitos passo a passo, deram certo. Ainda não olhei visualmente a tela de servidores a 768px (o iframe estava carregando no screenshot); só a varredura de overflow cobre esse tamanho.


## Fase 2: painel separado do servidor gerenciado

A premissa da pesquisa se confirmou: o `yeah` já tratava todo destino como remoto por SSH, então "painel fora da VPS" era quase só mudar o instalador e tirar as arestas em volta.

**`install.sh`**: `--control-plane-only` (também `YEAH_CONTROL_PLANE_ONLY=1`, ou a pergunta "esta máquina também vai rodar os apps?" quando há terminal) não gera a chave SSH, não mexe no `authorized_keys` e não escreve `LOCALHOST_SSH_*` no `.env` — o painel sobe sem "Servidor local". Pra dar pra testar sem rodar o instalador inteiro, a geração do `.env` virou uma função (`render_env`) e o script aceita `YEAH_INSTALL_SOURCE_ONLY=1` pra só carregá-la; `test/install.test.ts` cobre modo padrão, só-painel, túnel, as duas coisas juntas e opção desconhecida (pula sozinho onde não há `bash`).

**Arestas que o modo separado expôs**: (1) *Atualizações* — "atualizar plataforma/sistema" agem por SSH num servidor `is_platform_host`, que não existe nesse modo; antes falhava só dentro do job. Agora a API responde 409 `no_platform_host`, `GET /updates/platform` traz `hasPlatformHost` e a tela troca os botões por "rode `sudo yeah update` na máquina do painel". (2) Adicionar a primeira VPS exigia gerar uma chave com `ssh-keygen` por fora — a tela ganhou **Gerar chave nova** (`POST /teams/:teamId/servers/generate-key`), que devolve o par e o comando pra autorizar a chave pública. (3) Não havia como remover servidor: `DELETE /teams/:teamId/servers/:serverId`, recusando se ainda tem recurso (as linhas cascateariam com os containers ainda rodando); é também o caminho pra converter uma instalação antiga.

**Achado técnico**: o `ssh2` não lê chave privada ed25519 em PKCS#8 (o único formato que o `crypto` do Node/Bun exporta) — `Unsupported key format`. A chave é montada à mão no formato `openssh-key-v1` (`packages/ssh/src/keygen.ts`), e o teste confere que o `ssh2` a parseia e deriva exatamente a chave pública entregue ao usuário.

**Túnel da Cloudflare**: `--cloudflare-tunnel-token=` grava `COMPOSE_PROFILES=tunnel` no `.env` (o Compose lê isso sozinho, então `yeah update`/`logs` continuam funcionando), sobe um serviço `cloudflared` e deixa a porta do painel em `127.0.0.1` (`WEB_BIND`). Duas consequências tratadas: o cookie de sessão sai com `Secure` quando `WEB_ORIGIN` é https, e o rate limit (Fase 0) enxergaria todo visitante como o IP do container do túnel — o nginx agora troca o IP pelo cabeçalho `CF-Connecting-IP` só quando `TRUST_CF_CONNECTING_IP=1` **e** a conexão vem de faixa privada (a rede do Docker), então quem bate direto na porta exposta não forja o cabeçalho.

**Testes reais**: (a) instalador e nginx — `nginx -t` nas três variantes (normal, com IP real, com `PANEL_PATH`) e um nginx real respondendo o IP do cabeçalho com a opção ligada e ignorando um cabeçalho forjado com ela desligada (achei no caminho que montar o `realip.inc` do repo como volume gravável deixava o entrypoint sobrescrever o arquivo do host — os testes seguintes deram falso "ignora", refeitos com o arquivo restaurado e montado só-leitura); `docker compose config` sem e com o profile. (b) **Ponta a ponta** com o painel rodando aqui no PC sem nenhum servidor local (o `.env` de dev nunca teve `LOCALHOST_SSH_*`, então é exatamente o modo separado) e uma "VPS" remota simulada por um container `docker:dind` com sshd: gerei a chave pela tela, autorizei a pública no container com o comando mostrado, adicionei o servidor — `connected` e "Docker version 27.5.1" lido da VPS —, provisionei um PostgreSQL (container `yeah-db-*` subiu no docker remoto), criei agendamento e rodei backup manual (`success`, dump gravado em `/opt/yeah-backups/...` na VPS), li métricas (CPU 12% / RAM 24% / disco 3% por SSH), vi as duas rotas de atualização darem 409, vi a remoção do servidor recusada com um banco nele, apaguei o banco (container remoto derrubado, 0 restantes) e removi o servidor (200). De brinde o circuit breaker da Fase 0 disparou de verdade num servidor de teste morto ("failed 5 times in a row — backing off").

**Não testado**: rodar o `install.sh` inteiro numa VPS Linux; token real da Cloudflare (só compose/nginx validados); build de aplicação a partir do Git e proxy Traefik na VPS remota — o Docker aninhado do teste tinha `TLS handshake timeout` no Docker Hub (o `postgres:16-alpine` foi copiado do Docker do host com `docker save | docker load`), então só banco + backup + métricas passaram por lá; e o aviso "rode `sudo yeah update`" da tela Atualizações (só aparece com commit rastreável, ou seja, em produção). O painel também não foi testado com a máquina do painel realmente em outra rede que a VPS.


## Fase 3 (parte 1): ciclo de vida e operação de aplicações

Primeiro pedaço da Fase 3 — o que dá mais valor operacional sem mexer em como o build funciona (build packs, preview, Compose ficam pras próximas partes).

**Iniciar / parar / reiniciar** viraram um job novo (`application-lifecycle`, worker) em vez de SSH dentro da API; a aplicação ganhou o status `stopped` (enum alterado na migration `0017`) e um evento WS `application.status`, que o job de deploy também passou a publicar — antes a tela só descobria o fim do deploy pelo evento do deployment. O layout mostra Iniciar (parada) ou Reiniciar + Parar (rodando) ao lado de Deploy.

**Healthcheck**: colunas novas (`health_path`, intervalo, timeout, tentativas, período de início) viram `--health-*` no `docker run`. O que muda de verdade é o deploy: depois de subir o container ele espera o Docker marcar `healthy` (até período de início + intervalo × tentativas + 30s), e se marcar `unhealthy` (ou o container morrer) o deploy falha imprimindo as últimas 40 linhas do log — antes "container subiu" já contava como sucesso. A checagem tenta `127.0.0.1` antes de `localhost` (um app preso a IPv4 é inalcançável se `localhost` resolver pra `::1`) e usa `curl` ou `wget`, o que a imagem tiver.

**Redeploy mais educado**: `docker rm -f` virou `docker stop -t N` + `rm` (N configurável, padrão 10s); opções extras do `docker run` num campo de texto, parseadas em palavras (aspas e escapes como o shell, mas nada é interpretado) e cada palavra passa por `shellQuote` — `--name`, `-d`, `--rm`, `--env-file`, `--restart` são recusados (`parseDockerOptions` em `packages/shared`, com testes).

**Webhook de deploy por URL** (`POST /hooks/deploy/:token`, sem sessão — a URL é a credencial): o token só aparece uma vez, ao gerar, e o banco guarda o sha256 (mesmo raciocínio das senhas: vazar o banco não vaza URLs de deploy que funcionem). `[skip ci]`/`[skip cd]` no commit pula o auto-deploy do GitHub.

**Logs do container**: aba nova, `GET .../logs?tail=N` (uma leitura `docker logs --tail` limitada, mais uma exceção documentada de "a API abre SSH") com atualização a cada 3s. Não é `docker logs -f`: streaming exigiria o WS aceitar inscrições, hoje ele só faz broadcast do Redis. **Outras abas novas**: Avançado, Webhooks, Zona de perigo; e o botão **Gerar domínio** na aba de domínio (sugere `<slug>.<wildcard do servidor>` com o mesmo `resourceSlug` que o worker usa).

**Testado com o painel local e uma "VPS" docker-in-docker por SSH**: conexão pelo par de chaves gerado pela tela; app clonada de um repositório git local da VPS e buildada lá; o primeiro deploy falhou por erro *meu* na imagem de demo (`httpd` não existe no busybox do alpine — o log mostrou isso) e o segundo, com a imagem de demo sem servidor HTTP funcional, terminou `unhealthy` (deploy `failed`, status `error`, últimas linhas do log no deploy) — depois de trocar o demo por nginx: deploy `success` com o step "aguardando o healthcheck", container `healthy`, `--hostname demo-host` e o label com espaço chegaram certos no `docker inspect`, parar → `stopped`, iniciar e reiniciar → `running`, o webhook devolveu 200 e disparou um deploy que terminou `success` (token errado → 404), e um `/nope` como caminho de healthcheck derrubou o deploy como esperado. Tudo isso pelas rotas da API com a sessão do navegador; nas telas, conferi por DOM que as abas Logs/Avançado/Webhooks/Zona de perigo carregam, mostram os valores salvos e que o botão "Gerar domínio" preenche o campo. `vue-tsc`, `tsc` (api/worker) e 170 testes passam.

**Achado do teste**: o primeiro healthcheck (só `localhost`) falhava contra o demo; a causa real foi o servidor de demo que nunca subiu, mas foi o que levou a tentar `127.0.0.1` antes.

**Não testado**: `[skip ci]` num push real do GitHub; o clique nos botões Iniciar/Parar/Reiniciar do layout (só as rotas e o WS); a aba Logs vendo texto de um app que escreve muito; Gerar domínio pra serviços (só aplicações têm). **Ainda na Fase 3**: build packs (Nixpacks/Railpack/estático/Compose/Docker Image/Dockerfile colado), Deploy Key/GitLab/Bitbucket/Gitea, registry com push, mudanças pendentes, terminal interativo, sub-abas Git Source/Servers/Resource Operations/Metrics, preview deployments, scheduled tasks, volumes avançados, múltiplos domínios, tags, timeout SSH, Shared Variables e build-time vs runtime.


## Fase 3 (parte 2): build packs e origens de código

Seis jeitos de colocar uma aplicação no ar, todos passando pelo mesmo caminho de deploy (healthcheck, graça de parada, opções extras, rollback de commit) — só muda como a imagem é produzida.

**Modelo**: `build_pack` ganhou `static`, `nixpacks`, `image` e `dockerfile_inline` (migration `0018`), mais colunas `docker_image`, `dockerfile_content`, `publish_directory`, `deploy_key` (criptografada como os outros segredos) e `deploy_key_public`. `buildPackUsesGit()` em `packages/shared` separa os que clonam repositório dos que partem de imagem ou de texto.

**Como cada um builda** (`buildImageSteps`, função pura com testes): `dockerfile` como antes; `static` gera um Dockerfile `nginx:alpine` com `COPY ["<pasta>", "/usr/share/nginx/html"]` e passa por stdin (`docker build -f -`), forçando a porta 80 — a pasta só aceita caminho relativo simples (sem `..`, aspas, espaços); `image` só faz `docker pull` e o `docker run` usa a imagem do registry em vez da imagem buildada (o último argumento do `buildRunCommand` deixou de ser sempre o nome do container); `dockerfile_inline` escreve o Dockerfile numa pasta que só tem ele e builda de lá, então `.env` e o resto do diretório da app não vazam pro contexto; `nixpacks` instala o binário no servidor se faltar e roda `nixpacks build`.

**Deploy key**: ao criar com uma URL SSH, a API gera um par ed25519 (o mesmo gerador da tela de servidores), guarda a privada cifrada e devolve só a pública. No deploy o worker grava a privada no servidor (chmod 600) e o clone roda com `GIT_SSH_COMMAND='ssh -i … -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'` — usa exatamente aquela chave, não a do agente do usuário. A tela da aplicação mostra a pública num aviso pra cadastrar no repositório.

**Catálogo**: cards novos (Deploy Key, Nixpacks, Site estático, Docker Image, Dockerfile) e um modal com os campos de cada modo.

**Testado** (painel local + "VPS" docker-in-docker, repositórios git locais na VPS): estático — `public/` do repo respondeu `<h1>static-ok</h1>` na porta 80; `image` (`nginx:alpine`) e `dockerfile_inline` deram `success`; validação recusou (400) imagem com `;`, Dockerfile sem `FROM`, pasta `../etc` e deploy key com URL https; **deploy key: o primeiro deploy falhou com "Permission denied" no clone e, depois de autorizar a chave pública na VPS, passou e gravou o commit** — e o DTO da aplicação não devolve a privada. Nas telas conferi os campos de cada modo do modal, o subtítulo e o aviso da chave. 182 testes, `vue-tsc` e `tsc` passam.

**Não testado**: Nixpacks de verdade (sem internet no Docker aninhado), então o item continua desmarcado no roadmap; registry privado com login; repositório público real por HTTPS (usei caminho local, que passa pelo mesmo `git clone`).


## Fase 3 (parte 3): variáveis compartilhadas e build-time vs runtime

**Sintaxe no `.env` da aplicação** (`packages/shared/src/env.ts`, funções puras com testes): `CHAVE=valor` continua sendo só runtime; `build:CHAVE=valor` existe só durante o build; `both:CHAVE=valor` nos dois; e qualquer valor pode conter `{{time|project|environment.NOME}}`. O worker deixou de gravar o texto cru no servidor: parseia, expande as referências, e escreve só runtime + both no arquivo do container; build + both viram `--build-arg` (Dockerfile/Dockerfile colado) ou `--env` (Nixpacks), cada um passando por `shellQuote`. Comentários e linhas que não são `CHAVE=valor` deixam de ir pro container — antes iam crus pro `--env-file`.

**Variáveis compartilhadas**: tabela `shared_variables` (migration `0019`) com escopo, valor **criptografado** e unicidade por (time, escopo, projeto, ambiente, nome) — `NULLS NOT DISTINCT`, senão o Postgres trataria dois registros de escopo "time" com o mesmo nome como diferentes. CRUD em `/teams/:teamId/variables` (a API confere que o projeto/ambiente citado é do time) e uma página "Variáveis" na sidebar, com abas por escopo, valor editável na própria linha, e a referência pronta pra copiar. Uma referência que não existe **falha o deploy** dizendo qual (`variável compartilhada não encontrada: {{project.X}}`) em vez de virar string vazia em silêncio; o mesmo nome em escopos diferentes convive sem regra de precedência, porque cada referência nomeia o seu.

**Bug que o teste pegou (e o typecheck não)**: escrevi na tela `{{ "{{project.NOME}}" }}` pra mostrar um exemplo de referência — o compilador de templates do Vue fecha a interpolação no primeiro `}}`, dentro da string. O `vue-tsc` passou, mas o Vite devolveu erro de compilação e **o app inteiro ficou em branco** (a página é importada pelo roteador, então um erro nela derruba todas). Consertado guardando o texto numa constante do script. Fica a lição: só typecheck não basta pra `.vue` — precisa abrir no navegador. Segundo bug: criar variável duplicada dava 500 em vez de 409 (o erro do driver vem embrulhado pelo Drizzle; agora a checagem olha a cadeia de `cause` e o código 23505).

**Testado com o painel local + "VPS" docker-in-docker**: variáveis nos três escopos (mesmo nome em projeto e ambiente, valores diferentes), atualização de valor, chave inválida e escopo sem alvo (400), duplicada (409 depois do conserto); uma aplicação com `MODE={{project…}}`, `ENVNAME={{environment…}}`, `WHO={{team…}}`, `build:BTOKEN=tok123` e `both:GREETING=hello` deu deploy `success` e o container tinha `MODE=production`, `ENVNAME=staging`, `WHO=from-team-2` (valor atualizado depois de criar), `GREETING=hello` e **não** tinha `BTOKEN`; o arquivo gerado no build dentro da imagem dizia `tok123-hello` (o build-arg chegou). Com `{{project.ZZ_MISSING}}` o deploy falhou com a mensagem certa, antes de clonar. A página lista as variáveis por aba com o alvo de cada uma. 197 testes, `vue-tsc` e `tsc` passam.

**Não testado**: `build:` com Nixpacks (mesma limitação de rede); serviços continuam sem expansão de referência (o job de provisionamento não passa por esse caminho); a dica na tela de variáveis de ambiente da aplicação foi vista só no código (o clique de edição inline e de exclusão da página de variáveis também).
