import { createHash, randomBytes } from "node:crypto";
import { parseDockerOptions } from "@yeah/shared";

/** "[skip ci]" / "[skip cd]" (and the reversed spellings) in a commit message skip the auto-deploy of that push. */
export function shouldSkipDeploy(message: string | undefined | null): boolean {
  if (!message) return false;
  return /\[(skip|no) (ci|cd)\]|\[(ci|cd) skip\]/i.test(message);
}

export function generateDeployToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashDeployToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AdvancedSettingsInput {
  healthPath?: string | null;
  healthIntervalSeconds: number;
  healthTimeoutSeconds: number;
  healthRetries: number;
  healthStartPeriodSeconds: number;
  dockerOptions: string;
  stopGraceSeconds: number;
}

/** Returns an error message for the first invalid field, or null when the settings are acceptable. */
export function validateAdvancedSettings(input: AdvancedSettingsInput): string | null {
  const path = input.healthPath?.trim();
  if (path && !/^\/[^\s'"`$;&|<>\\]*$/.test(path)) {
    return "o caminho do healthcheck precisa começar com / e não pode ter espaços ou caracteres especiais de shell";
  }
  const ranges: Array<[string, number, number, number]> = [
    ["intervalo do healthcheck", input.healthIntervalSeconds, 1, 3600],
    ["timeout do healthcheck", input.healthTimeoutSeconds, 1, 300],
    ["tentativas do healthcheck", input.healthRetries, 1, 20],
    ["período de início do healthcheck", input.healthStartPeriodSeconds, 0, 3600],
    ["tolerância de parada", input.stopGraceSeconds, 0, 600],
  ];
  for (const [label, value, min, max] of ranges) {
    if (!Number.isInteger(value) || value < min || value > max) return `${label} precisa ser um inteiro entre ${min} e ${max}`;
  }
  const options = parseDockerOptions(input.dockerOptions);
  if (!options.ok) return options.error;
  return null;
}
