# Contribuindo

## Setup

Veja `docs/INSTALLATION.md` → seção "Desenvolvimento local". TL;DR:

```bash
cp .env.example .env
bun run dev:infra
bun install
bun run db:generate && bun run db:migrate
bun run dev
```

## Antes de abrir um PR

```bash
bun run typecheck
bun test
```

`typecheck` roda `tsc --noEmit` em todo pacote/app do monorepo. `test` roda a suíte de testes unitários (`bun:test`, zero dependência extra) — cobre lógica pura que já causou bug real antes de ter teste (comparação de versão do Docker Hub, `shellQuote`, construção do `docker run` de cada tipo de recurso, JWT/HMAC do GitHub App, hash de senha, parsing de métricas). Não cobre fluxo de API ponta a ponta nem nada que precise de Postgres/Redis reais — pra isso a validação continua sendo manual (subir o app, testar no navegador ou via `curl`). Se sua mudança mexe em `worker` (SSH/Docker), teste contra um alvo real — veja "Testando contra um servidor de verdade" em `docs/INSTALLATION.md`.

**Escrevendo um teste novo**: arquivos ficam ao lado do código como `<nome>.test.ts`. Se a lógica que você quer testar mora num arquivo que importa `@yeah/ssh` (mesmo só por causa de outra função no mesmo arquivo), extraia a parte pura pra um arquivo `<nome>.commands.ts` sem esse import — importar `@yeah/ssh` carrega o `ssh2` inteiro, que quebra de forma instável quando múltiplos arquivos de teste rodam juntos no mesmo processo do `bun test` (`apps/worker/src/jobs/*.commands.ts` são o padrão a seguir). `test/setup.ts` (via `bunfig.toml`) já define `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` fake — os clients do Postgres/Redis são preguiçosos (não conectam na hora de construir), então importar um módulo que os usa não exige infra real rodando, só não dá pra exercitar uma query de verdade.

**Linux/Mac**: se `bun run typecheck` (ou `bun run --cwd apps/web build`) explodir com uma parede de `Cannot find module '*.vue'` — um erro por cada import de `.vue` do projeto, mesmo os relativos (`./App.vue`) — isso é um bug conhecido do Bun ao executar o `vue-tsc` no Linux (não reproduz no Windows, onde o `.bin` do Bun usa um `.exe` nativo em vez do script com shebang). Rode com Node de verdade em vez de deixar o Bun executar: `node apps/web/node_modules/.bin/vue-tsc --noEmit`. O `Dockerfile` já faz isso pro build de produção.

## Estrutura do monorepo

```
apps/
  api/     Elysia — HTTP API
  worker/  BullMQ worker — única parte que fala SSH com servidores de usuário
  ws/      Bun WebSocket
  web/     Vue 3 + Vite
packages/
  db/       Schema Drizzle + client
  shared/   Tipos TypeScript compartilhados
  queue/    Filas/pub-sub BullMQ + Redis
  ssh/      Cliente SSH (usado só pelo worker)
  storage/  Wrapper fino sobre Bun.S3Client
  github/   JWT do GitHub App, tokens de instalação, webhook
```

Um pacote novo (`packages/<nome>`) segue sempre o mesmo esqueleto: `package.json` com `main`/`types` apontando pra `./src/index.ts`, `tsconfig.json` estendendo `../../tsconfig.base.json`. Veja qualquer pacote existente como referência.

## Convenções

- **Sem comentário óbvio.** Só comenta o *porquê* quando não é óbvio pelo código (uma decisão não-intuitiva, um workaround, uma invariante escondida). Nomes bons já explicam o *o quê*.
- **Migrations**: nunca edite uma migration já commitada. Mude o schema em `packages/db/src/schema/*.ts` e rode `bun run db:generate`.
- **Rotas da API**: todo endpoint autenticado começa checando sessão (`getUserFromSessionId`) e depois `assertMember`/dono do recurso. Copie o padrão de uma rota existente no mesmo arquivo.
- **A API nunca fala SSH direto** — só o `worker` faz isso, via job na fila. As duas exceções (download de backup, teardown na exclusão) estão documentadas com comentário no código — se você achar que precisa de uma terceira, questione antes de adicionar.
- **Frontend**: Tailwind v4 + tokens CSS em `apps/web/src/styles/main.css`. Segue o design system em `docs/ARCHITECTURE.md`.

## Reportando bugs / sugerindo features

Abra uma issue. Se for sobre um item do roadmap, referencie a seção correspondente em `docs/ROADMAP.md`.
