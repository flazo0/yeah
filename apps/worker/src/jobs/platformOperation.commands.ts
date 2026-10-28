import { shellQuote } from "@yeah/shared";

// Pure command-building logic lives in its own file, separate from platformOperation.ts's actual
// SSH execution — same rationale as deployApplication.commands.ts: importing @yeah/ssh pulls in
// ssh2's module-level side effects, which destabilizes bun:test when multiple test files share a
// process, and makes this logic awkward to unit test in isolation.

export const OK_MARKER = "===YEAH_OP_OK===";
export const FAIL_MARKER = "===YEAH_OP_FAILED===";
export const REMOTE_LOG_PATH = "/opt/yeah/.update.log";

// Runs synchronously in the job that issues it — apt upgrading the host doesn't touch yeah's own
// containers, so nothing here can kill the connection running it.
export const SYSTEM_UPDATE_COMMAND =
  "export DEBIAN_FRONTEND=noninteractive && " +
  "apt-get update -qq && apt-get upgrade -y -qq && apt-get autoremove -y -qq";

/**
 * Runs before an update: refuses to start with the disk almost full (an interrupted image build can leave
 * the panel half-updated) and takes a compressed pg_dump of the panel database, keeping the last five
 * in /root/yeah-backups. Either can be skipped with `YEAH_SKIP_DISK_CHECK=1` / `YEAH_BACKUP_BEFORE_UPDATE=0`.
 * A subshell, so its `exit 1` only fails this step and the caller falls to the FAILED marker.
 */
export const PRE_UPDATE_GUARD =
  "(" +
  "set -o pipefail; " +
  "used=$(df --output=pcent / | tail -1 | tr -dc 0-9); " +
  "if [ \"${YEAH_SKIP_DISK_CHECK:-0}\" != 1 ] && [ \"${used:-0}\" -ge 92 ]; then echo \"ATUALIZAÇÃO CANCELADA: o disco está em ${used}%. Libere espaço (limpeza do Docker) ou use YEAH_SKIP_DISK_CHECK=1.\"; exit 1; fi; " +
  "if [ \"${YEAH_BACKUP_BEFORE_UPDATE:-1}\" != 0 ]; then " +
  "PGU=$(grep -E \"^POSTGRES_USER=\" .env | cut -d= -f2-); PGD=$(grep -E \"^POSTGRES_DB=\" .env | cut -d= -f2-); " +
  "mkdir -p /root/yeah-backups; f=/root/yeah-backups/yeah-$(date +%Y%m%d-%H%M%S).sql.gz; " +
  "if docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres pg_dump -U \"${PGU:-yeah}\" \"${PGD:-yeah}\" < /dev/null | gzip > \"$f\" && [ -s \"$f\" ]; then " +
  "echo \"backup do banco salvo em $f\"; ls -1t /root/yeah-backups/yeah-*.sql.gz | tail -n +6 | xargs -r rm -f; " +
  "else rm -f \"$f\"; echo \"ATUALIZAÇÃO CANCELADA: não foi possível fazer o backup do banco. Use YEAH_BACKUP_BEFORE_UPDATE=0 para pular.\"; exit 1; fi; fi " +
  ")";

/**
 * The platform update rebuilds and restarts the very containers (api/worker/ws/web) running the
 * job that issues this command — including the worker process holding the SSH connection. So it
 * launches detached (nohup + disown, output redirected to a log file on the host) and returns
 * almost immediately; a separate poll tick reconnects fresh each time to read the log file's
 * growth and check for a completion marker, surviving the exact worker restart it's waiting for.
 */
export function buildLaunchCommand(): string {
  const inner =
    `${PRE_UPDATE_GUARD} && ` +
    "git fetch --quiet origin && git reset --hard --quiet origin/main && " +
    "export YEAH_COMMIT=$(git rev-parse HEAD) && " +
    "docker compose -f docker-compose.prod.yml --env-file .env up -d --build && " +
    "docker compose -f docker-compose.prod.yml --env-file .env run --rm api bun run --cwd ../../packages/db db:migrate < /dev/null " +
    `&& echo ${shellQuote(OK_MARKER)} || echo ${shellQuote(FAIL_MARKER)}`;
  return (
    `cd /opt/yeah && rm -f ${shellQuote(REMOTE_LOG_PATH)} && ` +
    `nohup bash -c ${shellQuote(inner)} > ${shellQuote(REMOTE_LOG_PATH)} 2>&1 < /dev/null & disown; echo LAUNCHED`
  );
}

export function buildLogTailCommand(): string {
  return `cat ${shellQuote(REMOTE_LOG_PATH)} 2>/dev/null || true`;
}
