# Escalar um app Node/Bun em múltiplos cores

Um processo Node ou Bun usa **um core** para o código JavaScript. Numa VPS de 2+ vCPUs, rode um processo por core.

## Node

Use o `pm2-runtime` (versão sem daemon, própria pra container) em modo cluster:

```dockerfile
RUN npm install -g pm2
CMD ["pm2-runtime", "start", "server.js", "-i", "max"]
```

`-i max` sobe um worker por core; o master distribui as conexões. Alternativa sem dependência: o módulo `node:cluster`.

## Bun / Deno

Não há `cluster` equivalente estável. Suba **N processos** escutando na mesma porta com `reusePort: true` e deixe o kernel balancear:

```ts
Bun.serve({ port: 3000, reusePort: true, fetch });
```

Rode um processo por core (um script que dá `spawn` N vezes, ou N réplicas do container no `docker-compose`).

## O que deixa de funcionar com mais de um processo

Cada processo tem a própria memória. Tudo que era "global em memória" precisa ir para fora:

- **Sessão** → Redis (ou cookie assinado).
- **Cache** → Redis.
- **Rate limit** → Redis (contadores em memória ficam por processo, então o limite real vira N×).
- **WebSockets / SSE** → um broadcast entre processos (pub/sub no Redis).
- **Jobs agendados** (`setInterval`, cron) → rodariam N vezes; use uma fila (BullMQ) ou um só processo dedicado.

## Memória

N processos = ~N× a memória base. Em VPS de 1 vCPU/4 GB, **não vale**: um processo só e limites de memória no container (aba Recursos da aplicação) rendem mais.
