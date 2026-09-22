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
 * The platform update rebuilds and restarts the very containers (api/worker/ws/web) running the
 * job that issues this command — including the worker process holding the SSH connection. So it
 * launches detached (nohup + disown, output redirected to a log file on the host) and returns
 * almost immediately; a separate poll tick reconnects fresh each time to read the log file's
 * growth and check for a completion marker, surviving the exact worker restart it's waiting for.
 */
export function buildLaunchCommand(): string {
  const inner =
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
