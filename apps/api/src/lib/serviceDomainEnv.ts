import type { StackDomain } from "@yeah/shared";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const LINE = /^(SERVICE_(FQDN|URL)_([A-Z0-9_]+?)(?:_(\d+))?)=(.*)$/;

/**
 * Templates imported from Coolify read the public address of a container from `SERVICE_FQDN_<SERVICE>` /
 * `SERVICE_URL_<SERVICE>` (optionally with a `_<PORT>` suffix). Whenever the domains of a stack are saved,
 * those variables follow: the FQDN becomes the bare host and the URL `https://host`. A service with no
 * domain keeps whatever the variable already holds. Lines that are not such variables pass through untouched.
 */
export function syncDomainEnv(envContent: string, domains: StackDomain[]): string {
  if (domains.length === 0) return envContent;
  return envContent
    .split("\n")
    .map((line) => {
      const m = LINE.exec(line);
      if (!m) return line;
      const [, name, kind, svc, port] = m;
      const own = domains.filter((d) => norm(d.service) === norm(svc!));
      if (own.length === 0) return line;
      const pick = (port ? own.find((d) => String(d.port) === port) : undefined) ?? own[0]!;
      return `${name}=${kind === "FQDN" ? pick.domain : `https://${pick.domain}`}`;
    })
    .join("\n");
}
