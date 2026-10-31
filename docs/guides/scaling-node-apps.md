# Guide: scaling a Node or Bun app across several cores

A Node or Bun process uses **one core** for JavaScript. On a VPS with 2 or more vCPUs, run one process per core.

## Node

Use `pm2-runtime` (the daemon-less build, made for containers) in cluster mode:

```dockerfile
RUN npm install -g pm2
CMD ["pm2-runtime", "start", "server.js", "-i", "max"]
```

`-i max` starts one worker per core; the master distributes connections. A dependency-free alternative is the `node:cluster` module.

## Bun / Deno

There is no stable equivalent of `cluster`. Start **N processes** listening on the same port with `reusePort: true` and let the kernel balance them:

```ts
Bun.serve({ port: 3000, reusePort: true, fetch });
```

Run one process per core (a script that spawns N times, or N replicas of the container in a `docker-compose` file).

## What stops working with more than one process

Each process has its own memory, so everything that was "global in memory" has to move out:

- **Sessions** → Redis (or a signed cookie).
- **Cache** → Redis.
- **Rate limiting** → Redis (in-memory counters are per process, so the real limit becomes N×).
- **WebSockets / SSE** → a broadcast between processes (Redis pub/sub).
- **Scheduled jobs** (`setInterval`, cron) → would run N times; use a queue (BullMQ) or a single dedicated process.

## Memory

N processes means roughly N× the base memory. On a 1 vCPU / 4 GB VPS it is **not worth it**: a single process with container memory limits (the application's Resources tab) gives better results.
