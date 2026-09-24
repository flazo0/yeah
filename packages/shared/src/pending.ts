// "Pending changes": which settings differ from what the last deploy ran with. The worker stores a
// snapshot of these fields when a deploy starts; the API compares it with the current row.

/** The application fields that only take effect on the next deploy, with the label the UI shows. */
export const DEPLOY_AFFECTING_FIELDS = {
  repoUrl: "Repositório",
  branch: "Branch",
  githubRepo: "Repositório do GitHub",
  buildPack: "Build pack",
  dockerImage: "Imagem",
  dockerfileContent: "Dockerfile",
  publishDirectory: "Pasta publicada",
  composeFile: "Arquivo compose",
  composeService: "Serviço do compose",
  serverId: "Servidor",
  port: "Porta",
  domain: "Domínio",
  extraDomains: "Domínios adicionais",
  wwwRedirect: "Redirect www",
  envContent: "Variáveis de ambiente",
  healthPath: "Healthcheck (caminho)",
  healthIntervalSeconds: "Healthcheck (intervalo)",
  healthTimeoutSeconds: "Healthcheck (timeout)",
  healthRetries: "Healthcheck (tentativas)",
  healthStartPeriodSeconds: "Healthcheck (período de início)",
  dockerOptions: "Opções do Docker",
  stopGraceSeconds: "Tolerância de parada",
  memoryLimitMb: "Limite de memória",
  cpuLimit: "Limite de CPU",
  volumes: "Armazenamento persistente",
} as const;

export type DeployAffectingField = keyof typeof DEPLOY_AFFECTING_FIELDS;

/** Secrets and long text are stored as a digest so the snapshot itself leaks nothing. */
const DIGESTED: DeployAffectingField[] = ["envContent", "dockerfileContent"];

export type ConfigSnapshot = Partial<Record<DeployAffectingField, string>>;

/**
 * Builds the snapshot from an application row plus its volume list. `digest` is injected (sha-256 on
 * the server) so this file has no runtime dependency and stays usable everywhere.
 */
export function configSnapshot(
  app: Record<string, unknown>,
  volumes: Array<{ name: string; mountPath: string }>,
  digest: (text: string) => string,
): ConfigSnapshot {
  const snapshot: ConfigSnapshot = {};
  for (const field of Object.keys(DEPLOY_AFFECTING_FIELDS) as DeployAffectingField[]) {
    let value: unknown;
    if (field === "volumes") {
      value = volumes
        .map((v) => `${v.name}:${v.mountPath}`)
        .sort()
        .join(",");
    } else if (field === "extraDomains") {
      value = Array.isArray(app.extraDomains) ? [...(app.extraDomains as string[])].sort().join(",") : "";
    } else {
      value = app[field];
    }
    const text = value === null || value === undefined ? "" : String(value);
    snapshot[field] = DIGESTED.includes(field) ? digest(text) : text;
  }
  return snapshot;
}

/** Labels of the fields whose value changed since `deployed`. null when the app has never been deployed. */
export function pendingChanges(deployed: ConfigSnapshot | null | undefined, current: ConfigSnapshot): string[] | null {
  if (!deployed) return null;
  const changed: string[] = [];
  for (const field of Object.keys(DEPLOY_AFFECTING_FIELDS) as DeployAffectingField[]) {
    // A field the old snapshot never knew about (added later) is not a change.
    if (deployed[field] === undefined) continue;
    if (deployed[field] !== current[field]) changed.push(DEPLOY_AFFECTING_FIELDS[field]);
  }
  return changed;
}
