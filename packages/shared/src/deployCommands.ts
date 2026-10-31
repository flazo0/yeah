import { shellQuote } from "./shell";

// Commands that run around a deployment: a pre-deploy command (database migrations, say) and a post-deploy one.
//
// Pre-deploy runs BEFORE the previous container is stopped, in a throwaway container made from the new image
// with the application's variables, network and volumes. If it fails the deploy stops there and the old version
// keeps serving. Post-deploy runs inside the new container once it is healthy; a failure is logged but does not
// fail the deployment (the new version is already live and cannot be undone from here).

export const DEPLOY_COMMAND_MAX_LENGTH = 1000;
/** Seconds either command may run before it is killed. */
export const DEPLOY_COMMAND_TIMEOUT_SECONDS = 600;

/** A command as typed in the panel: trimmed, one line, no control characters. Empty means "none". */
export function normalizeDeployCommand(input: string | null | undefined): { ok: true; command: string | null } | { ok: false; error: string } {
  const command = (input ?? "").trim();
  if (command === "") return { ok: true, command: null };
  if (command.length > DEPLOY_COMMAND_MAX_LENGTH) return { ok: false, error: `a command can be at most ${DEPLOY_COMMAND_MAX_LENGTH} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(command)) return { ok: false, error: "write the command on one line (chain steps with && or ;)" };
  return { ok: true, command };
}

export interface PreDeployContext {
  applicationId: string;
  /** The image the new version runs from. */
  imageRef: string;
  envFile: string;
  network: string;
  /** Extra `docker run` flags that mirror the application: resource limits and volumes. */
  mirrorFlags: string;
}

export function preDeployContainerName(applicationId: string): string {
  return `yeah-predeploy-${applicationId}`;
}

/**
 * `docker run --rm` of the new image with the shell as entrypoint (an image's own ENTRYPOINT would otherwise
 * receive "sh -c ..." as arguments). A timeout kills the client but not the container, so it is removed by name
 * whenever the command does not succeed. Exits with the command's own status.
 */
export function buildPreDeployCommand(command: string, c: PreDeployContext): string {
  const name = shellQuote(preDeployContainerName(c.applicationId));
  return (
    `docker rm -f ${name} >/dev/null 2>&1; ` +
    `timeout ${DEPLOY_COMMAND_TIMEOUT_SECONDS} docker run --rm --name ${name} --env-file ${shellQuote(c.envFile)} --network ${shellQuote(c.network)} ` +
    `${c.mirrorFlags}--entrypoint sh ${shellQuote(c.imageRef)} -c ${shellQuote(command)}; rc=$?; ` +
    `if [ "$rc" -ne 0 ]; then docker rm -f ${name} >/dev/null 2>&1; fi; exit $rc`
  );
}

/** Runs the command inside the already running new container. */
export function buildPostDeployCommand(command: string, containerName: string): string {
  return `timeout ${DEPLOY_COMMAND_TIMEOUT_SECONDS} docker exec ${shellQuote(containerName)} sh -c ${shellQuote(command)}`;
}
