# Guide: several applications, a database and a queue in one environment

A common scenario: an API, a worker that processes a queue, a Postgres database and a queue (Redis or RabbitMQ), all talking to each other with the same connection settings in every application. This guide shows how to set that up with what the panel already provides — the environment's internal network and **Shared Variables** — without hard-coding IPs or duplicating secrets in each application.

## The one requirement: everything on the same server

The environment's internal network (`yeah-env-<id>`) is a Docker **bridge** network, created on the server where each resource is deployed (`docker network create` over SSH at deployment time). A bridge is local to a single Docker daemon — **it does not span servers**. So:

- An application on server A and a database on server B **cannot see each other** by alias, even if they sit in the same project and environment in the panel. Each one joins only the network that exists on its own server.
- For resources to find each other by name, **deploy them all on the same server** (the same VPS registered in the panel). Different servers mean different networks, even with the same name.
- A multi-server shared network (overlay, Swarm, WireGuard between hosts) is outside what the panel does today — see [roadmap.md](../roadmap.md).

## 1. One environment, one server

Create (or use) a project and an environment, and point every resource in this guide at the same server. Each one you create automatically joins `yeah-env-<id>` with an alias — the resource name "slugified" (`internalHostName`: lowercase, no accents, spaces become `-`). You can see the exact alias in each resource's *General* tab: "Orders Queue" becomes `orders-queue`.

| Resource | How to create it | Alias on the network |
|---|---|---|
| Postgres database | Databases → PostgreSQL | the name you gave the database |
| Queue (Redis) | Databases → Redis (or KeyDB / Dragonfly) | the name you gave it |
| Queue (RabbitMQ) | Services → `rabbitmq` template | the service name (single-container stack) |
| API | New application (Dockerfile / image / Nixpacks / Compose) | the application name |
| Worker | Another application in the same environment | the application name |

Multi-container Docker Compose applications and stack services join too: each container answers to `<slug>-<service>` (for example `api-web`, `api-worker-sidecar`), and the "main" container — the service chosen for the domain in an application, the template's `mainService` in a service — also answers to the bare `<slug>`, so you do not need to know which container is which from the outside.

## 2. One shared variable, not one per application

Instead of pasting the same `DATABASE_URL` / `REDIS_URL` into every application's `.env` (and changing it everywhere when a password changes), store it once as a **Shared Variable** of the environment (or of the project, if it should apply to more than one environment) and reference it with `{{environment.KEY}}` in each application's `.env`.

Example, with a Postgres called "Orders DB" and a Redis called "Orders Queue", both in the same environment and server:

1. Copy the database's internal connection URL (*General* → Connection — it already has the right alias and port and, if the database is not public, does not require TLS from outside) and the Redis one.
2. Environment → Shared variables → new variable `DATABASE_URL` (scope *environment*) with that URL; another one, `REDIS_URL`, the same way.
3. In the API's and the worker's `.env`, instead of the literal URL:

   ```
   DATABASE_URL={{environment.DATABASE_URL}}
   REDIS_URL={{environment.REDIS_URL}}
   ```

4. Redeploy both. The panel expands the reference before writing the `.env` on the server — if the variable no longer exists, the deployment fails naming the missing key instead of starting with an empty string.

An app-to-app secret (for example a token the API signs and the worker verifies) follows the same path: one shared variable referenced on both sides, so changing the value happens in one place.

## 3. Scaling (more than one worker)

This is not an automatic pool — each "worker" you want to run in parallel is its own application (or, for Node/Bun, one process per core; see [scaling-node-apps.md](scaling-node-apps.md)). In that case sessions, cache and rate limits must live in a shared Redis, not in process memory, because each core is a separate process.

## 4. Things that are not automatic

- **Startup order.** The panel cannot express "wait for the database to be `healthy` before starting the API". Databases become healthy before accepting connections (the container healthcheck handles that), but if the API fails to connect in the first second it needs its own retry (most Postgres and Redis clients already do).
- **Moving a server.** Changing the server of an application or database puts it on a new network and server — the other resources of your microservice "cluster" stay on the old server. Move the whole set if you want them to keep seeing each other.
- **TLS between databases and apps.** Private databases (the default) expose no port to the outside, so the internal connection never crosses the internet. The internal URL uses the same TLS toggle as the database (Settings tab) — off by default, so the copied URL has no `sslmode=require`; if you turn TLS on, the internal URL starts requiring it too (Postgres validates the engine's own self-signed certificate).
