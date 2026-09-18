# Instalação

Duas formas de rodar o `yeah`: **produção** (um servidor Ubuntu, um comando) e **desenvolvimento local** (pra mexer no código).

## Produção — Ubuntu/Debian, um comando

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash
```

O que o script faz (veja `install.sh` na raiz do repo — é só bash, dá pra ler antes de rodar):

1. Instala Docker + o plugin Compose, se não tiver.
2. Clona o repositório em `/opt/yeah` (ou atualiza, se já existir).
3. Pergunta o domínio/IP público e a porta do dashboard (padrão: uma porta não-óbvia, não 8080), gera um `.env` com senha de banco, segredo de sessão e um **caminho de painel aleatório** (`PANEL_PATH`) — nunca sobrescreve um `.env` já existente.
4. Builda e sobe `postgres`, `redis`, `api`, `worker`, `ws` e `web` via `docker-compose.prod.yml`.
5. Roda as migrations do banco.
6. Instala um helper `yeah` em `/usr/local/bin` (`yeah update`, `yeah logs`, `yeah restart`, `yeah status`, `yeah stop`).

Ao final, o script imprime a URL completa: `http://<seu-host>:<porta><caminho-aleatório>/` — **guarde essa URL**, ela não fica em lugar nenhum além do `.env` e do que o script mostrou na tela. Crie sua conta em `<mesma-url>/register`.

> **Por quê um caminho aleatório?** O painel só responde nesse caminho — qualquer outra URL na mesma porta (incluindo a raiz `/`) recebe conexão fechada, sem resposta HTTP nenhuma (ver `apps/web/nginx.conf.template`). Combinado com uma porta não-padrão, isso tira o painel da varredura casual — não substitui autenticação (que já existe via login), é uma camada a mais. Pra ver ou trocar o caminho depois, edite `PANEL_PATH` em `/opt/yeah/.env` e rode `sudo yeah update`.

> **`/register` só funciona uma vez.** `yeah` é single-admin, não um produto de cadastro aberto — assim que essa primeira conta existe, `/register` para de funcionar pra sempre (redireciona pra `/login`) e não tem convite nem forma de uma segunda pessoa ganhar login nessa instância.

> **A própria máquina já vira o primeiro servidor.** Antes de gerar o `.env`, o script cria uma chave SSH e já autoriza ela em `~/.ssh/authorized_keys` do host — assim que você cria a conta de admin, essa máquina aparece cadastrada como "Servidor local" (status `connected`), sem precisar adicionar nada manualmente pra já fazer o primeiro deploy. Detalhes em `docs/ARCHITECTURE.md`.

> **Sem HTTPS por padrão.** O instalador expõe o dashboard em HTTP puro pra simplificar o primeiro acesso. Se for expor pra internet, coloque um reverse proxy na frente com certificado — o jeito mais simples é [Caddy](https://caddyserver.com/) (HTTPS automático, um arquivo `Caddyfile` de 3 linhas), mas Traefik ou nginx+certbot funcionam igual. Isso é **infra de quem hospeda o `yeah`**, diferente do Traefik que o próprio `yeah` sobe nos servidores dos *seus* usuários (isso aí já vem automático, ver `docs/ARCHITECTURE.md`).

### Atualizando

```bash
sudo yeah update
```

Puxa a última versão do branch `main`, rebuilda as imagens que mudaram e roda migrations pendentes.

### Logs, status, parar

```bash
sudo yeah logs api      # segue o log de um serviço
sudo yeah logs          # segue todos
sudo yeah status        # docker compose ps
sudo yeah stop          # para tudo sem remover volumes
```

### Requisitos de máquina

Rodando `postgres` + `redis` + `api` + `worker` + `ws` + `web` juntos, num servidor com 1 vCPU / 1GB RAM já sobe (os limites de memória em `docker-compose.prod.yml` somam ~1.8GB no teto, mas o uso real em repouso é bem menor). Pra hospedar aplicações/bancos *dos seus usuários*, esses rodam nos servidores remotos que você cadastrar — o servidor onde o `yeah` roda não precisa escalar junto com eles.

## Desenvolvimento local

Requisitos: [Bun](https://bun.sh) ≥ 1.3, Docker (só pra Postgres/Redis de dev).

```bash
git clone https://github.com/flazo0/yeah.git
cd yeah
cp .env.example .env          # ajuste se precisar
bun run dev:infra              # sobe Postgres + Redis via docker compose
bun install
bun run db:generate && bun run db:migrate   # primeira vez
bun run dev                    # api :3000, worker, ws :3001, web :5173
```

Crie uma conta em `http://localhost:5173/register` — ganha um time pessoal automaticamente.

Pra derrubar a infra de dev: `bun run dev:infra:down`.

### Scripts úteis

| Comando | O que faz |
|---|---|
| `bun run dev` | Sobe api+worker+ws+web em paralelo |
| `bun run typecheck` | `tsc --noEmit` em todo pacote/app do monorepo |
| `bun run db:generate` | Gera uma nova migration a partir do schema Drizzle |
| `bun run db:migrate` | Aplica migrations pendentes |
| `bun run db:studio` | Abre o Drizzle Studio (GUI pro Postgres) |

### GitHub App (opcional, só se for testar essa parte)

Veja `.env.example` — tem o passo a passo completo de quais campos preencher em `github.com/settings/apps/new` e como gerar `GITHUB_APP_PRIVATE_KEY_BASE64` a partir do `.pem` que o GitHub te dá.

### Testando contra um servidor de verdade

O `worker` precisa de um alvo SSH+Docker real pra testar deploy/provisionamento — não dá pra mockar isso de forma útil. Durante o desenvolvimento, um container Alpine com `openssh-server` + `docker-cli`, com o `docker.sock` do host montado (`docker run -v /var/run/docker.sock:/var/run/docker.sock ...`), funciona como um "servidor remoto" descartável — os comandos `docker run`/`docker build` que o worker manda por SSH acabam rodando no daemon real do seu host. Não precisa disso pra rodar o `yeah` normalmente — só é útil se você for mexer no código do `worker`.
