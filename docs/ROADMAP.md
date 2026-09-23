# Roadmap

Estado real do projeto — o que já funciona (testado de ponta a ponta, ver `docs/DEVLOG.md`) e o que falta, incluindo paridade com o Coolify e o Dokploy (as duas referências diretas do usuário pra essa fase) e itens de robustez que todo PaaS de produção precisa.

**2026-09**: pesquisa grande nova nessa revisão — documentação oficial do Coolify e do Dokploy, código-fonte de ambos clonado localmente (`./coolify`, `./dokploy`, os dois gitignored, não vão pro repo público), e uma revisita à instância real de produção do usuário rodando Coolify. Notas cruas ficam em `docs/coolify-research.md` e `docs/dokploy-research.md` (gitignored — contêm nome de instância/projeto real); aqui só entra a versão sanitizada e acionável.

## 🏗️ Arquitetura: rodar o painel separado do servidor gerenciado

Pedido explícito do usuário: poder instalar o `yeah` num ambiente local ou servidor barato à parte, sem gastar recurso da VPS de produção só pra rodar o painel — e quando abrir o painel, ele já conecta na VPS remotamente pra gerenciar ela.

**Isso já é o modelo de arquitetura que Coolify e Dokploy usam de verdade, e o `yeah` já tá 90% lá sem saber**:
- O `yeah` já é 100% agentless-via-SSH — o `worker` é o único processo que fala SSH, e ele já trata "servidor onde o container de app vai rodar" como algo sempre remoto, nunca assume acesso a um socket Docker local. Isso é confirmado olhando `apps/worker/src/jobs/*.ts` — todo comando (deploy, provisionamento, backup, métrica) já vai por `ssh2` contra host/porta/chave de um `Server` do banco, mesmo quando esse `Server` é o "Servidor local" que o `install.sh` registra automaticamente.
- `apps/api/src/lib/localhostServer.ts` **já é condicional**: só cria o "Servidor local" (`isPlatformHost: true`) se `LOCALHOST_SSH_PRIVATE_KEY_BASE64` estiver setado no ambiente. Sem essa env var, nada acontece — o painel sobe sem nenhum servidor de deploy próprio, exatamente o estado inicial que esse pedido precisa.
- **A lacuna real é só o `install.sh`**: hoje ele **sempre** gera a chave SSH e escreve as três env vars (`LOCALHOST_SSH_*`), então o host onde `install.sh` roda vira automaticamente um alvo de deploy — não tem flag pra pular isso. Confirmado também que Coolify (v4, hoje em produção) faz exatamente a mesma coisa por padrão: `scripts/install.sh` gera chave e registra o `host.docker.internal` como servidor `id=0` fixo/irremovível (`app/Models/Server.php`, `isLocalhost()`) — ou seja, nem o Coolify real tem um "modo controle-only" de primeira classe, só dá pra simplesmente nunca fazer deploy nesse servidor `id=0`, sem apagar ele. **Dokploy já vai além**: os docs oficiais documentam de verdade um modo "UI only" — instalação separada dos servidores gerenciados, ~250MB de RAM só pra rodar o painel — como um modo suportado, não um hack.

**Plano concreto**:
1. `install.sh` ganha um modo (`--control-plane-only` ou pergunta interativa "vai gerenciar só servidores remotos?") que pula o `ssh-keygen` + as três env vars `LOCALHOST_SSH_*` — painel sobe limpo, primeiro servidor é adicionado manualmente pela UI (fluxo que já existe, `ServersPage.vue`).
2. Documentar esse modo no `README.md`/`docs/ARCHITECTURE.md`: rodar `docker-compose.prod.yml` numa máquina qualquer com saída de rede (PC de casa, VPS de $4/mês, Raspberry Pi) e adicionar a VPS de produção real como servidor remoto via SSH — sem nenhuma mudança de código, só de topologia de instalação.
3. **Sem problema de NAT/firewall a resolver** (diferente do que o próprio Coolify precisou resolver pra v5 — ver nota abaixo): a conexão sempre parte do painel *pra* a VPS gerenciada, e essa VPS quase sempre tem IP público + porta SSH aberta (é uma VPS de produção). O painel só precisa de saída de rede, que qualquer máquina com internet já tem.
4. **Achado da arqueologia de código do Coolify, vale registrar por completude**: o time do Coolify tá numa reescrita v5 (`docs/v5/architecture/adr/` no repo deles) que separa o controle em 3 peças — control plane (Laravel), um broker (**Flux**) e um agente leve por host (**coold**) que disca *pra fora* via gRPC. O motivo declarado (ADR 0001) é gerenciar hosts **atrás de NAT/firewall restritivo**, sem IP público — problema que exige inverter a direção da conexão (o host chama o painel, não o contrário), o que por sua vez exige instalar um agente por host. **Isso não é o nosso caso**: a gente quer o contrário (painel remoto → VPS com IP público), que já funciona com SSH normal, sem precisar copiar esse modelo de agente. Only atentar: se um dia quisermos suportar gerenciar um servidor **sem** IP público (ex. um Raspberry Pi atrás de CGNAT), aí sim esse problema vira real e a solução do Coolify v5 vira referência.
5. **Cloudflare Tunnel pro painel em si** (não só pros apps deployados — ver também na seção de paridade com Coolify abaixo): se o painel roda numa máquina de casa sem IP público/fixo, dá pra expor ele via túnel Cloudflare em vez de abrir porta — resolve o "como eu acesso meu painel de qualquer lugar" sem VPN nem port-forward. Faz sentido implementar o suporte a Cloudflare Tunnel pensando nos dois casos ao mesmo tempo (expor um app deployado E expor o painel), é a mesma peça de infraestrutura.

## ⚙️ Camada de execução: Docker Engine API real via túnel SSH (avaliar)

Achado da arqueologia de código do Dokploy, relevante o bastante pra virar item de arquitetura próprio: hoje o `yeah` (igual o Coolify) constrói **comandos shell como string** (`shellQuote` em todo `apps/worker/src/jobs/*.commands.ts`) e roda via `exec` sobre a conexão SSH, parseando stdout pra saber o resultado. O Dokploy faz diferente: pra qualquer servidor com chave SSH configurada, ele abre a lib `dockerode` (cliente real da Docker Engine API) com `protocol: "ssh"` — ou seja, **túnela a API REST de verdade do Docker por cima do mesmo SSH**, em vez de gerar string de comando. Ganhos: zero risco de escaping de shell errado, respostas JSON tipadas em vez de parsear texto de stdout, streaming nativo de log/exec sem reimplementar isso na mão.

Não é uma troca trivial (precisa confirmar que `dockerode` funciona 100% sob o runtime do Bun, e é uma reescrita de fundo de todo `apps/worker/src/jobs/*.commands.ts`) — entra como item de avaliação técnica antes de virar trabalho, não como troca imediata. Prioridade: depois de fechar a reformulação de layout e as lacunas de feature mais visíveis, porque é invisível pro usuário final apesar de ser uma melhoria estrutural real.

Achado relacionado, também do Dokploy: pra ganhar rolling-update e healthcheck nativos sem reescrever do zero, o Dokploy inicializa um **Docker Swarm de nó único** em cada servidor gerenciado (`docker swarm init`, sem `swarm join`/join-tokens — não é clustering real entre servidores, só ativa as primitivas de `docker service`) e sobe os containers como Swarm services em vez de `docker run` puro. Vale considerar o mesmo truque pro `yeah`: continua um servidor = uma unidade independente (sem cluster de verdade), mas ganha `UpdateConfig`/rolling update e healthcheck nativos da própria Docker API. Menor escopo que trocar pra `dockerode`, pode vir antes.

## 🖥️ Reformulação de layout — mobile-first, escalável, consistente

O usuário foi claro: cor/ícone/CSS já tá bom, **o problema é o layout em si** — confuso, não escala bem, e precisa funcionar em qualquer tamanho de tela, com foco em suportar bem cenário de microsserviços (times com dezenas de recursos, não só 2-3 de teste).

Comparando com o Coolify real (revisita à instância de produção, ver `docs/coolify-research.md` seção 6) e o Dokploy, a diferença não é estética — é **densidade de informação e escalabilidade**:

- **Grade de cards não escala.** O `yeah` hoje só tem um modo de exibição (grade de cards) pra tudo: recursos de um ambiente, projetos, servidores. Funciona bem com 2-3 itens, fica ruim rápido com 15+. O Coolify sempre oferece as duas opções — grade E **tabela** (Resource | Type | Status | Domain | Server | Tags, com busca/filtro/ordenação e paginação) — com tabela como padrão pra listagens que crescem. **Ação**: criar um componente `ResourceTable.vue` reaproveitável (colunas: ícone+nome, tipo, status, domínio, servidor, tags) e um toggle lista/grade persistido por usuário (`localStorage`, mesmo padrão simples já usado pro tema), aplicado em `EnvironmentPage.vue`, `ProjectsPage.vue` e `ServersPage.vue`.
- **Coluna de domínio ausente.** Hoje pra saber a URL de uma aplicação é preciso entrar nela. O modo tabela do Coolify mostra isso na própria listagem — alto valor, baixo custo (já temos o dado, só falta expor).
- **Mobile ainda não foi pensado como cenário de primeira classe.** Sidebar fixa + grade de N colunas não testado em telas estreitas. **Ação**: sidebar vira drawer/gaveta recolhível abaixo de um breakpoint (padrão comum: <768px), topbar ganha botão de menu hambúrguer, tabelas viram cards empilhados ou scroll horizontal controlado (nunca overflow da página inteira), formulários em coluna única. Testar cada tela reformulada em pelo menos 3 larguras (≈390px celular, ≈768px tablet, desktop) antes de considerar pronta — igual já é prática pra Artifacts, vale adotar aqui também.
- **Shell de página inconsistente entre tipos de recurso.** `ApplicationLayout.vue`/`DatabaseLayout.vue`/`ServiceLayout.vue` já compartilham o padrão de rota filha (bom, já documentado na seção de navegação abaixo), mas cada um ainda define seu próprio header/subnav do zero. **Ação**: extrair um `ResourceDetailShell.vue` (ou similar) que os três reaproveitam — título, status, breadcrumb, subnav de abas — pra qualquer mudança de layout futura (ex. adicionar uma aba nova) acontecer num lugar só.
- **Sem estado vazio/densidade pensada pra "muitos recursos".** Telas hoje assumem implicitamente poucos itens (cards grandes, bastante espaço em branco). Cenário de microsserviços real é dezenas de aplicações pequenas relacionadas — o modo tabela acima já ajuda, mas cabe também: busca com foco por atalho de teclado (Coolify usa `/`), filtro por tipo/status/servidor/tag na mesma barra.

**Como isso vai ser executado**: é um trabalho grande, tela por tela — não dá pra fazer tudo de uma vez sem quebrar o que já funciona. Ordem sugerida: (1) componente de tabela reaproveitável + toggle, aplicado primeiro em `EnvironmentPage.vue` (a tela mais citada como problema); (2) breakpoints mobile na sidebar/topbar (afeta toda tela de uma vez, alto impacto); (3) `ResourceDetailShell.vue` compartilhado; (4) replicar tabela em `ProjectsPage.vue`/`ServersPage.vue`; (5) revisar formulários (criação de recurso, configurações) em coluna única mobile. Cada etapa testada de ponta a ponta e reportada antes da próxima, igual o resto do projeto.

## 🧭 Reestruturação de navegação — em andamento

O usuário apontou (2026-09) que a estrutura de telas do `yeah` tá confusa e pediu pra puxar mais pro estilo Coolify/Vercel/Render em vez do design atual. Levantamento no código-fonte real do Coolify confirmou o porquê: cada sub-seção de configuração de recurso lá é uma **rota própria** (`/application/{id}/domains`, `.../advanced`, `.../environment-variables`, `.../persistent-storage`, `.../source`, `.../servers`, `.../scheduled-tasks`, `.../webhooks`, `.../preview-deployments`, `.../healthcheck`, `.../rollback`, `.../resource-limits`, `.../resource-operations`, `.../metrics`, `.../analytics`, `.../tags`, `.../danger`, mais `.../deployment`, `.../logs`, `.../terminal`) — bookmarkável, compartilhável, funciona com voltar/avançar do navegador.

Plano de reestruturação:
- **✅ Feito**: trocado o padrão `activeTab` (refs locais com `v-if`) por **rotas filhas de verdade no Vue Router** em Application (`/apps/:id/deployments|general|env|storage`), Database (`/databases/:id/backups|general`) e Service (`/services/:id/general|env`), cada um com layout compartilhado (`*Layout.vue`) + `provide`/`inject` (`use*Context`).
- **✅ Feito**: dashboard inicial no estilo "Root Team" do Coolify — cards de contagem, deploys recentes cross-projeto, grade de "Projetos", grade de "Servidores" com status ao vivo. Trocar/criar time saiu do corpo do dashboard, virou dropdown no topbar (`TeamSwitcher.vue`).
- **✅ Feito**: componentes de configuração compartilhados entre Application/Database/Service (`DomainCard.vue`, `ResourceLimitsCard.vue`).
- **✅ Feito**: sidebar reorganizada em seções (Infraestrutura / Integrações / Sistema).
- **✅ Feito**: `EnvironmentPage.vue` unificada — grade única mista em vez de três grades + três formulários sempre visíveis; criação virou fluxo dedicado (`ResourceNewPage.vue`). **Próximo passo direto**: aplicar o modo tabela da seção de layout acima nessa mesma tela, e trocar o fluxo de criação de banco/serviço pra "1 clique = cria com padrão" em vez de formulário completo, igual o Coolify faz (ver `docs/coolify-research.md` seção 6).
- **✅ Feito**: tema escuro como padrão, paleta escura recalibrada em camadas.
- Sub-navegação de Configuração ganhando os itens reais conforme cada feature for implementada: Persistent Storage ✅, Rollback ✅, faltam Advanced, Git Source, Servers, Scheduled Tasks, Webhooks, Preview Deployments, Resource Operations, Healthcheck, Analytics.
- **Ainda falta**: página do GitHub (`GithubPage.vue`) reestruturada no estilo "Sources" do Coolify — ver detalhe de layout dessa tela específica em `docs/coolify-research.md` seção 1 (como ele organiza App Name/Organization/System Wide/chaves/permissões/aba de recursos vinculados).

## 🌐 Internacionalização (i18n)

Pedido explícito do usuário. Coolify tem isso de verdade — 20 idiomas em `lang/*.json`. Pra aplicar no `yeah`:
- `vue-i18n` (ou equivalente leve) com `pt.json` como idioma padrão atual + `en.json` traduzido.
- Seletor de idioma na página de conta/configurações (mesmo lugar do tema claro/escuro).
- Trabalho grande de superfície — fazer incrementalmente por página.

## ✅ Já funciona

- Auth por sessão — single-admin de propósito (`/register` só funciona uma vez)
- Servidores via SSH (agentless, igual Coolify e Dokploy) — o host de instalação já entra automaticamente como primeiro servidor quando configurado (ver seção de arquitetura acima pro plano de tornar isso opcional)
- `Project → Environment → Application | Database | Service`, igual Coolify, com breadcrumb clicável
- Deploy de aplicações (só `Dockerfile` por enquanto) com log ao vivo
- GitHub App: conectar conta, escolher repo numa lista, auto-deploy em push
- 5 motores de banco (Postgres, MySQL, MariaDB, Redis, MongoDB) com provisionamento e backup
- Catálogo de serviços um-clique: Uptime Kuma, n8n, MinIO, RabbitMQ, Meilisearch, Ghost, Metabase, Portainer, Adminer, Redis Commander — qualquer imagem pública, além dos motores de banco
- Backup agendado (cron) com 3 regras de retenção, local ou S3-compatível
- Proxy reverso por servidor (Traefik) com domínio wildcard e HTTPS automático (Let's Encrypt)
- Exclusão de recursos com limpeza remota (container, volume, agendamento no BullMQ)
- Monitoramento de recursos por servidor: CPU/RAM/disco via SSH a cada 60s (sem agente)
- Notificações: Discord, Slack, Telegram, Email (SMTP), webhook genérico — com filtro por tipo de evento
- Tela de atualizações com botões reais: atualizar plataforma, atualizar sistema operacional, atualizar imagem por recurso (ou tudo de uma vez)
- Limites de recurso por container (`--memory`/`--cpus`) configuráveis
- Alerta de certificado TLS perto de expirar (checagem diária)
- Suíte de testes unitários (`bun test`, zero dependência extra) cobrindo lógica pura crítica
- Armazenamento persistente para aplicações (volumes nomeados)
- Rollback: cada deploy grava o commit real, botão pra fixar deploy novo nele
- Editor Monaco, terminal xterm.js, tema claro/escuro

## 🚧 Falta pra fechar as fases já abertas

- **Build packs além de Dockerfile**: Nixpacks (Coolify também tem **Railpack** como alternativa mais nova, detecta linguagem e builda sem Dockerfile), estático (só arquivos, serve via nginx), Docker Compose (multi-container por aplicação)
- **Preview deployments**: cada PR do GitHub vira um ambiente efêmero, com URL própria, que morre quando o PR fecha
- **Scheduled tasks**: rodar comandos arbitrários dentro do container, num cron, com **histórico de execuções** (status/log/duração de cada rodada, não só o agendamento em si)

## 🎯 Paridade com Coolify — o que ele tem e a gente não

Coolify é Laravel 12 + Livewire + Alpine.js monolítico (PHP-FPM renderizando o dashboard no servidor, Soketi como WebSocket) — mais pesado que Bun+Vue por natureza, então parte do "menos consumo" já vem de graça da nossa arquitetura.

**Build e deploy:**
- **Registry Docker privado com push automático**: builda uma vez, tagueia com o SHA do commit, empurra pro registry — reusa a imagem em vez de rebuildar toda vez que reinicia. O Dokploy vai além com um papel de servidor dedicado só pra build (ver seção de paridade com Dokploy).
- **`[skip ci]`/`[skip cd]` na mensagem de commit**: pula o auto-deploy daquele push.
- **Tela de "mudanças pendentes"**: aviso com contagem de quantos campos mudaram desde o último deploy, antes de aplicar.
- **Grace period configurável de parada**: tempo de esperar um container terminar de responder antes de matar num redeploy.
- **Timeout de conexão SSH configurável por servidor**.
- **Terminal web interativo de verdade**: abrir shell interativo dentro de qualquer container rodando ou do próprio servidor, direto do navegador — hoje o `yeah` só tem xterm.js pra log de deploy, não um shell de verdade.

**Variáveis de ambiente:**
- **Variáveis compartilhadas por escopo** (time/projeto/ambiente) com referência (`{{project.NODE_ENV}}`) em vez de copiar valor em cada recurso.
- **Distinção build-time vs runtime**: variável só usada no build não precisa vazar pro container rodando.

**Backup:**
- **Backup de volume/storage persistente, não só de banco** — Coolify agenda backup do volume de dados de qualquer aplicação/serviço, não só `Database`.
- **Compressão paralela** no backup (gzip multi-core).

**Healthcheck configurável**: path HTTP, intervalo, retries, timeout por recurso — hoje o `yeah` só depende de `--restart unless-stopped`.

**Observabilidade:**
- Métricas **por container** (não só por servidor inteiro) — dá pra conseguir via `docker stats --no-stream` no mesmo job SSH que já lê `/proc`, sem instalar agente (Coolify usa um agente próprio, "Sentinel" — **não copiar esse modelo**, contradiz o pitch agentless).
- Encaminhar logs pra sink externo (Loki, Axiom, Fluent Bit) — baixa prioridade.
- Gráfico histórico de métricas com visual dedicado (depende de série temporal, ver seção Robustez).
- Analytics de tráfego por aplicação, separado de CPU/RAM/disco — baixa prioridade.

**Manutenção de servidor:**
- Limpeza automática de Docker agendada (`docker system prune` periódico via SSH+cron).
- CA Certificate por servidor (registry/proxy com certificado interno) — baixa prioridade.

**Rede — Cloudflare Tunnels**: expõe app (ou o próprio painel) sem IP público nem porta aberta — `cloudflared` no servidor túnela pra borda da Cloudflare. Modos: domínio wildcard pra todos os recursos, recurso único, SSH pelo túnel, ou HTTPS completo até o próprio painel. **Direta conexão com o pedido de rodar o painel fora da VPS** (ver seção de arquitetura acima) — pensar as duas coisas juntas.

**API e automação:**
- **CLI oficial**: cliente fino sobre a API REST, gerencia instância remota (deploy, criar app/banco/serviço, backup) — não é ferramenta de dev local. Bom pra CI/CD.
- **Servidor MCP** (`/mcp`, HTTP simples): expõe Tools (ações), Resources (dados read-only) e Prompts (workflows guiados tipo "debugar esse deploy que falhou") pra agente de IA operar via token de API — sem contornar permissão/escopo normal. Faz sentido pensar num `yeah` MCP mais pra frente, a API já existe.
- **Expiração de token de API com aviso antecipado**, em vez de token eterno.
- **Mover recurso entre ambientes via API** sem recriar do zero.
- Rate limit documentado (headers + retry) na própria API.

**Provisionamento de servidor:**
- **Criar VPS direto de dentro do painel** (Hetzner/Vultr/DigitalOcean via API do provedor) — feature grande, provavelmente não antes de fechar o básico, mas é a diferença mais visível pra quem nunca mexeu com VPS.

**Bancos de dados**: engines que o Coolify tem e a gente não — **Dragonfly, KeyDB, ClickHouse** (além de Postgres/MySQL/MariaDB/Redis/MongoDB que já temos). Documenta explicitamente que não faz clustering/replicação automática nem failover — mesma limitação nossa, não é lacuna.

**Guia de escalonamento multi-core pra Node.js** (knowledge base): conselho prático pra apps Node num container single-process — `pm2-runtime -i max` (cluster mode) ou, pra Bun/Deno, `reusePort: true` com um processo por core deixando o kernel balancear via `SO_REUSEPORT` (com o aviso de que sessão/cache/rate-limit precisam ir pro Redis já que workers não compartilham memória). O `yeah` não documenta nada disso hoje pros apps que hospeda, e sendo Bun-based a gente é a plataforma certa pra documentar o padrão `reusePort` — baixo custo, alto valor (um doc, não uma feature).

**UX menor, mas real:**
- Tags em recursos pra filtrar/organizar a listagem (também citado na seção de layout acima).
- Ícone customizado por projeto no card do dashboard.
- 2FA — como o `yeah` é single-admin, protege a única conta que existe, não é feature multi-usuário.

**Templates docker-compose multi-container**: Coolify tem 300+ templates um-clique (catálogo nosso tem 10) — diferença de escala grande, mas builda em cima do mesmo padrão que já temos.

**Deliberadamente sem paridade** (decisão de produto): Coolify permite multi-usuário/OIDC/SSO por time. O `yeah` não vai ter nada disso — single-admin de propósito.

## 🆚 Paridade com Dokploy — segunda referência

Dokploy (Next.js + tRPC + Drizzle + Postgres, `dockerode`+`ssh2` pro transporte remoto) tem posicionamento parecido com o Coolify mas com diferenciais próprios reais (achados completos em `docs/dokploy-research.md`):

- **Modo "só painel" suportado oficialmente** — já citado na seção de arquitetura, é o pedido central do usuário e o Dokploy documenta ele como modo de primeira classe (~250MB RAM), não hack.
- **Docker Engine API real por túnel SSH** em vez de comando shell string — já citado como item de avaliação de arquitetura acima.
- **Servidor de Build separado do servidor de Deploy** — desacopla carga de build de compilação da máquina que serve tráfego de produção. Complementa bem nosso item de "registry privado com push automático" já no roadmap.
- **Rolling update + healthcheck nativos via Swarm de nó único por servidor** — já citado como item de avaliação de arquitetura.
- **Segredos criptografados em repouso (AES-256-GCM, envelope versionado)** — implementação de referência concreta pro nosso próprio `TODO(security)` em `packages/db/src/schema/servers.ts` (ver seção de Segurança abaixo).
- **API com Swagger UI ao vivo em `/swagger`** — mais fácil de explorar/testar que documentação estática. Vale considerar quando a nossa API crescer o suficiente pra justificar.
- Traefik com File Provider pra apps Dockerfile — muda domínio/SSL **sem redeploy** (apps Compose ainda precisam redeploy, por serem baseados em label). Hoje o `yeah` não documenta se muda domínio sem redeploy — checar e, se não, é uma melhoria barata.
- Backup só documentado pra instância em si (disaster recovery), não por banco de usuário — **nossa suíte de backup já é mais completa nessa frente**, não é lacuna nossa.

## 🛡️ Robustez, monitoramento e alertas

O que já saiu está em "✅ Já funciona" acima. Falta:

- **Sistema de prioridade/degradação mais ativo**: monitoramento hoje só *avisa* quando CPU/RAM/disco passa do limiar, não *impede* uma ação nova — falta checar o último snapshot antes de enfileirar e barrar/avisar se o servidor já tá no limite.
- **Logs mais robustos**: logs estruturados (JSON) dos próprios serviços (`api`/`worker`/`ws`) com nível e correlação por request/job id, retenção configurável, e ver `docker logs` ao vivo da aplicação rodando (não só do build).
- **Circuit breaker no worker** pra jobs que falham repetidamente não ficarem re-tentando pra sempre.
- **Histórico de métricas**: hoje só guarda o snapshot mais recente por servidor, sem série temporal — sem gráfico de "CPU nas últimas 24h".

## 🔒 Segurança pré-produção

- **Criptografar `servers.private_key` e `databases.password` em repouso** (hoje texto puro, ver `TODO(security)` em `packages/db/src/schema/servers.ts`) — o Dokploy tem uma implementação de referência direta e portável pra isso: envelope AES-256-GCM, chave derivada via HMAC-SHA256 de uma `ENCRYPTION_KEY` dedicada, prefixo versionado (`enc:v1:`) e suporte a múltiplas chaves pra rotação — dá pra seguir esse desenho quase 1:1 em vez de inventar um novo (ver `docs/dokploy-research.md` achado #2 pro detalhe do arquivo fonte). Achado interessante à parte: nem o Coolify criptografa tudo — o `client_secret`/`webhook_secret` do GitHub App dele ficam em texto puro (só a chave privada RSA, guardada numa tabela compartilhada de chaves, é criptografada) — ou seja, mesmo a referência que estamos seguindo tem esse ponto fraco; vale a gente fazer melhor, não replicar a mesma lacuna.
- Assinar/expirar o `state` do fluxo OAuth do GitHub App (hoje é o `teamId` puro).
- Rate limiting na API (login, criação de recursos).

## Como isso é priorizado

Sem sprint formal — os itens vão sendo puxados na ordem que faz mais sentido tecnicamente (estrutural antes de superficial, o que desbloqueia outra coisa antes do que é só nice-to-have). Ordem sugerida a partir dessa revisão: (1) reformulação de layout — é o que o usuário sinalizou como mais urgente e afeta toda tela existente; (2) modo de instalação "só painel" — desbloqueia o caso de uso que o usuário quer testar; (3) fechar as lacunas de feature mais visíveis de paridade (backup de volume, healthcheck, terminal interativo); (4) itens de arquitetura mais profundos (Docker Engine API real, Swarm de nó único) — de maior risco/esforço, menor visibilidade imediata. PRs e issues são bem-vindos pra qualquer item daqui — ver `CONTRIBUTING.md`.
