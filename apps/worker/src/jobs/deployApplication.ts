import { eq } from "drizzle-orm";
import { applications, applicationVolumes, deployments, servers, type Application } from "@yeah/db";
import { connectSsh, execStream, writeRemoteFile, type Client } from "@yeah/ssh";
import { publishServerEvent, type ApplicationDeployJobData } from "@yeah/queue";
import { cloneUrlForRepo, getGithubConfig, getInstallationToken } from "@yeah/github";
import { buildPackUsesGit, shellQuote } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import {
  buildCloneOrPullCommand,
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

    // A GitHub App installation token is only valid for an hour, so it's minted fresh on every
    // deploy rather than stored — this also means access is revoked instantly if the App is uninstalled.
    let cloneUrl = application.repoUrl;
    if (application.githubInstallationId && application.githubRepo) {
      const config = getGithubConfig();
      if (!config) throw new Error("aplicação usa GitHub App, mas o servidor não tem GITHUB_APP_* configurado");
      const { token } = await getInstallationToken(config.appId, config.privateKey, application.githubInstallationId);
      cloneUrl = cloneUrlForRepo(token, application.githubRepo);
    }

    // A non-null commitSha at this point means this deployment was created as a rollback (see the
    // POST .../rollback route) — the row was pre-filled with a past deployment's resolved commit,
    // and checking that out instead of the branch HEAD is the entire rollback mechanism.
    const rollbackTarget = deployment.commitSha;
    const cloneOrPullStep: Step = {
      label: rollbackTarget
        ? `voltando pro commit ${rollbackTarget.slice(0, 7)}`
        : `clonando ${application.githubRepo ?? application.repoUrl} (${application.branch})`,
      // `set-url` before fetching re-authenticates every deploy — an installation token embedded
      // in a clone from an hour ago would otherwise make the next incremental pull fail.
      command: buildCloneOrPullCommand(appDir, cloneUrl, application.branch, rollbackTarget, application.deployKey ? deployKeyPath : null),
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

    let conn: Client | null = null;
    try {
      conn = await connectSsh({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
      });

      await appendAndPublish(`\x1b[90m# ${application.name} → ${server.name}\x1b[0m\n`);

      await runStep(conn, { label: "preparando diretório", command: `mkdir -p ${shellQuote(appDir)}` }, appendAndPublish);

      await appendAndPublish(`\x1b[36m$ escrevendo variáveis de ambiente\x1b[0m\n`);
      await writeRemoteFile(conn, `${appDir}/.env`, application.envContent);

      if (usesGit) {
        if (application.deployKey) {
          await appendAndPublish(`\x1b[36m$ escrevendo a deploy key\x1b[0m\n`);
          await writeRemoteFile(conn, deployKeyPath, application.deployKey.endsWith("\n") ? application.deployKey : `${application.deployKey}\n`);
          await execStream(conn, `chmod 600 ${shellQuote(deployKeyPath)}`, () => undefined);
        }

        await runStep(conn, cloneOrPullStep, appendAndPublish);

        let resolvedCommitSha = "";
        await execStream(conn, `cd ${shellQuote(repoDir)} && git rev-parse HEAD`, (chunk, stream) => {
          if (stream === "stdout") resolvedCommitSha += chunk;
        });
        resolvedCommitSha = resolvedCommitSha.trim();
        if (resolvedCommitSha) {
          await appendAndPublish(`\x1b[90m# commit ${resolvedCommitSha.slice(0, 7)}\x1b[0m\n`);
          await db.update(deployments).set({ commitSha: resolvedCommitSha }).where(eq(deployments.id, deploymentId));
        }
      } else if (application.buildPack === "dockerfile_inline") {
        await appendAndPublish(`\x1b[36m$ escrevendo o Dockerfile\x1b[0m\n`);
        await execStream(conn, `mkdir -p ${shellQuote(inlineDir)}`, () => undefined);
        await writeRemoteFile(conn, `${inlineDir}/Dockerfile`, application.dockerfileContent ?? "");
      }

      for (const step of buildImageSteps(application, repoDir, inlineDir, containerName)) {
        await runStep(conn, step, appendAndPublish);
      }
      await runStep(conn, removeOldStep, appendAndPublish);
      await runStep(conn, runStepDef, appendAndPublish);
      if (application.healthPath) {
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
      await notifyTeam(application.teamId, "deploy.success", `Deploy de ${application.name} concluído`, `${application.repoUrl} (${application.branch}) → ${server.name}`, "info");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendAndPublish(`\n\x1b[31mFalha no deploy: ${message}\x1b[0m\n`);
      await finish(deploymentId, "failed", "", log);
      await db.update(applications).set({ status: "error" }).where(eq(applications.id, application.id));
      await publishServerEvent(publishConnection, { type: "application.status", applicationId: application.id, status: "error" });
      await publishServerEvent(publishConnection, { type: "deployment.status", deploymentId, status: "failed" });
      await notifyTeam(application.teamId, "deploy.failed", `Deploy de ${application.name} falhou`, message, "error");
    } finally {
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
