# Roadmap

Só o que **falta desenvolver**, por fases, com checkbox em tudo — marcar `[x]` quando terminar (testado de ponta a ponta, ver `docs/DEVLOG.md`). O que já funciona hoje está no `README.md` e no `docs/DEVLOG.md`; não é repetido aqui.

Fontes: pesquisa em documentação e código-fonte do Coolify e do Dokploy (clones locais gitignored), revisita à instância real de produção do usuário e auditoria do nosso próprio código. Notas cruas (com nome de instância real) ficam em `docs/coolify-research.md` e `docs/dokploy-research.md` — gitignored, não vão pro repo público. Aqui só entra a versão sanitizada.

Ordem das fases = ordem de prioridade sugerida (estrutural antes de superficial). Dentro de cada fase, de cima pra baixo.

---

## Fase 0 — Segurança e fundação

- [x] Criptografar `servers.private_key` em repouso (hoje texto puro, `TODO(security)` em `packages/db/src/schema/servers.ts`). Referência: envelope AES-256-GCM do Dokploy — chave derivada via HMAC-SHA256 de uma `ENCRYPTION_KEY` dedicada, prefixo versionado `enc:v1:`, suporte a múltiplas chaves pra rotação.
- [x] Criptografar `databases.password` e demais segredos guardados (chave secreta S3, senha SMTP, token do Telegram, URLs de webhook Discord/Slack, `.env` de apps e serviços) com o mesmo mecanismo — o GitHub App vive em variáveis de ambiente, não no banco — nem o Coolify criptografa `client_secret`/`webhook_secret` do GitHub App, não repetir essa lacuna.
- [x] Migration que re-cifra os valores já existentes (no start da API) + geração de `ENCRYPTION_KEY` no `install.sh` (instalações antigas caem no `SESSION_SECRET`).
- [x] Assinar/expirar o `state` do fluxo OAuth do GitHub App (hoje é o `teamId` puro).
- [x] Rate limiting na API (login, criação de recursos, webhooks).
- [x] Circuit breaker no `worker` (polling de métricas: 5 falhas seguidas → espera 5 min dobrando até 30). Jobs disparados pelo usuário não retentam (BullMQ sem `attempts`), então não precisaram.
- [x] Checar snapshot de métricas do servidor *antes* de enfileirar deploy/provisionamento e barrar/avisar se já estiver no limite.

## Fase 1 — Reformulação de layout (mobile-first, escalável)

Diagnóstico (revisita à instância real): cor/ícone/CSS já estão bons; o problema é **densidade e escalabilidade** — só temos grade de cards, que degrada com muitos recursos (cenário de microsserviços).

**Base responsiva (afeta toda tela — fazer primeiro)**
- [x] Sidebar vira drawer recolhível abaixo de 900px + botão hambúrguer no topbar, e botão de recolher (64px, só ícones) no desktop, lembrado no navegador.
- [x] Nenhum overflow horizontal de página nas telas testadas a 390px; tabelas de recursos/servidores/projetos viram cards empilhados no mobile (a tabela da tela Atualizações ainda só rola dentro do próprio container).
- [x] Formulários em coluna única no mobile; alvos de toque ≥ 44px. (regra global de CSS até 720px; os alvos de toque não foram medidos um a um)
- [x] Testar cada tela reformulada em 3 larguras (≈390px, ≈768px, desktop) antes de marcar pronta. Feito: varredura de overflow horizontal em 10 telas a 390px e 12 a 768px, teste funcional no desktop.

**Componentes compartilhados**
- [x] `ResourceTable.vue`: colunas ícone+nome, tipo, status, **domínio**, servidor, tags; busca, filtro (tipo/status/servidor/tag), ordenação, paginação com seletor de itens por página. Coluna de tags fica pra quando tags existirem (Fase 3).
- [x] Toggle lista/grade persistido em `localStorage`; **tabela como padrão** em listagens que crescem.
- [x] `ResourceDetailShell.vue`: header (título, status, breadcrumb, ações) + subnav de abas, reaproveitado por Application/Database/Service (hoje cada `*Layout.vue` refaz o próprio). Application/Database/Service já usam.
- [x] Estados vazios/carregando/erro padronizados (`PageState`) e badge de status único (`StatusBadge`, com tom próprio pra status de recurso e de job) em todas as telas, inclusive Dashboard, Notificações, Armazenamento, Atualizações, Projeto, deploys e backups.
- [x] Busca global (`Ctrl+K`) no topo da sidebar; `/` foca a busca da listagem atual. Atalho `/` (foca a busca da listagem) implementado mas não testado no navegador.

**Telas**
- [x] `EnvironmentPage.vue` → `ResourceTable` (lista + grade) e botão "Novo recurso". Sem botão Settings do ambiente: ainda não há nada pra configurar num ambiente.
- [x] `ProjectsPage.vue` → grade/lista com "X env · Y recursos", busca, ordenação, atalho "+" (vai pro catálogo do ambiente) e engrenagem (vai pros ambientes) em cada card.
- [x] `ServersPage.vue` → mesmo padrão lista/grade, métricas ao vivo por linha. Cada servidor ganhou tela própria (abas Geral / Proxy / Recursos / Terminal) e `/servers/new`.
- [x] **Catálogo "Novo recurso"** (`ResourceNewPage.vue`): busca + filtro + dropdown de categorias; seções Applications / Databases / Services; card com ícone da tecnologia, nome, tipo de origem, descrição, botões **Docs** / **Website** / **Deploy →**; aviso de marcas registradas na seção de serviços. Hoje só 2 origens de aplicação (Git público e GitHub App); as demais dependem da Fase 3.
- [x] Banco e serviço = **1 clique cria com valores padrão** e já leva pra tela de configuração (sem formulário) — só aplicação Git abre passo intermediário.
- [x] Ícone por engine de banco (hoje `DATABASE_ENGINES` não tem campo `icon`) e ícones reais de tecnologia nos cards. Ícones genéricos do Material Symbols por engine; logos reais das tecnologias não.
- [x] **`GithubPage.vue` → "Sources"**: tabela Source | Provider | Status, botão "New Source" (dropdown GitHub/GitLab), busca; detalhe da fonte com App Name, Organization, System Wide?, URL HTML/API (GitHub Enterprise), App Id, Installation Id, Client Id/Secret, Webhook Secret, chave privada; aba **Permissions** (Content: read, Metadata: read, Pull Request: write) e aba **Resources** (quais apps usam essa fonte — projeto → ambiente → nome → tipo). Feito como `SourcesPage`/`SourceDetailPage` (tabela, "Nova fonte", abas Geral/Permissões/Recursos). App Name, System Wide e Client Id/Secret não aparecem porque o GitHub App vive em variáveis de ambiente; GitLab fica como "em breve".
- [x] Sidebar no padrão Workspace / Infraestrutura / Gerenciar com todas as telas que existem hoje (Dashboard, Projetos, Servidores, Fontes, Armazenamento, Time, Notificações, Atualizações, Configurações). Terminal, Destinations, Shared Variables, Keys & Tokens e Tags entram na sidebar junto com a feature de cada um (Fases 3, 4, 5 e 7) — não criei link pra página que ainda não existe.
- [x] Página **Team**: nome e descrição editáveis, criar novo time (single-admin: sem Members/Admin View).
- [x] Página **Settings** da instância (domínio do painel, versão, etc.). Básica: tema, versão da plataforma, conta.
- [x] Dashboard: gráfico histórico de métricas por servidor — movido pra Fase 5 (depende da série temporal; ver o item de série temporal lá).

## Fase 2 — Modo "painel separado do servidor gerenciado"

Pedido do usuário: rodar o painel num PC/servidor barato à parte, sem gastar recurso da VPS de produção. **Já é ~90% possível** — o worker só fala SSH e `localhostServer.ts` só registra servidor local se `LOCALHOST_SSH_PRIVATE_KEY_BASE64` existir; a lacuna é o `install.sh`. Dokploy documenta o mesmo modo oficialmente (~250MB de RAM só-UI). Sem problema de NAT: a conexão parte do painel pra VPS com IP público.

- [x] `install.sh` com modo `--control-plane-only` (flag, `YEAH_CONTROL_PLANE_ONLY=1` ou pergunta interativa) que pula `ssh-keygen`, o `authorized_keys` e as env vars `LOCALHOST_SSH_*`. A geração do `.env` está coberta por testes (`test/install.test.ts`); o script inteiro não foi rodado numa VPS Linux real.
- [x] Documentar a topologia no `README.md`, `docs/INSTALLATION.md` (seção "Painel separado") e `docs/ARCHITECTURE.md`.
- [x] Testar de ponta a ponta: painel no PC (sem servidor local) + "VPS" remota (container docker-in-docker com sshd). Provisionou um PostgreSQL por SSH (running), rodou backup (success), leu métricas, removeu tudo (container remoto derrubado). Não cobriu build de aplicação a partir do Git nem proxy (a rede do docker aninhado falhava no Docker Hub), nem uma VPS de verdade pela internet.
- [x] Validar que **métricas remotas funcionam** nesse modo: sim — CPU 12% / RAM 24% / disco 3% lidos por SSH da VPS remota, sem nada instalado nela.
- [x] Guia "adicionar sua primeira VPS remota": botão **Gerar chave nova** na tela de adicionar servidor (par ed25519 em formato OpenSSH, validado contra o parser do ssh2) + comando pronto pra autorizar a chave pública + seção no `docs/INSTALLATION.md`.
- [x] **Cloudflare Tunnel pro próprio painel**: `--cloudflare-tunnel-token=` sobe o `cloudflared` (profile `tunnel` do compose), deixa a porta local em `127.0.0.1`, usa origem https e cookie `Secure`, e o nginx confia em `CF-Connecting-IP` só vindo da rede interna do Docker (testado: com a opção ligada usa o IP do cabeçalho, desligada ignora um cabeçalho forjado). Compose e nginx validados (`config`, `nginx -t`); não testado com um token real da Cloudflare.
- [x] "Converter" instalação existente: **Servidores → (servidor) → Remover servidor** tira o servidor local do painel sem apagar nada na máquina, recusando enquanto houver recurso nele (rota nova `DELETE /teams/:teamId/servers/:serverId`; testada).
- [x] Esconder atualização de plataforma/sistema quando o painel está em modo separado: `GET /updates/platform` devolve `hasPlatformHost`, as rotas de execução respondem 409 `no_platform_host` (testado) e a tela Atualizações esconde o card de sistema e troca o botão por "rode `sudo yeah update`" (o aviso só aparece com commit rastreável, ou seja, em produção; não visto no navegador).

## Fase 3 — Aplicações

**Build e origem**
- [ ] Build pack **Nixpacks** (detecta linguagem, builda sem Dockerfile). Implementado (card no catálogo, instala o nixpacks no servidor se faltar e roda `nixpacks build`) e coberto por teste unitário dos comandos, mas **não foi rodado de verdade** — o Docker aninhado do ambiente de teste não alcança a internet pra instalar o nixpacks. Marcar quando testado numa VPS real.
- [ ] Build pack **Railpack** (alternativa mais nova que o Coolify oferece).
- [x] Build pack **estático** (a pasta escolhida do repositório servida por nginx, Dockerfile gerado): testado — o site do repositório respondeu na porta 80 da VPS.
- [ ] Deploy via **Docker Compose** (multi-container por aplicação).
- [x] Deploy via **Docker Image** de qualquer registry público (sem Git, sem build): testado. Registry privado com login ainda não (item de registry abaixo).
- [x] Deploy via **Dockerfile colado** (sem Git; o build usa uma pasta só com o Dockerfile): testado.
- [x] Repositório **público por URL** sem credencial: tem card próprio no catálogo ("Repositório Git público").
- [x] Repositório privado via **Deploy Key** (SSH, chave ed25519 por aplicação, privada criptografada, pública mostrada na tela pra cadastrar no repositório): testado — o clone falhou com "Permission denied" antes de autorizar a chave e funcionou depois, gravando o commit.
- [ ] Fontes **GitLab** (GitLab App), **Bitbucket** e **Gitea**.
- [ ] Registry privado (Docker Hub privado, GHCR…) com **push automático** da imagem buildada, tag = SHA do commit — builda uma vez e reusa.
- [x] `[skip ci]` / `[skip cd]` na mensagem do commit pula o auto-deploy do push (também `[ci skip]`, `[no ci]`…). Coberto por teste unitário; não testado com um push real do GitHub.
- [ ] Tela de **mudanças pendentes**: contagem de campos alterados (env, domínio…) desde o último deploy, antes de aplicar.
- [x] Grace period de parada configurável (`docker stop -t`) em redeploy, parar e reiniciar — aba Avançado.
- [x] Custom Docker options (flags extras do `docker run`): cada palavra vira argumento entre aspas, nada passa por shell; `--name/-d/--rm/--env-file/--restart` são recusados.

**Ciclo de vida e operação**
- [x] Ações **iniciar / parar / reiniciar** (job novo `application-lifecycle` no worker, status `stopped`, evento WS `application.status`) e **substituir** (= o botão Deploy, que recria o container).
- [x] **Logs do container em execução** em aba própria (`docker logs --tail`, atualização a cada 3s com "Acompanhar"). É polling de uma leitura limitada pela API, não um stream `-f` — streaming de verdade exigiria protocolo de inscrição no WebSocket.
- [ ] **Terminal interativo** dentro do container (WebSocket → API → SSH → `docker exec -it`) e do servidor.
- [x] **Healthcheck configurável** por aplicação (caminho HTTP, intervalo, timeout, tentativas, período de início): o deploy só termina com sucesso quando o container fica `healthy` e, se não ficar, falha mostrando as últimas linhas do log. Bancos e serviços ainda não têm (Fase 4).
- [x] Sub-aba **Avançado** (healthcheck, tolerância de parada, opções extras do docker).
- [ ] Sub-aba **Git Source** (trocar fonte/branch/repo depois de criado).
- [ ] Sub-aba **Servers** (ver/trocar servidor de destino).
- [x] Sub-aba **Webhooks**: URL de deploy manual (`POST /hooks/deploy/:token`, só o hash do token é guardado e a URL aparece uma vez) + explicação do auto-deploy do GitHub e dos marcadores de skip.
- [ ] Sub-aba **Resource Operations** (clonar, mover entre ambientes/projetos, migrar entre servidores).
- [ ] Sub-aba **Metrics** (CPU/RAM/rede do container; ver Fase 5).
- [x] Sub-aba **Zona de perigo** (excluir com confirmação).
- [ ] **Preview deployments**: PR do GitHub vira ambiente efêmero com URL própria, comenta no PR, morre ao fechar.
- [ ] **Scheduled tasks**: comando arbitrário dentro do container num cron, com **histórico de execuções** (status, log, duração).
- [ ] Persistent storage: checkbox "sufixo para PR deployments" (isola volumes de preview) e tipos de volume/arquivo/diretório além do volume nomeado.
- [x] Botão **Gerar domínio** (sugere `<slug>.<wildcard do servidor>`) na aba de domínio das aplicações; serviços ainda não.
- [ ] **Múltiplos domínios** por aplicação + redirect www/não-www.
- [ ] **Tags** em recursos (criar, atribuir, filtrar na listagem).
- [ ] Timeout de conexão SSH configurável por servidor.

**Variáveis de ambiente**
- [ ] **Shared Variables** por escopo (time / projeto / ambiente) com referência `{{project.NODE_ENV}}`.
- [ ] Distinção **build-time vs runtime** por variável.
- [ ] Editor de env em modo texto (`.env` colado) além de linha a linha.

## Fase 4 — Bancos, serviços e microsserviços

**Serviços / stacks**
- [ ] Serviço = **stack Docker Compose** de vários containers como um recurso (hoje o catálogo é de container único).
- [ ] **Serviço customizado**: colar o próprio `docker-compose.yml`.
- [ ] Ampliar o catálogo one-click (hoje 10; Coolify tem 300+): estrutura de template em arquivo (compose + metadados + ícone), carregada de `templates/`, sem hardcode por serviço.
- [ ] Catálogo com **busca, categorias e ícones** (usa o mesmo componente da Fase 1).
- [ ] Rede interna entre recursos do mesmo ambiente (**Destinations** = redes Docker): apps falam com bancos/serviços por nome interno.
- [ ] Domínio por container dentro de uma stack compose.
- [ ] Guia/modelo de **microsserviços**: várias apps + banco + fila no mesmo ambiente com rede compartilhada e variáveis compartilhadas.

**Bancos**
- [ ] Engines novos: **Dragonfly**, **KeyDB**, **ClickHouse**.
- [ ] Escolha de **versão da imagem** na criação (Postgres pergunta versão antes de criar).
- [ ] **SSL** por engine e **acesso externo** configurável (publicar porta + credenciais).
- [ ] URL de conexão interna e externa exibida e copiável.
- [ ] Healthcheck configurável.

**Backup**
- [ ] **Restore / Import Backup**: restaurar a partir de um backup existente ou de arquivo enviado (hoje não existe nenhuma rota de restore).
- [ ] **Databases To Include** em instâncias multi-database.
- [ ] Botões de manutenção: limpar backups com falha, limpar deletados, apagar backups + agendamento.
- [ ] Compressão paralela (gzip multi-core).
- [ ] **Backup de volume/storage persistente** de aplicações e serviços (não só banco).
- [ ] Aviso explícito na UI: "volume persistente não é backup".

## Fase 5 — Servidores e infraestrutura

- [ ] Aba **Proxy** do servidor (status, logs, reiniciar, config do Traefik) com alerta quando não está rodando.
- [ ] **Docker Cleanup** agendado (`docker system prune`) via BullMQ + SSH.
- [ ] **Keys & Tokens**: tela de gerenciamento de chaves SSH (criar, importar, reutilizar entre servidores/fontes), separada do formulário do servidor.
- [ ] **Log Drains**: encaminhar logs pra Loki / Axiom / New Relic / Fluent Bit.
- [ ] **CA Certificate** por servidor (registry/proxy com certificado interno).
- [x] Excluir servidor com checagem de recursos vinculados (feito na Fase 2 — remove só do painel; a lista de recursos bloqueia a remoção).
- [ ] Servidor de **Build** separado do de **Deploy** (Dokploy): job de build roda numa máquina, imagem vai pra registry, servidor de deploy puxa.
- [ ] Métricas **por container** via `docker stats --no-stream` no job SSH que já existe (sem instalar agente — não copiar o "Sentinel" do Coolify).
- [ ] **Série temporal de métricas** (hoje só o snapshot mais recente) + gráfico das últimas 24h/7d, incluindo o gráfico no Dashboard.
- [ ] Analytics de tráfego por aplicação (baixa prioridade).
- [ ] **Cloudflare Tunnel** por servidor/recurso: modos wildcard para todos os recursos, recurso único, SSH pelo túnel, HTTPS até o painel (compartilha peça com a Fase 2).
- [ ] Tailscale como forma alternativa de acesso (Dokploy documenta).
- [ ] Logs estruturados (JSON) de `api`/`worker`/`ws` com nível e correlação por request/job id + retenção configurável de logs de deploy/backup.

## Fase 6 — Arquitetura de execução (avaliar antes de fazer)

Invisível pro usuário final, mas reduz risco de bug de longo prazo. Cada item começa por um spike/avaliação.

- [ ] **Avaliar `dockerode` sobre túnel SSH** (Docker Engine API real) no lugar de `shellQuote` + string de comando + parse de stdout — confirmar compatibilidade com o runtime Bun antes de qualquer reescrita.
- [ ] Se aprovado: migrar job por job (`*.commands.ts` → chamadas tipadas), mantendo testes.
- [ ] **Avaliar Swarm de nó único por servidor** (`docker swarm init` sem `join`) pra subir apps como `docker service` e ganhar rolling update + healthcheck nativos.
- [ ] **Traefik File Provider** pra mudar domínio/SSL de apps Dockerfile **sem redeploy** (Compose continua com labels).
- [ ] Confirmar se hoje trocar domínio exige redeploy; se sim, corrigir.

## Fase 7 — API, CLI e automação

- [ ] **Tokens de API pessoais** com escopo (time + permissões), criados em Keys & Tokens.
- [ ] Expiração de token com aviso antecipado.
- [ ] API REST versionada (`/api/v1`) cobrindo aplicações, bancos, serviços, servidores, deploys, projetos, notificações, storages, tarefas agendadas.
- [ ] Documentação OpenAPI + **Swagger UI ao vivo** (`/swagger`).
- [ ] Allowlist de IP e rate limit documentado (headers + retry) na API.
- [ ] **CLI oficial** (`yeah`): cliente fino sobre a API, contexto = URL + token; deploy, criar/listar recursos, backup — pensado pra CI/CD.
- [ ] **Servidor MCP** (`/mcp`, HTTP) com Tools, Resources (read-only) e Prompts (ex.: "debugar esse deploy"), modo read-only opcional, sem contornar escopo/redação de segredos.
- [ ] Mover recurso entre ambientes via API.
- [ ] Toggle "MCP server" nas configurações do time.

## Fase 8 — Polimento, documentação e extras

- [ ] **i18n** PT/EN: `vue-i18n`, `pt.json` + `en.json`, seletor de idioma junto do tema; migrar página por página.
- [ ] Doc **"Escalar app Node/Bun em múltiplos cores"**: `pm2-runtime -i max` (Node) e `reusePort: true` + um processo por core (Bun/Deno); avisar que sessão/cache/rate-limit vão pro Redis.
- [ ] Doc de **troubleshooting** (502/503/504, OOM em build, firewall, Let's Encrypt, token GitHub expirado).
- [ ] **2FA** pra conta única do admin.
- [ ] Ícone customizado por projeto.
- [ ] **Criar VPS de dentro do painel** (Hetzner / Vultr / DigitalOcean via API do provedor, incluindo firewall).
- [ ] Encaminhar notificações também por outros canais conforme demanda.

---

## Salvo do roadmap anterior (ainda não desenvolvido)

Itens que estavam pendentes no `ROADMAP.md` antigo, salvos antes da reescrita. Os que já estão nas fases acima aparecem com a referência; os marcados **(só aqui)** não cabem em nenhuma fase acima.

**Navegação / layout**
- [ ] Sub-navegação de Configuração: Advanced, Git Source, Servers, Scheduled Tasks, Webhooks, Preview Deployments, Resource Operations, Healthcheck, Analytics → Fase 3.
- [ ] Página do GitHub reestruturada no estilo "Sources" do Coolify → Fase 1.
- [ ] Modo tabela em `EnvironmentPage.vue` e fluxo "1 clique cria" pra banco/serviço → Fase 1.
- [ ] Gráfico histórico de métricas no dashboard e widget de traffic analytics → Fases 1 e 5.
- [ ] Componentes compartilhados de variáveis de ambiente e tags → Fase 3.

**Fases já abertas**
- [ ] Build packs além de Dockerfile (Nixpacks, estático, Docker Compose) → Fase 3.
- [ ] Preview deployments → Fase 3.
- [ ] Scheduled tasks com histórico de execuções → Fase 3.

**Paridade com Coolify**
- [ ] Registry privado com push automático → Fase 3.
- [ ] `[skip ci]` / `[skip cd]` → Fase 3.
- [ ] Tela de mudanças pendentes → Fase 3.
- [ ] Grace period de parada → Fase 3.
- [ ] Timeout SSH configurável por servidor → Fase 3.
- [ ] Terminal web interativo → Fase 3.
- [ ] Variáveis compartilhadas por escopo e build-time vs runtime → Fase 3.
- [ ] Backup de volume/storage persistente e compressão paralela → Fase 4.
- [ ] Healthcheck configurável → Fase 3.
- [ ] Métricas por container, sink externo de logs, gráfico histórico, analytics de tráfego → Fase 5.
- [ ] Limpeza automática de Docker e CA Certificate por servidor → Fase 5.
- [ ] Cloudflare Tunnels → Fases 2 e 5.
- [ ] CLI oficial, servidor MCP, expiração de token, mover recurso entre ambientes, rate limit documentado → Fase 7.
- [ ] Criar VPS pelo painel → Fase 8.
- [ ] Engines Dragonfly / KeyDB / ClickHouse → Fase 4.
- [ ] Guia de escalonamento multi-core Node/Bun → Fase 8.
- [ ] Tags em recursos, ícone por projeto, 2FA → Fases 3 e 8.
- [ ] Templates docker-compose multi-container (catálogo de 10 → 300+) → Fase 4.

**Paridade com Dokploy**
- [ ] Modo só-painel, `dockerode` sobre SSH, servidor de build separado, Swarm de nó único, Traefik File Provider, Swagger UI, segredos criptografados → Fases 0, 2, 5, 6, 7.

**Robustez**
- [ ] Prioridade/degradação ativa (checar métricas antes de enfileirar) → Fase 0.
- [ ] Logs estruturados, retenção, `docker logs` ao vivo → Fases 3 e 5.
- [ ] Circuit breaker no worker → Fase 0.
- [ ] Histórico de métricas (série temporal) → Fase 5.

**Segurança**
- [ ] Criptografar `servers.private_key` e `databases.password` → Fase 0.
- [ ] Assinar/expirar `state` do OAuth do GitHub App → Fase 0.
- [ ] Rate limiting na API → Fase 0.

**Só aqui (sem fase própria)**
- [ ] **(só aqui)** Internacionalização PT/EN — detalhada na Fase 8; mantida aqui porque foi pedido explicitamente pelo usuário e é o item mais antigo da lista.
- [ ] **(só aqui)** Deliberadamente **sem** paridade, por decisão de produto: multiusuário, OIDC/SSO e hospedar terceiros no servidor — o `yeah` é single-admin de propósito (ver `docs/ARCHITECTURE.md`). Não é pendência, fica registrado pra ninguém abrir issue achando que é lacuna.

PRs e issues são bem-vindos pra qualquer item daqui — ver `CONTRIBUTING.md`.
