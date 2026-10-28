import { shellQuote } from "./shell";

// Host maintenance helpers: Docker images on a server and operating-system updates (apt). Pure command
// builders and parsers — whoever has the SSH connection runs them (API for on-demand, worker for the
// periodic check).

// ---------- Docker images ----------

export interface DockerImageInfo {
  /** Short image id (12 hex chars). */
  id: string;
  repository: string;
  tag: string;
  /** "repo:tag" or the short id when the image is untagged. */
  ref: string;
  size: string;
  created: string;
  /** Some container (running or stopped) was created from this image. */
  inUse: boolean;
}

/** One line per image (`IMG|…`) followed by one line per container's image id (`USED|sha256:…`). */
export function dockerImagesCommand(): string {
  return (
    "docker image ls -a --no-trunc --format 'IMG|{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedSince}}'; " +
    "docker ps -a -q | xargs -r docker inspect --format 'USED|{{.Image}}'"
  );
}

export function parseDockerImages(output: string): DockerImageInfo[] {
  const used = new Set<string>();
  const images: Omit<DockerImageInfo, "inUse">[] = [];
  const fullIds: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split("|");
    if (parts[0] === "USED" && parts[1]) used.add(parts[1].trim());
    if (parts[0] === "IMG" && parts.length >= 6) {
      const fullId = parts[1]!.trim();
      const repository = parts[2]!.trim();
      const tag = parts[3]!.trim();
      const id = fullId.replace(/^sha256:/, "").slice(0, 12);
      const untagged = repository === "<none>" || tag === "<none>";
      images.push({ id, repository, tag, ref: untagged ? id : `${repository}:${tag}`, size: parts[4]!.trim(), created: parts[5]!.trim() });
      fullIds.push(fullId);
    }
  }
  return images.map((image, i) => ({ ...image, inUse: used.has(fullIds[i]!) }));
}

/** An image reference (`repo/name:tag`, `repo@sha256:…`) or a short/full image id — nothing a shell could misread. */
export function isSafeImageRef(ref: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/.test(ref);
}

export function dockerImageRemoveCommand(ref: string): string {
  return `docker image rm ${shellQuote(ref)} 2>&1`;
}

// ---------- OS updates (apt) ----------

export interface PendingPackage {
  name: string;
  version: string;
  security: boolean;
  /** Updating it can restart services or the machine (kernel, Docker, SSH…). */
  risky: boolean;
}

export interface PatchStatus {
  updates: number;
  security: number;
  rebootRequired: boolean;
  packages: PendingPackage[];
}

/** Refreshes the package index and prints the upgradable list, then a REBOOT marker when the machine asks for one. */
export function patchCheckCommand(): string {
  return (
    "export DEBIAN_FRONTEND=noninteractive; (apt-get update -qq >/dev/null 2>&1 || true); " +
    "apt list --upgradable 2>/dev/null; if [ -f /var/run/reboot-required ]; then echo __REBOOT_REQUIRED__; fi"
  );
}

const RISKY_PACKAGE = /^(linux-(image|generic|headers|modules)|docker|containerd|runc|openssh|systemd|libc6|openssl)/;

export function parsePatchCheck(output: string): PatchStatus {
  const packages: PendingPackage[] = [];
  let rebootRequired = false;
  for (const line of output.split(/\r?\n/)) {
    if (line.includes("__REBOOT_REQUIRED__")) {
      rebootRequired = true;
      continue;
    }
    // `name/suite[,suite] version arch [upgradable from: old]`
    const m = /^([a-z0-9][a-z0-9+.-]*)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable/.exec(line);
    if (!m) continue;
    const name = m[1]!;
    packages.push({ name, version: m[3]!, security: /-security/.test(m[2]!), risky: RISKY_PACKAGE.test(name) });
  }
  return { updates: packages.length, security: packages.filter((p) => p.security).length, rebootRequired, packages };
}

/** Detached so a long upgrade survives the SSH session; progress goes to a log file. */
export function applyPatchesCommand(securityOnly: boolean): string {
  const upgrade = securityOnly
    ? "apt-get -y -o Dpkg::Options::=--force-confold install --only-upgrade $(apt list --upgradable 2>/dev/null | grep -- '-security' | cut -d/ -f1 | tr '\\n' ' ')"
    : "apt-get -y -o Dpkg::Options::=--force-confold upgrade";
  return `nohup sh -c ${shellQuote(`export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; ${upgrade}`)} >/var/log/yeah-patch.log 2>&1 </dev/null & echo started`;
}

/** Turns unattended security upgrades on/off through the standard Ubuntu/Debian apt configuration. */
export function autoSecurityUpdatesCommand(enabled: boolean): string {
  const value = enabled ? "1" : "0";
  const conf = `APT::Periodic::Update-Package-Lists "${value}";\nAPT::Periodic::Unattended-Upgrade "${value}";\n`;
  const install = enabled ? "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades >/dev/null 2>&1; " : "";
  return `${install}printf '%b' ${shellQuote(conf.replace(/\n/g, "\\n"))} > /etc/apt/apt.conf.d/20auto-upgrades && echo ok`;
}

/** Reads back whether automatic security upgrades are on. */
export function autoSecurityUpdatesStatusCommand(): string {
  return "grep -qs 'Unattended-Upgrade \"1\"' /etc/apt/apt.conf.d/20auto-upgrades && echo on || echo off";
}
