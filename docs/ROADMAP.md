# Roadmap

Estado real do projeto — o que já funciona (testado de ponta a ponta, ver `docs/DEVLOG.md`) e o que falta, incluindo paridade com o Coolify e itens de robustez que todo PaaS de produção precisa.

## ✅ Já funciona

- Auth por sessão — **single-admin de propósito**: `/register` só funciona uma vez (primeira conta da instância), sem convite nem forma de uma segunda pessoa ganhar login. Times/papéis (`owner`/`admin`/`member`) continuam existindo como o jeito de todo recurso ser organizado, mas hoje sempre tem um usuário só
- Servidores via SSH (agentless, igual Coolify) — a própria máquina onde o `yeah` roda já entra automaticamente como o primeiro servidor (chave SSH gerada e autorizada pelo `install.sh`), igual o "localhost" do Coolify
- `Project → Environment → Application | Database | Service`, igual Coolify — com breadcrumb clicável ("Projeto › ambiente › Recurso") no topo de toda página de ambiente/recurso, igual o Coolify mostra
- Deploy de aplicações (só `Dockerfile` por enquanto) com log ao vivo
- GitHub App: conectar conta, escolher repo numa lista, auto-deploy em push
- 5 motores de banco (Postgres, MySQL, MariaDB, Redis, MongoDB) com provisionamento e backup
- **Catálogo de serviços um-clique**: Uptime Kuma, n8n, MinIO, RabbitMQ, Meilisearch, Ghost, Metabase, Portainer, Adminer, Redis Commander — qualquer imagem pública, além dos motores de banco
- Backup agendado (cron) com 3 regras de retenção, local ou S3-compatível
- Proxy reverso por servidor (Traefik) com domínio wildcard e HTTPS automático (Let's Encrypt)
- Exclusão de recursos com limpeza remota (container, volume, agendamento no BullMQ)
- **Monitoramento de recursos por servidor**: CPU/RAM/disco lidos via SSH a cada 60s (sem agente), com barra ao vivo no dashboard
- **Notificações**: Discord, Slack, Telegram, **Email (SMTP — qualquer provedor: Gmail, SES, SendGrid, Postfix próprio)** e webhook genérico — deploy falhou/concluiu, backup falhou, servidor caiu/reconectou, CPU/RAM/disco cruzou o limiar
- **Tela de atualizações**: versão da plataforma (commit atual vs `main` no GitHub) e tag de cada imagem Docker em uso vs a mais recente no Docker Hub — checagem manual, nada automático
- **Limites de recurso por container**: `--memory`/`--cpus` configuráveis por aplicação/banco/serviço (formulário de criação e aba "Geral" de cada recurso) — sem limite continua sendo o padrão
- **Notificações com filtro por tipo de evento**: cada canal escolhe quais tipos recebe (deploy ok/falhou, backup falhou, servidor caiu/reconectou, CPU/RAM/disco no limite, TLS perto de expirar) — sem filtro (padrão) recebe todos
- **Alerta de certificado TLS perto de expirar**: checagem diária (conexão TLS direta, sem SSH) em todo domínio de aplicação/serviço em uso — avisa se faltar 14 dias ou menos pra expirar
- **Suíte de testes unitários** (`bun test`, zero dependência extra): cobre lógica pura que já causou bug real (comparação de versão do Docker Hub, `shellQuote`, construção do `docker run` de cada motor de banco/aplicação/serviço, JWT/HMAC do GitHub App, hash de senha, parsing de métricas) — não substitui o teste manual de fluxo completo, mas trava regressão nessas partes sem precisar de Postgres/Redis/servidor real
- **Armazenamento persistente para aplicações**: volumes nomeados do Docker (nome + caminho no container) configuráveis na aba "Armazenamento" — sobrevivem a redeploys; Database/Service já tinham isso implícito (caminho fixo do motor/catálogo), faltava só pra Application
- Editor Monaco, terminal xterm.js, tema claro/escuro

## 🚧 Falta pra fechar as fases já abertas

- **Build packs além de Dockerfile**: Nixpacks (detecta linguagem e builda sem Dockerfile, como o Heroku buildpack), estático (só arquivos, serve via nginx), Docker Compose (multi-container por aplicação)
- **Preview deployments**: cada PR do GitHub vira um ambiente efêmero, com URL própria, que morre quando o PR fecha
- **Rollback**: redeployar um build anterior com um clique (o histórico de deploys já existe — falta o botão)
- **Scheduled tasks**: rodar comandos arbitrários dentro do container da aplicação, num cron (tipo Coolify) — hoje só bancos têm agendamento (backup)
- **Sub-navegação de Configuração mais granular por recurso**: Application já ganhou uma terceira aba (Armazenamento, ver "✅ Já funciona"); falta Advanced, Git Source, Servers, Scheduled Tasks, Webhooks, Preview Deployments, Rollback, Resource Operations — o Coolify separa isso em itens de menu lateral próprios dentro de "Configuration" — só vale desmembrar conforme cada uma dessas features for sendo implementada de verdade, pra não criar aba vazia

## 🎯 Paridade com Coolify — o que ele tem e a gente não

Levantado pesquisando o site oficial, a documentação (`coolify.io/docs`) e o changelog de verdade (`coolify.io/changelog`, versões v4.0 até v4.4-rc, ago/2026) — não é chute. Coolify é um app Laravel 12 + Livewire + Alpine.js monolítico (PHP-FPM renderizando o dashboard inteiro no servidor, Soketi como WebSocket, Postgres + Redis próprios) — isso por si só já é mais pesado que Bun+Vue (SPA de verdade + API separada), então parte do "menos consumo" já vem de graça da nossa arquitetura, sem precisar copiar nada.

**Build e deploy:**
- **Registry Docker privado com push automático**: hoje o `yeah` só builda a partir de repo Git — falta poder configurar um registry (Docker Hub privado, GHCR, etc.) pro qual a imagem buildada é automaticamente enviada, taggeada com o SHA do commit. Item já citado no roadmap (registries privados), mas o achado novo é que o Coolify faz **push**, não só pull — ou seja, builda uma vez e reusa a imagem em vez de rebuildar toda vez que reinicia.
- **`[skip ci]`/`[skip cd]` na mensagem de commit**: pula o auto-deploy daquele push especificamente — simples de fazer, útil pra quem commita só docs/README.
- **Tela de "mudanças pendentes"**: Coolify mostra um aviso com contagem de quantos campos mudaram (env, domínio, etc.) desde o último deploy, antes de aplicar — evita "esqueci que troquei a porta e não redeployei".
- **Grace period configurável de parada**: quanto tempo esperar um container terminar de responder requisições antes de matar ele num redeploy (hoje o `yeah` já mata e sobe na hora).
- **Timeout de conexão SSH configurável por servidor**: pra servidores com latência alta/instável, evita falso-negativo de "servidor offline".

**Variáveis de ambiente:**
- **Variáveis compartilhadas por escopo** (time/projeto/ambiente): hoje cada `Application`/`Database`/`Service` tem seu próprio bloco de `.env` isolado — Coolify deixa declarar uma variável uma vez no nível do time/projeto/ambiente e referenciar em vários recursos (`{{project.NODE_ENV}}` etc.) em vez de copiar o mesmo valor em cada um.
- **Distinção build-time vs runtime**: uma variável só usada durante o build (ex. token de um pacote privado) não precisa vazar pro container rodando.

**Backup:**
- **Backup de volume/storage persistente, não só de banco**: hoje o `yeah` só agenda backup de `Database` — Coolify também agenda backup do volume de dados de qualquer aplicação/serviço (útil pra apps com estado que não é um banco relacional, tipo Uptime Kuma ou n8n do nosso próprio catálogo).
- **Compressão paralela no backup**: Coolify usa gzip paralelo (múltiplos cores) pra acelerar backups grandes — vale a pena se algum dump ficar lento em produção.

**Observabilidade — cuidado pra não copiar do jeito errado:**
- Coolify tem um componente chamado **Sentinel**: um agente (binário Go) instalado em cada servidor gerenciado, que fica rodando e reportando métricas por push. Isso contradiz o próprio pitch "agentless" deles mesmos e é exatamente o tipo de consumo extra que o `yeah` quer evitar — **não copiar esse modelo**. Mas a métrica que ele habilita, métricas **por container** (não só CPU/RAM/disco do servidor inteiro), é um dado real que falta: dá pra conseguir isso continuando 100% agentless, rodando `docker stats --no-stream` por SSH periodicamente no mesmo job que já lê `/proc` hoje (`server-metrics`), sem instalar nada no servidor do usuário.
- **Encaminhar logs pra um sink externo** (Loki, Axiom, New Relic, Fluent Bit): hoje os logs ficam só no Postgres do `yeah`. Nice-to-have pra quem já tem stack de observabilidade própria — baixa prioridade.
- **Gráfico histórico de métricas com visual dedicado**: já está no roadmap (seção Robustez) — Coolify mostra isso num card por container, não só por servidor.

**Terminal:**
- **Terminal web interativo de verdade**: o `yeah` tem xterm.js hoje, mas é só pra log de deploy — Coolify deixa abrir um shell interativo dentro de qualquer container rodando ou do próprio servidor, direto do navegador (WebSocket → API → SSH). Isso é uma feature de UX que faz diferença real na hora de debugar ("por que esse container não sobe") sem precisar copiar/colar comando de SSH manual.

**API e automação:**
- **Expiração de token de API com aviso antecipado**: já citamos "tokens de API pessoais" como faltando — o achado novo é que o Coolify deixa configurar expiração e avisa antes de vencer, em vez de token eterno.
- **Mover recurso entre ambientes via API**: trocar um `Application`/`Database` de ambiente sem recriar do zero.
- **CLI oficial** e **servidor MCP** (inclusive um modo read-only, pra deixar um agente de IA consultar o estado sem poder mudar nada): tendência recente (v4.1+) de expor a plataforma pra automação/agentes, não só a UI. Vale pensar num `yeah` MCP mais pra frente, já que a API já existe.

**Provisionamento de servidor:**
- **Criar VPS direto de dentro do painel** (integração com Hetzner/Vultr/DigitalOcean via API do provedor, incluindo firewall/rede): o `yeah` hoje só conecta em servidor que já existe. Isso é uma feature grande — provavelmente não vale a pena antes de fechar o básico, mas é a diferença mais visível pra quem nunca mexeu com VPS.

**UX menor, mas real:**
- **Tags em recursos** pra filtrar/organizar a listagem.
- **Ícone customizado por projeto** no card do dashboard.
- **2FA** e **status de 2FA visível por membro do time** — já citado, mas nota: como o `yeah` é single-admin, 2FA aqui protege a ÚNICA conta que existe, não é feature multi-usuário.

**Templates docker-compose multi-container**: já citado — Coolify tem 300+ templates um-clique (o nosso catálogo tem 10); a diferença de escala é grande, mas builda em cima do mesmo padrão que a gente já tem, não é uma feature nova pra arquitetar.

**Deliberadamente sem paridade** (decisão de produto, não gap técnico):
- Coolify permite deixar outras pessoas hospedar no seu servidor (com visibilidade limitada pra quem não é dono), tem OIDC/SSO e múltiplos usuários por time. O `yeah` não vai ter nada disso — é single-admin de propósito, sem `/register` depois da primeira conta (ver `docs/ARCHITECTURE.md`).

## 🛡️ Robustez, monitoramento e alertas

O que já saiu (monitoramento de recursos, notificações, tela de atualizações, limites de recurso por container, filtro de notificação por evento, alerta de certificado TLS) está em "✅ Já funciona" acima. O que ainda falta pra fechar essa frente:

- **Sistema de prioridade/degradação mais ativo**: hoje o monitoramento *avisa* quando CPU/RAM/disco passa do limiar, mas não *impede* uma ação — um deploy/provisionamento novo ainda tenta rodar num servidor sob pressão e só descobre que falhou depois. Falta checar o último snapshot de métricas *antes* de enfileirar e barrar (ou pelo menos avisar na hora) se o servidor já estiver no limite.
- **Logs mais robustos**: hoje os logs são só o texto bruto de cada deploy/backup, guardado inteiro numa coluna. Falta: logs estruturados (JSON) dos próprios serviços (`api`/`worker`/`ws`) com nível (info/warn/error) e correlação por request/job id, retenção configurável (não guardar log de deploy pra sempre), e um jeito de ver `docker logs` ao vivo da aplicação rodando (não só do build) — igual ao Coolify tem uma aba "Logs" separada de "Deployments".
- **Proteção contra queda do sistema**: healthcheck + `--restart unless-stopped` já existe nos containers que a gente sobe (incluindo o próprio `yeah` via `docker-compose.prod.yml`); falta um circuit breaker no `worker` pra jobs que falham repetidamente não ficarem re-tentando pra sempre e consumindo fila.
- **Histórico de métricas**: hoje só guarda o snapshot mais recente por servidor (`servers.cpu_percent` etc.), sem série temporal — não dá pra ver um gráfico de "CPU nas últimas 24h", só o valor agora.

## 🔒 Segurança pré-produção

- Criptografar `servers.private_key` e `databases.password` em repouso (hoje texto puro — ver nota em `docs/ARCHITECTURE.md`)
- Assinar/expirar o `state` do fluxo OAuth do GitHub App (hoje é o `teamId` puro)
- Rate limiting na API (login, criação de recursos)

## Como isso é priorizado

Sem sprint formal — os itens vão sendo puxados na ordem que faz mais sentido tecnicamente (estrutural antes de superficial, o que desbloqueia outra coisa antes do que é só nice-to-have). PRs e issues são bem-vindos pra qualquer item daqui — ver `CONTRIBUTING.md`.
