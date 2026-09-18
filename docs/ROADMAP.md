# Roadmap

Estado real do projeto — o que já funciona (testado de ponta a ponta, ver `docs/DEVLOG.md`) e o que falta, incluindo paridade com o Coolify e itens de robustez que todo PaaS de produção precisa.

## ✅ Já funciona

- Auth por sessão — **single-admin de propósito**: `/register` só funciona uma vez (primeira conta da instância), sem convite nem forma de uma segunda pessoa ganhar login. Times/papéis (`owner`/`admin`/`member`) continuam existindo como o jeito de todo recurso ser organizado, mas hoje sempre tem um usuário só
- Servidores via SSH (agentless, igual Coolify) — a própria máquina onde o `yeah` roda já entra automaticamente como o primeiro servidor (chave SSH gerada e autorizada pelo `install.sh`), igual o "localhost" do Coolify
- `Project → Environment → Application | Database | Service`, igual Coolify
- Deploy de aplicações (só `Dockerfile` por enquanto) com log ao vivo
- GitHub App: conectar conta, escolher repo numa lista, auto-deploy em push
- 5 motores de banco (Postgres, MySQL, MariaDB, Redis, MongoDB) com provisionamento e backup
- **Catálogo de serviços um-clique**: Uptime Kuma, n8n, MinIO, RabbitMQ, Meilisearch, Ghost, Metabase, Portainer, Adminer, Redis Commander — qualquer imagem pública, além dos motores de banco
- Backup agendado (cron) com 3 regras de retenção, local ou S3-compatível
- Proxy reverso por servidor (Traefik) com domínio wildcard e HTTPS automático (Let's Encrypt)
- Exclusão de recursos com limpeza remota (container, volume, agendamento no BullMQ)
- **Monitoramento de recursos por servidor**: CPU/RAM/disco lidos via SSH a cada 60s (sem agente), com barra ao vivo no dashboard
- **Notificações**: Discord, Slack, Telegram e webhook genérico — deploy falhou/concluiu, backup falhou, servidor caiu/reconectou, CPU/RAM/disco cruzou o limiar
- **Tela de atualizações**: versão da plataforma (commit atual vs `main` no GitHub) e tag de cada imagem Docker em uso vs a mais recente no Docker Hub — checagem manual, nada automático
- **Limites de recurso por container**: `--memory`/`--cpus` configuráveis por aplicação/banco/serviço (formulário de criação e aba "Geral" de cada recurso) — sem limite continua sendo o padrão
- **Notificações com filtro por tipo de evento**: cada canal escolhe quais tipos recebe (deploy ok/falhou, backup falhou, servidor caiu/reconectou, CPU/RAM/disco no limite, TLS perto de expirar) — sem filtro (padrão) recebe todos
- **Alerta de certificado TLS perto de expirar**: checagem diária (conexão TLS direta, sem SSH) em todo domínio de aplicação/serviço em uso — avisa se faltar 14 dias ou menos pra expirar
- Editor Monaco, terminal xterm.js, tema claro/escuro

## 🚧 Falta pra fechar as fases já abertas

- **Build packs além de Dockerfile**: Nixpacks (detecta linguagem e builda sem Dockerfile, como o Heroku buildpack), estático (só arquivos, serve via nginx), Docker Compose (multi-container por aplicação)
- **Preview deployments**: cada PR do GitHub vira um ambiente efêmero, com URL própria, que morre quando o PR fecha
- **Rollback**: redeployar um build anterior com um clique (o histórico de deploys já existe — falta o botão)
- **Scheduled tasks**: rodar comandos arbitrários dentro do container da aplicação, num cron (tipo Coolify) — hoje só bancos têm agendamento (backup)

## 🎯 Paridade com Coolify — o que ele tem e a gente não

- **Audit log**: trilha de quem fez o quê (deploy, exclusão, mudança de config), com timestamp.
- **Tokens de API pessoais**: pra automação sem precisar de cookie de sessão (CI/CD externo chamando a API do `yeah` diretamente).
- **2FA**: autenticação em dois fatores pra login.
- **Múltiplos registries privados**: hoje só clona repo público/via GitHub App — falta suporte a registry Docker privado pra imagens já buildadas (em vez de sempre buildar do zero).
- **Templates docker-compose multi-container**: o catálogo de serviços de hoje só cobre imagem única (um `docker run`) — Coolify também tem templates compostos (ex.: Plausible = app + ClickHouse + Postgres). Fica pro dia que precisar de um serviço assim.
- **Deliberadamente sem paridade**: Coolify permite deixar outras pessoas hospedar no seu servidor (com visibilidade limitada pra quem não é dono). O `yeah` não vai ter isso — é single-admin de propósito, sem `/register` depois da primeira conta (ver `docs/ARCHITECTURE.md`).

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
