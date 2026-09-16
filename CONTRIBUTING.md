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
```

Roda `tsc --noEmit` em todo pacote/app do monorepo. Não tem suite de testes automatizados ainda (ver `docs/ROADMAP.md`) — a validação hoje é typecheck + teste manual real (subir o app, testar o fluxo no navegador ou via `curl`). Se sua mudança mexe em `worker` (SSH/Docker), teste contra um alvo real — veja "Testando contra um servidor de verdade" em `docs/INSTALLATION.md`.

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
