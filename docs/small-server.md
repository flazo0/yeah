# Running many projects on a small server

Target: one VPS with **1 vCPU, 4 GB of RAM and 50 GB of disk** (the smallest plan of most providers) running the panel and around **50 projects**. This page says what fits, what does not, and which settings make the difference. Numbers marked *measured* come from running the code; the rest are estimates and are called out as such.

## The budget

| Item | Memory |
|---|---|
| Operating system, Docker daemon, page cache floor | ~300 MB (estimate) |
| Traefik proxy + the waker | ~100 MB (estimate) |
| The panel (API, worker, WebSocket, web, PostgreSQL, Redis) | ~200 MB idle (*measured* as local processes: API 63 MB, worker 40 MB, ws 10 MB, PostgreSQL 54 MB, Redis 6 MB). Not yet measured in the production containers on a real VPS |
| **Reserved for the system and the panel** | **768 MB**, the figure the *Capacity* card uses |
| Left for projects | ~3.3 GB |

3.3 GB shared by 50 projects is **about 66 MB each**. That works for static sites, small Node/Go/Python services and idle tools, and does not work if many of them are Rails, Django with workers, Java or anything that idles above 150 MB. So the answer to "do 50 fit" is: yes if most are light or asleep, no if they are all busy and heavy. The settings below are how you make that true.

## What to set

1. **A memory limit on every application and service** (*General → Resource limits*). 64 to 128 MB suits a small app. The server's *Metrics → Capacity* card adds the limits up against the RAM and tells you when they promise more than the server has. Limits are ceilings, so a total above 100% can work when most things idle, but a burst by several at once is what makes a small server swap or kill processes.
2. **Sleep when idle** for low-traffic projects. A sleeping application uses no memory and wakes on the next request (about 0.25 s when the image is local, *measured*). This is what lets 50 projects share 3 GB.
3. **The memory guard** (*Server → Metrics*). When RAM stays above the threshold it stops the least important application first (priority *Low*, then *Normal*; *Critical* and databases are never stopped) and starts it again once memory recovers. Give your production projects *Critical* and your experiments *Low*.
4. **Do not build on the small server.** A build of a real application on 1 vCPU can take 1 to 2 GB and all of the CPU, and every other project slows down meanwhile. Build elsewhere (an application can use a different *build server*, or push an image from CI and deploy it as a Docker image). Builds already run one at a time per queue.
5. **Backups go to S3.** Database backups and restores are streamed: the worker's memory stays flat whatever the size of the dump. *Measured* against a real SFTP server and a real S3 API: sending a 200 MB file to S3 grew the process by 25 MB, and restoring a 400 MB backup from S3 to the server grew it by 31 MB, at about 27 MB/s. A local copy on a 50 GB disk adds up quickly.
6. **Polling cost.** The metrics check runs `docker stats` once a minute per server, which costs a few percent of one CPU with dozens of containers. Set `METRICS_INTERVAL_SECONDS=120` in `.env` when the server has more than about 30 containers.
7. **Swap.** Add 2 GB of swap on the VPS (`fallocate -l 2G /swapfile`, `mkswap`, `swapon`) and a low `vm.swappiness`. It turns an out-of-memory kill into a slow moment. This is a change on your server, so yeah does not do it for you.

## Disk (50 GB)

- Container logs are rotated at 10 MB x 3 per container: 50 containers use at most 1.5 GB.
- The automatic Docker cleanup (daily, and immediately when the disk passes 85%) removes unused images, stopped containers and build cache older than 72 hours.
- *Rollback images to keep* is **0 by default**. Each kept image is a few hundred MB per application: keep it at 0 or 1 here.
- Metrics history is kept for 7 days (`container_metric_samples` grows by one row per resource per minute: about 500,000 rows for 50 resources).

## What the production compose does for you

`docker-compose.prod.yml` is sized for this host: PostgreSQL runs with `shared_buffers=64MB` and `max_connections=50` (the panel opens at most about 18), Redis is capped at 128 MB, each service has a pool of 6 database connections (`DB_POOL_MAX`) and every container has a memory ceiling (about 1.5 GB in total when everything is at its limit, far less in practice). Raise `POSTGRES_SHARED_BUFFERS` and `POSTGRES_MEMORY_LIMIT` on a larger machine.

## What is not verified

- Nothing here has been benchmarked on a real 1 vCPU / 4 GB VPS with 50 running projects. The budget above is arithmetic plus local measurements. If you run it, the numbers worth sharing are the idle memory of each panel container (`docker stats`), the load average during a metrics check, and how the memory guard behaves when you push the server over its threshold.
- The streaming backups were tested with generated files against a real SSH server and a real S3 API (MinIO) from a development machine, not with a production database dump. Backup downloads through the API (`remoteFileResponse`) use the same read path but were not measured separately.
