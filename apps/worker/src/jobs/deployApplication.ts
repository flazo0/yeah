import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { and, eq as eqOp, isNull, or } from "drizzle-orm";
import { applications, applicationVolumes, deployments, environments, registries, servers, sharedVariables, type Application, type Registry } from "@yeah/db";
import { connectSsh, execStream, writeRemoteFile, type Client } from "@yeah/ssh";
import { publishServerEvent, type ApplicationDeployJobData } from "@yeah/queue";
import { cloneUrlForRepo, getGithubConfig, getInstallationToken, upsertPullRequestComment } from "@yeah/github";
import { previewCommentBody, previewCommentMarker, registryExistsCommand, registryLoginCommand, registryLogoutCommand, registryTagLocalCommand, registryPushCommand, registryRef, registryTag, volumeFilePath } from "@yeah/shared";
import { buildPackUsesGit, composeProxyOverride, computeRouting, configSnapshot, traefikLabels, buildTimeEntries, expandReferences, parseEnvContent, renderRuntimeEnv, shellQuote, type SharedVariableValue } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import {
  buildCloneOrPullCommand,
  buildComposeUpCommand,
  COMPOSE_OVERRIDE_FILE,
  composeEnvFile,
  buildHealthWaitCommand,
  buildImageSteps,
  buildRunCommand,
  buildStopOldCommand,
  healthWaitSeconds,
  resolveDomain,
} from "./deployApplication.commands";

export { buildCloneOrPullCommand, buildRunCommand, resolveDomain } from "./deployApplication.commands";

interface Step {
  label: string;
  command: string;
  /** A non-zero exit code here doesn't abort the deploy (e.g. removing a container that may not exist). */
  allowFailure?: boolean;
}

export function makeDeployApplicationProcessor(publishConnection: Redis) {
  return async function deployApplication(job: Job<ApplicationDeployJobData>) {
    const { deploymentId } = job.data;

    const deploymentRows = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
    const deployment = deploymentRows[0];
    if (!deployment) {
      console.warn(`[worker] application-deploy: deployment ${deploymentId} not found, skipping`);
      return;
    }

    const appRows = await db.select().from(applications).where(eq(applications.id, deployment.applicationId)).limit(1);
    const application = appRows[0];
    if (!application) {
      await finish(deploymentId, "failed", "\n\x1b[31mAplicação não encontrada.\x1b[0m\n");
      return;
    }

    const serverRows = await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1);
    const server = serverRows[0];
    if (!server) {
      await finish(deploymentId, "failed", "\n\x1b[31mServidor não encontrado.\x1b[0m\n");
      return;
    }

    let log = "";
    const appendAndPublish = async (line: string) => {
      log += line;
      await publishServerEvent(publishConnection, { type: "deployment.log", deploymentId, line });
    };

    await db
      .update(deployments)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(deployments.id, deploymentId));
    await db.update(applications).set({ status: "deploying" }).where(eq(applications.id, application.id));
    await publishServerEvent(publishConnection, { type: "application.status", applicationId: application.id, status: "deploying" });
    await publishServerEvent(publishConnection, { type: "deployment.status", deploymentId, status: "running" });

    const appDir = `/opt/yeah-apps/${application.id}`;
    const repoDir = `${appDir}/repo`;
    const inlineDir = `${appDir}/inline`;
    const deployKeyPath = `${appDir}/.deploy_key`;
    const usesGit = buildPackUsesGit(application.buildPack);
    const imageRef = application.buildPack === "image" ? (application.dockerImage ?? "") : `yeah-app-${application.id}`;
    const containerName = `yeah-app-${application.id}`;
    const domain = resolveDomain(application, server);
    const volumes = await db.select().from(applicationVolumes).where(eq(applicationVolumes.applicationId, application.id));
    // Baseline for the "pending changes" banner: what this deploy runs with.
    await db
      .update(applications)
      .set({ deployedConfig: configSnapshot(application, volumes, (text) => createHash("sha256").update(text).digest("hex")) })
      .where(eq(applications.id, application.id));

    // A non-null commitSha at this point means this deployment was created as a rollback (see the
    // POST .../rollback route) — the row was pre-filled with a past deployment's resolved commit,
    // and checking that out instead of the branch HEAD is the entire rollback mechanism.
    const rollbackTarget = deployment.commitSha;
    // Built inside the try below: minting the GitHub token can throw (App uninstalled, GITHUB_APP_* missing),
    // and a throw out here would leave this deployment "running" forever instead of failing it.
    const makeCloneOrPullStep = async (): Promise<Step> => {
      // A GitHub App installation token is only valid for an hour, so it's minted fresh on every
      // deploy rather than stored — this also means access is revoked instantly if the App is uninstalled.
      let cloneUrl = application.repoUrl;
      if (application.githubInstallationId && application.githubRepo) {
        const config = getGithubConfig();
        if (!config) throw new Error("aplicação usa GitHub App, mas o servidor não tem GITHUB_APP_* configurado");
        const { token } = await getInstallationToken(config.appId, config.privateKey, application.githubInstallationId);
        cloneUrl = cloneUrlForRepo(token, application.githubRepo);
      }
      return {
        label: rollbackTarget
          ? `voltando pro commit ${rollbackTarget.slice(0, 7)}`
          : `clonando ${application.githubRepo ?? application.repoUrl} (${application.branch})`,
        // `set-url` before fetching re-authenticates every deploy — an installation token embedded
        // in a clone from an hour ago would otherwise make the next incremental pull fail.
        command: buildCloneOrPullCommand(appDir, cloneUrl, application.branch, rollbackTarget, application.deployKey ? deployKeyPath : null),
      };
    };
    const removeOldStep: Step = {
      label: `parando o container anterior (até ${application.stopGraceSeconds}s de tolerância)`,
      command: buildStopOldCommand(containerName, application.stopGraceSeconds),
      allowFailure: true,
    };
    const runStepDef: Step = {
      label: domain ? `subindo o container (https://${domain})` : "subindo o container",
      command: buildRunCommand(application, appDir, containerName, domain, volumes, imageRef),
    };

    const registry: Registry | null = application.registryId
      ? ((await db.select().from(registries).where(eqOp(registries.id, application.registryId)).limit(1))[0] ?? null)
      : null;

    let conn: Client | null = null;
    let resolvedCommit: string | null = null;
    try {
      conn = await connectSsh({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
      timeoutMs: server.sshTimeoutSeconds * 1000,
      });

      await appendAndPublish(`\x1b[90m# ${application.name} → ${server.name}\x1b[0m\n`);

      await runStep(conn, { label: "preparando diretório", command: `mkdir -p ${shellQuote(appDir)}` }, appendAndPublish);

      await appendAndPublish(`\x1b[36m$ escrevendo variáveis de ambiente\x1b[0m\n`);
      const { entries: envEntries, missing } = expandReferences(parseEnvContent(application.envContent), await loadSharedVariables(application));
      if (missing.length > 0) {
        throw new Error(`variável compartilhada não encontrada: ${missing.map((m) => `{{${m}}}`).join(", ")}`);
      }
      await writeRemoteFile(conn, `${appDir}/.env`, renderRuntimeEnv(envEntries));

      if (usesGit) {
        if (application.deployKey) {
          await appendAndPublish(`\x1b[36m$ escrevendo a deploy key\x1b[0m\n`);
          await writeRemoteFile(conn, deployKeyPath, application.deployKey.endsWith("\n") ? application.deployKey : `${application.deployKey}\n`);
          await execStream(conn, `chmod 600 ${shellQuote(deployKeyPath)}`, () => undefined);
        }

        await runStep(conn, await makeCloneOrPullStep(), appendAndPublish);

        let resolvedCommitSha = "";
        await execStream(conn, `cd ${shellQuote(repoDir)} && git rev-parse HEAD`, (chunk, stream) => {
          if (stream === "stdout") resolvedCommitSha += chunk;
        });
        resolvedCommitSha = resolvedCommitSha.trim();
        resolvedCommit = resolvedCommitSha || null;
        if (resolvedCommitSha) {
          await appendAndPublish(`\x1b[90m# commit ${resolvedCommitSha.slice(0, 7)}\x1b[0m\n`);
          await db.update(deployments).set({ commitSha: resolvedCommitSha }).where(eq(deployments.id, deploymentId));
        }
      } else if (application.buildPack === "dockerfile_inline") {
        await appendAndPublish(`\x1b[36m$ escrevendo o Dockerfile\x1b[0m\n`);
        await execStream(conn, `mkdir -p ${shellQuote(inlineDir)}`, () => undefined);
        await writeRemoteFile(conn, `${inlineDir}/Dockerfile`, application.dockerfileContent ?? "");
      }

      // "File" volumes: the content lives in the panel and is written to the server before the container mounts it.
      for (const volume of volumes.filter((v) => v.kind === "file" && application.buildPack !== "docker_compose")) {
        await appendAndPublish(`\x1b[36m$ escrevendo o arquivo ${volume.mountPath}\x1b[0m\n`);
        await execStream(conn, `mkdir -p ${shellQuote(`${appDir}/files`)} && rm -rf ${shellQuote(volumeFilePath(application.id, volume.id))}`, () => undefined);
        await writeRemoteFile(conn, volumeFilePath(application.id, volume.id), volume.fileContent ?? "");
      }

      if (application.buildPack === "docker_compose") {
        // The compose file may reference the variables ("env_file: .env" or ${VAR} interpolation).
        await writeRemoteFile(conn, `${repoDir}/.env`, composeEnvFile(envEntries));
        await writeRemoteFile(conn, `${appDir}/.env`, composeEnvFile(envEntries));
        let withOverride = false;
        if (domain && application.composeService) {
          await appendAndPublish(`\x1b[36m$ roteando ${application.composeService} pelo proxy (https://${domain})\x1b[0m\n`);
          await writeRemoteFile(conn, `${appDir}/${COMPOSE_OVERRIDE_FILE}`, composeProxyOverride(application.composeService, traefikLabels(containerName, computeRouting(domain, application.extraDomains, application.wwwRedirect), application.port)));
          withOverride = true;
        } else if (domain) {
          await appendAndPublish("\x1b[33m# há um domínio, mas nenhum serviço do compose foi escolhido pra recebê-lo — sem roteamento pelo proxy\x1b[0m\n");
        }
        await runStep(
          conn,
          {
            label: `subindo o projeto compose (${application.composeFile})`,
            command: buildComposeUpCommand(application, appDir, repoDir, withOverride, healthWaitSeconds(application)),
          },
          appendAndPublish,
        );
      } else {
      if (registry) {
        await appendAndPublish(`\x1b[36m$ entrando no registry ${registry.host}\x1b[0m\n`);
        const passwordFile = `${appDir}/.registry_pw`;
        await writeRemoteFile(conn, passwordFile, registry.password);
        await execStream(conn, `chmod 600 ${shellQuote(passwordFile)}`, () => undefined);
        await runStep(conn, { label: "docker login", command: registryLoginCommand(registry.host, registry.username, passwordFile) }, appendAndPublish);
      }
      const buildEnv = buildTimeEntries(envEntries);
      const buildSteps = buildImageSteps(application, repoDir, inlineDir, containerName, buildEnv);
      if (registry && application.registryImage && application.buildPack !== "image") {
        // Build once per commit (and build-time variables): a later deploy, a rollback or another server pulls instead.
        const variant = buildEnv.length ? createHash("sha256").update(JSON.stringify(buildEnv)).digest("hex").slice(0, 6) : undefined;
        const ref = registryRef(registry.host, application.registryImage, registryTag(resolvedCommit, deploymentId, variant));
        const cached = (await execStream(conn, registryExistsCommand(ref), () => undefined)).exitCode === 0;
        if (cached) {
          await runStep(conn, { label: `reusando a imagem já construída (${ref}) — sem build`, command: registryTagLocalCommand(ref, containerName) }, appendAndPublish);
        } else {
          for (const step of buildSteps) await runStep(conn, step, appendAndPublish);
          await runStep(conn, { label: `enviando a imagem pro registry (${ref})`, command: registryPushCommand(containerName, ref) }, appendAndPublish);
        }
      } else {
        for (const step of buildSteps) await runStep(conn, step, appendAndPublish);
      }
      await runStep(conn, removeOldStep, appendAndPublish);
      await runStep(conn, runStepDef, appendAndPublish);
      }
      if (application.healthPath && application.buildPack !== "docker_compose") {
        await runStep(
          conn,
          {
            label: `aguardando o healthcheck (${application.healthPath})`,
            command: buildHealthWaitCommand(containerName, healthWaitSeconds(application)),
          },
          appendAndPublish,
        );
      }

      await finish(deploymentId, "success", "\n\x1b[32mDeploy concluído.\x1b[0m\n", log);
      await db.update(applications).set({ status: "running" }).where(eq(applications.id, application.id));
      await publishServerEvent(publishConnection, { type: "application.status", applicationId: application.id, status: "running" });
      await publishServerEvent(publishConnection, { type: "deployment.status", deploymentId, status: "success" });
      await commentOnPreview(application, "ready", resolvedCommit);
      await notifyTeam(application.teamId, "deploy.success", `Deploy de ${application.name} concluído`, `${application.repoUrl} (${application.branch}) → ${server.name}`, "info");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendAndPublish(`\n\x1b[31mFalha no deploy: ${message}\x1b[0m\n`);
      await finish(deploymentId, "failed", "", log);
      await db.update(applications).set({ status: "error" }).where(eq(applications.id, application.id));
      await publishServerEvent(publishConnection, { type: "application.status", applicationId: application.id, status: "error" });
      await publishServerEvent(publishConnection, { type: "deployment.status", deploymentId, status: "failed" });
      await commentOnPreview(application, "failed", null);
      await notifyTeam(application.teamId, "deploy.failed", `Deploy de ${application.name} falhou`, message, "error");
    } finally {
      if (conn && registry) await execStream(conn, registryLogoutCommand(registry.host), () => undefined).catch(() => undefined);
      conn?.end();
    }
  };
}

async function runStep(
  conn: Client,
  step: Step,
  appendAndPublish: (line: string) => Promise<void>,
): Promise<void> {
  await appendAndPublish(`\x1b[36m$ ${step.label}\x1b[0m\n`);
  const result = await execStream(conn, step.command, (chunk) => {
    void appendAndPublish(chunk);
  });
  if (result.exitCode !== 0 && !step.allowFailure) {
    throw new Error(`"${step.label}" saiu com código ${result.exitCode}`);
  }
}

async function finish(deploymentId: string, status: "success" | "failed", trailer: string, log?: string) {
  const set: { status: "success" | "failed"; finishedAt: Date; log?: string } = {
    status,
    finishedAt: new Date(),
  };
  if (log !== undefined) set.log = log + trailer;
  await db.update(deployments).set(set).where(eq(deployments.id, deploymentId));
}

/** Shared variables an application may reference: its team's, its project's and its environment's. */
async function loadSharedVariables(application: Application): Promise<SharedVariableValue[]> {
  const [environment] = await db.select().from(environments).where(eqOp(environments.id, application.environmentId)).limit(1);
  const rows = await db
    .select()
    .from(sharedVariables)
    .where(
      and(
        eqOp(sharedVariables.teamId, application.teamId),
        or(
          eqOp(sharedVariables.scope, "team"),
          and(eqOp(sharedVariables.scope, "project"), eqOp(sharedVariables.projectId, environment?.projectId ?? "")),
          and(eqOp(sharedVariables.scope, "environment"), eqOp(sharedVariables.environmentId, application.environmentId)),
        ),
      ),
    );
  return rows.map((row) => ({ scope: row.scope, key: row.key, value: row.value }));
}

/** Tells the pull request where its preview is (or that it failed). Never fails the deploy itself. */
async function commentOnPreview(application: Application, state: "ready" | "failed", commit: string | null): Promise<void> {
  if (!application.previewOfId || !application.prNumber || !application.githubRepo || !application.githubInstallationId) return;
  try {
    const config = getGithubConfig();
    if (!config) return;
    const { token } = await getInstallationToken(config.appId, config.privateKey, application.githubInstallationId);
    const url = application.domain ? `https://${application.domain}` : "";
    await upsertPullRequestComment(token, application.githubRepo, application.prNumber, previewCommentMarker(application.previewOfId), previewCommentBody(application.previewOfId, state, url, commit));
  } catch (err) {
    console.error(`[worker] could not comment on PR #${application.prNumber} of ${application.githubRepo}: ${err instanceof Error ? err.message : err}`);
  }
}
