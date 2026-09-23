# Instalação

Duas formas de rodar o `yeah`: **produção** (um servidor Ubuntu, um comando) e **desenvolvimento local** (pra mexer no código).

## Produção — Ubuntu/Debian, um comando

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash
```

O que o script faz (veja `install.sh` na raiz do repo — é só bash, dá pra ler antes de rodar):

1. Instala Docker + o plugin Compose, se não tiver.
2. Clona o repositório em `/opt/yeah` (ou atualiza, se já existir).
3. Pergunta o domínio/IP público e a porta do dashboard (padrão: uma porta não-óbvia, não 8080), gera um `.env` com senha de banco e segredo de sessão aleatórios — nunca sobrescreve um `.env` já existente.
4. Builda e sobe `postgres`, `redis`, `api`, `worker`, `ws` e `web` via `docker-compose.prod.yml`.
5. Roda as migrations do banco.
6. Instala um helper `yeah` em `/usr/local/bin` (`yeah update`, `yeah logs`, `yeah restart`, `yeah status`, `yeah stop`).

Ao final, acesse `http://<seu-host>:<porta>` e crie sua conta em `/register`.

> **Quer esconder o painel atrás de um caminho secreto também?** É opcional, desligado por padrão. Edite `PANEL_PATH` em `/opt/yeah/.env` (ex.: `PANEL_PATH=/a1b2c3d4`) e rode `sudo yeah update` — o dashboard passa a só responder sob essa URL; qualquer outra coisa na mesma porta (incluindo `/`) para de responder. Detalhes em `docs/ARCHITECTURE.md`.

> **`/register` só funciona uma vez.** `yeah` é single-admin, não um produto de cadastro aberto — assim que essa primeira conta existe, `/register` para de funcionar pra sempre (redireciona pra `/login`) e não tem convite nem forma de uma segunda pessoa ganhar login nessa instância.

> **A própria máquina já vira o primeiro servidor.** Antes de gerar o `.env`, o script cria uma chave SSH e já autoriza ela em `~/.ssh/authorized_keys` do host — assim que você cria a conta de admin, essa máquina aparece cadastrada como "Servidor local" (status `connected`), sem precisar adicionar nada manualmente pra já fazer o primeiro deploy. Detalhes em `docs/ARCHITECTURE.md`.

> **Sem HTTPS por padrão.** O instalador expõe o dashboard em HTTP puro pra simplificar o primeiro acesso. Se for expor pra internet, coloque um reverse proxy na frente com certificado — o jeito mais simples é [Caddy](https://caddyserver.com/) (HTTPS automático, um arquivo `Caddyfile` de 3 linhas), mas Traefik ou nginx+certbot funcionam igual. Isso é **infra de quem hospeda o `yeah`**, diferente do Traefik que o próprio `yeah` sobe nos servidores dos *seus* usuários (isso aí já vem automático, ver `docs/ARCHITECTURE.md`).

### Painel separado dos servidores (só o painel)

O `yeah` é 100% agentless: quem fala com os servidores é sempre o worker, por SSH — então o painel não precisa rodar na mesma máquina que os seus apps. Dá pra instalar **só o painel** num PC de casa, num Raspberry Pi ou numa VPS barata, e conectar a VPS de produção como um servidor remoto. A VPS de produção não gasta RAM/CPU com o dashboard, a API, o Postgres do painel nem o Redis (o painel usa em torno de 250MB em repouso).

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash -s -- --control-plane-only
```

(Rodando o script direto: `sudo ./install.sh --control-plane-only`. Sem a flag e com terminal interativo, o instalador pergunta "Esta máquina também vai rodar os apps?" — responda `n`.)

O que muda nesse modo: **nenhuma chave SSH é gerada e o `~/.ssh/authorized_keys` da máquina não é tocado**; o painel sobe sem nenhum servidor cadastrado (não existe o "Servidor local"). Depois de criar a conta:

1. Vá em **Servidores → Adicionar servidor**.
2. Preencha nome, host/IP, porta e usuário SSH da VPS de produção e clique em **Gerar chave nova** — a tela gera um par ed25519, coloca a chave privada no formulário (ela é guardada criptografada no banco) e mostra o comando que autoriza a chave pública.
3. Rode esse comando na VPS (como o usuário SSH que você escolheu) e clique em **Adicionar servidor**. O status vira `connected` e o Docker da VPS aparece.

Só precisa de **saída de rede** do painel até a VPS na porta SSH (o inverso não é necessário) — então o painel pode ficar atrás de NAT, sem IP público. Métricas de CPU/RAM/disco, deploy, backup e proxy funcionam igual, tudo por SSH.

Diferenças a saber nesse modo:

- **Atualizar o painel** é `sudo yeah update` na máquina do painel. Na tela *Atualizações* os botões "Atualizar plataforma" e "Atualizar sistema" somem, porque eles agem por SSH num servidor marcado como host da plataforma, e no modo separado o painel não roda em nenhum servidor cadastrado.
- Os servidores de deploy são atualizados direto neles (`apt` etc.).
- **Já instalou com o servidor local e quer converter?** Não precisa reinstalar: mova/exclua os recursos do "Servidor local" e remova-o em **Servidores → (servidor) → Remover servidor** (isso só tira ele do painel; nada é apagado na máquina). Se depois quiser também deixar de autorizar a chave dele, apague a linha `yeah-localhost` do `~/.ssh/authorized_keys` e as `LOCALHOST_SSH_*` do `.env`.

#### Acessar o painel de qualquer lugar (Cloudflare Tunnel)

Se o painel roda numa máquina sem IP público (casa, CGNAT), dá pra expô-lo por um [túnel da Cloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — sem abrir porta nem configurar roteador:

```bash
curl -fsSL https://raw.githubusercontent.com/flazo0/yeah/main/install.sh | sudo bash -s -- --control-plane-only --cloudflare-tunnel-token=SEU_TOKEN
```

1. No painel da Cloudflare (Zero Trust → Networks → Tunnels) crie um túnel e copie o token.
2. Adicione um *public hostname* (ex.: `painel.seudominio.com`) apontando pra o serviço `http://web:80`.
3. Ao instalar, informe esse hostname como domínio do painel. O instalador sobe também o container `cloudflared` (profile `tunnel` do `docker-compose.prod.yml`), guarda o token no `.env`, deixa a porta local só em `127.0.0.1` e passa a usar `https://<hostname>` como origem (o cookie de sessão sai com a flag `Secure`).

O rate limit da API usa o IP real do visitante: atrás do túnel o nginx lê o cabeçalho `CF-Connecting-IP`, mas só quando a conexão vem da rede interna do Docker — quem acessa a porta exposta direto não consegue forjar esse cabeçalho.

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
