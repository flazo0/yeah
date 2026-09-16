# Roadmap

Estado real do projeto — o que já funciona (testado de ponta a ponta, ver `docs/DEVLOG.md`) e o que falta, incluindo paridade com o Coolify e itens de robustez que todo PaaS de produção precisa.

## ✅ Já funciona

- Auth por sessão, times, papéis, convites
- Servidores via SSH (agentless, igual Coolify)
- `Project → Environment → Application | Database`, igual Coolify
- Deploy de aplicações (só `Dockerfile` por enquanto) com log ao vivo
- GitHub App: conectar conta, escolher repo numa lista, auto-deploy em push
- 5 motores de banco (Postgres, MySQL, MariaDB, Redis, MongoDB) com provisionamento e backup
- Backup agendado (cron) com 3 regras de retenção, local ou S3-compatível
- Proxy reverso por servidor (Traefik) com domínio wildcard e HTTPS automático (Let's Encrypt)
- Exclusão de recursos com limpeza remota (container, volume, agendamento no BullMQ)
- Editor Monaco, terminal xterm.js, tema claro/escuro

## 🚧 Falta pra fechar as fases já abertas

- **Build packs além de Dockerfile**: Nixpacks (detecta linguagem e builda sem Dockerfile, como o Heroku buildpack), estático (só arquivos, serve via nginx), Docker Compose (multi-container por aplicação)
- **Preview deployments**: cada PR do GitHub vira um ambiente efêmero, com URL própria, que morre quando o PR fecha
- **Rollback**: redeployar um build anterior com um clique (o histórico de deploys já existe — falta o botão)
- **Scheduled tasks**: rodar comandos arbitrários dentro do container da aplicação, num cron (tipo Coolify) — hoje só bancos têm agendamento (backup)

## 🎯 Paridade com Coolify — o que ele tem e a gente não

- **Catálogo de serviços "um clique"**: Coolify tem uma lista enorme de templates docker-compose prontos (Plausible, Umami, Ghost, WordPress, n8n, Uptime Kuma, MinIO, RabbitMQ, Meilisearch, Directus, Supabase, etc.) — isso é *além* dos motores de banco que já temos, é qualquer serviço publicado como imagem Docker pública. Ver seção "Catálogo de serviços" abaixo.
- **Sentinel (agente de monitoramento)**: Coolify instala um agente leve em cada servidor que reporta CPU/RAM/disco/rede em tempo real pro dashboard.
- **Notificações**: Discord, Slack, Telegram, e-mail, webhook genérico — pra deploy com sucesso/falha, backup com sucesso/falha, servidor caiu, etc.
- **Audit log**: trilha de quem fez o quê (deploy, exclusão, mudança de config), com timestamp.
- **Tokens de API pessoais**: pra automação sem precisar de cookie de sessão (CI/CD externo chamando a API do `yeah` diretamente).
- **2FA**: autenticação em dois fatores pra login.
- **Múltiplos registries privados**: hoje só clona repo público/via GitHub App — falta suporte a registry Docker privado pra imagens já buildadas (em vez de sempre buildar do zero).

## 🛡️ Robustez, monitoramento e alertas (pedido explícito)

Isso é o que separa um projeto pessoal de uma plataforma que aguenta produção de verdade:

- **Monitoramento de recursos por servidor**: CPU, RAM, disco, rede — coletado periodicamente (via SSH, sem precisar de agente, no espírito agentless que o resto do projeto já segue) e mostrado num gráfico por servidor.
- **Sistema de prioridade/degradação**: se um servidor estiver sob pressão (RAM/disco acima de um limiar), a plataforma avisa *antes* de tentar mais um deploy/provisionamento nele, em vez de deixar o `docker run` falhar silenciosamente por falta de recurso.
- **Limites de recurso por container**: `--memory`/`--cpus` no `docker run` de aplicações e bancos, configurável por recurso — hoje um container sem limite pode consumir a máquina inteira e derrubar os outros.
- **Alertas configuráveis**: threshold de CPU/RAM/disco, deploy falhou, backup falhou, servidor caiu, certificado TLS perto de expirar, atualização disponível — cada um roteável pra um canal de notificação.
- **Tela de atualizações**: uma tela central mostrando (a) se tem uma versão nova do `yeah` disponível, (b) se as imagens Docker usadas pelos recursos (Postgres, Redis, Traefik, etc.) têm tag mais nova, com um botão pra atualizar manualmente recurso por recurso — nada automático sem o usuário decidir.
- **Logs mais robustos**: hoje os logs são só o texto bruto de cada deploy/backup, guardado inteiro numa coluna. Falta: logs estruturados (JSON) dos próprios serviços (`api`/`worker`/`ws`) com nível (info/warn/error) e correlação por request/job id, retenção configurável (não guardar log de deploy pra sempre), e um jeito de ver `docker logs` ao vivo da aplicação rodando (não só do build) — igual ao Coolify tem uma aba "Logs" separada de "Deployments".
- **Proteção contra queda do sistema**: healthcheck + `--restart unless-stopped` já existe nos containers que a gente sobe; falta isso no próprio `yeah` (o `docker-compose.prod.yml` já tem `restart: unless-stopped` em tudo) e um circuit breaker no `worker` pra jobs que falham repetidamente não ficarem re-tentando pra sempre e consumindo fila.

## 🔒 Segurança pré-produção

- Criptografar `servers.private_key` e `databases.password` em repouso (hoje texto puro — ver nota em `docs/ARCHITECTURE.md`)
- Assinar/expirar o `state` do fluxo OAuth do GitHub App (hoje é o `teamId` puro)
- Rate limiting na API (login, criação de recursos)

## Como isso é priorizado

Sem sprint formal — os itens vão sendo puxados na ordem que faz mais sentido tecnicamente (estrutural antes de superficial, o que desbloqueia outra coisa antes do que é só nice-to-have). PRs e issues são bem-vindos pra qualquer item daqui — ver `CONTRIBUTING.md`.
