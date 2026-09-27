# Guia: várias aplicações + banco + fila no mesmo ambiente

Um cenário comum: uma API, um worker que processa fila, um banco Postgres e uma fila (Redis ou
RabbitMQ), todos conversando entre si, com a mesma configuração de conexão em todas as aplicações.
Este guia mostra como montar isso com o que já existe no painel — **Destinations** (rede interna) e
**Shared Variables** — sem hardcode de IP nem duplicar segredo em cada aplicação.

## O único requisito: tudo no mesmo servidor

A "rede interna do ambiente" (`yeah-env-<id>`) é uma rede **Docker bridge**, criada no servidor onde
o próprio recurso é implantado (`docker network create`, por SSH, na hora do deploy). Uma bridge é
local a um daemon Docker — **ela não atravessa servidores**. Então:

- Uma aplicação no servidor A e um banco no servidor B **não se enxergam** pelo alias, mesmo estando
  no mesmo projeto/ambiente do painel. Cada um entra só na rede que existe no seu próprio servidor.
- Para os recursos se acharem por nome, **implante todos no mesmo servidor** (a mesma VPS/host
  cadastrado no painel). Servidores diferentes = redes diferentes, ainda que com o mesmo nome.
- Multi-servidor com rede compartilhada de verdade (overlay, Swarm, WireGuard entre hosts) está fora
  do que o painel faz hoje — ver `docs/ROADMAP.md` (Fase 6, avaliação de Swarm de nó único).

## 1. Um ambiente, um servidor

Crie (ou use) um projeto e um ambiente, e aponte todo recurso deste guia pro mesmo servidor. Cada um
que você criar entra automaticamente em `yeah-env-<id>` com um alias — o nome do recurso "fatiado"
(`internalHostName`: minúsculo, sem acento, espaços viram `-`). Dá pra conferir o alias exato na aba
"Geral" de cada recurso, ou vendo o nome que você deu: "Fila Pedidos" vira `fila-pedidos`.

| Recurso | Como criar | Alias na rede |
|---|---|---|
| Banco Postgres | Catálogo → Databases → PostgreSQL | o nome que você deu ao banco |
| Fila (Redis) | Catálogo → Databases → Redis (ou KeyDB/Dragonfly) | o nome que você deu |
| Fila (RabbitMQ) | Catálogo → Services → template `rabbitmq` | o nome do serviço (stack de 1 container) |
| API | Nova aplicação (Dockerfile/imagem/Nixpacks/Compose) | o nome da aplicação |
| Worker | Outra aplicação, mesmo ambiente | o nome da aplicação |

Aplicações Docker Compose de vários containers e serviços em stack também entram: cada container
responde por `<slug>-<serviço>` (ex.: `api-web`, `api-worker-sidecar`), e o container "principal" —
o serviço escolhido pro domínio, numa app; o `mainService` do template, num serviço — também responde
pelo `<slug>` puro, pra não exigir saber qual container é qual de fora.

## 2. Uma variável compartilhada, não uma por aplicação

Em vez de colar a mesma `DATABASE_URL`/`REDIS_URL` no `.env` de cada aplicação (e ter que trocar em
todo lugar se a senha mudar), guarde uma vez como **Shared Variable** do ambiente (ou do projeto, se
vai valer pra mais de um ambiente) e referencie com `{{environment.CHAVE}}` no `.env` de cada
aplicação. Veja `docs/API.md` (seção Shared Variables) pros escopos e a sintaxe completa.

Exemplo, com um Postgres chamado "Pedidos DB" e um Redis chamado "Fila Pedidos", os dois no mesmo
ambiente e servidor:

1. Copie a URL de conexão interna do banco (aba Geral → Conexão — já vem com o alias certo, porta e,
   se o banco não é público, sem exigir TLS de fora) e do Redis.
2. Ambiente → Variáveis compartilhadas → nova variável `DATABASE_URL` (escopo *environment*) com essa
   URL; outra `REDIS_URL` do mesmo jeito.
3. No `.env` da API e do worker, em vez da URL literal:
   ```
   DATABASE_URL={{environment.DATABASE_URL}}
   REDIS_URL={{environment.REDIS_URL}}
   ```
4. Redeploy nas duas. O painel expande a referência antes de escrever o `.env` no servidor — se a
   variável não existir mais, o deploy falha com a chave que faltou, em vez de subir com um "" vazio.

Segredo de app-pra-app (ex.: um token que a API assina e o worker confere) segue o mesmo caminho: uma
variável compartilhada, referenciada dos dois lados — assim trocar o valor é um lugar só.

## 3. Escala (mais de um worker)

Isso não é um pool automático — cada "worker" que você quer rodar em paralelo é uma aplicação própria
(ou, pra Node/Bun, um único processo com múltiplos cores: ver
`docs/ROADMAP.md`, Fase 8, "Escalar app Node/Bun em múltiplos cores" — nesse caso sessão/cache/rate
limit têm que ir pro Redis compartilhado, não pra memória do processo, porque cada core é um processo
saindo do mesmo container).

## 4. Coisas que não são automáticas

- **Ordem de subida**: o painel não expressa "espere o banco ficar `healthy` antes de subir a API".
  Bancos entram healthy antes de aceitar conexões (o healthcheck do container cuida disso), mas se a
  API falha ao conectar no primeiro segundo, ela precisa retry próprio (a maioria dos clients de
  Postgres/Redis já faz isso).
- **Migração de servidor**: mudar o servidor de uma aplicação/banco tira e põe ele numa rede/servidor
  novo — os outros recursos do "cluster" de microsserviços continuam no servidor antigo. Migre o
  conjunto inteiro se quiser manter todos se enxergando.
- **TLS entre bancos e apps**: bancos privados (padrão) não expõem porta pra fora, então a conexão
  interna já não passa pela internet. A URL interna usa o mesmo toggle de TLS do banco (aba
  Configurações) — desligado por padrão, então a URL copiada não tem `sslmode=require`; se você ligar
  TLS no banco, a URL interna passa a exigir também (o Postgres valida o certificado autoassinado do
  próprio motor).
