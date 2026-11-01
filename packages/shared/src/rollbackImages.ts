import { shellQuote } from "./shell";
import { parseDockerImages, type DockerImageInfo } from "./serverOps";

// Rollback to a Docker image still on the server. When an application keeps rollback images (a retention
// count above 0), every successful deploy also tags its image `yeah-app-<appId>:dep-<12 hex of the deployment id>`.
// Everything here is a pure command builder or parser; the API and the worker run the commands over SSH.

/** Upper bound of the per-application retention setting. */
export const MAX_ROLLBACK_IMAGES = 20;

/** Error message for an invalid retention count, or null. 0 = off (the default). */
export function validateRollbackImages(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ROLLBACK_IMAGES) {
    return `the number of rollback images must be an integer between 0 and ${MAX_ROLLBACK_IMAGES}`;
  }
  return null;
}

/** The local repository name the application's image is built under (and the container is named). */
export function appImageRepository(applicationId: string): string {
  return `yeah-app-${applicationId}`;
}

export function deploymentImageTag(deploymentId: string): string {
  return `dep-${deploymentId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
}

export function deploymentImageRef(applicationId: string, deploymentId: string): string {
  return `${appImageRepository(applicationId)}:${deploymentImageTag(deploymentId)}`;
}

/** Tags the freshly built image (the run name) with the deployment's own tag. */
export function tagDeploymentImageCommand(applicationId: string, deploymentId: string): string {
  return `docker tag ${shellQuote(appImageRepository(applicationId))} ${shellQuote(deploymentImageRef(applicationId, deploymentId))}`;
}

/** Exit 0 when the image exists locally. */
export function imageExistsCommand(ref: string): string {
  return `docker image inspect ${shellQuote(ref)} >/dev/null 2>&1`;
}

export interface AppImage {
  id: string;
  ref: string;
  tag: string;
  size: string;
  created: string;
  /** The tag is a deployment tag (`dep-...`), as opposed to the plain run name (`latest`). */
  deploymentTag: string | null;
  /** The running container was created from this image. */
  running: boolean;
}

/** Lists the images of one application (every tag) and the image id its container runs. */
export function appImagesCommand(applicationId: string): string {
  const repo = shellQuote(appImageRepository(applicationId));
  return (
    `docker image ls -a --no-trunc --filter ${shellQuote(`reference=${appImageRepository(applicationId)}`)} ` +
    "--format 'IMG|{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedSince}}'; " +
    `docker inspect --format 'RUN|{{.Image}}' ${repo} 2>/dev/null || true`
  );
}

/** Parses `appImagesCommand` output. Rows of other repositories are ignored. */
export function parseAppImages(output: string, applicationId: string): AppImage[] {
  const repo = appImageRepository(applicationId);
  const running = new Set<string>();
  const fullIds: string[] = [];
  const imgLines: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split("|");
    if (parts[0] === "RUN" && parts[1]) running.add(parts[1].trim());
    if (parts[0] === "IMG" && parts.length >= 6 && parts[2]!.trim() === repo) {
      imgLines.push(line);
      fullIds.push(parts[1]!.trim());
    }
  }
  return parseDockerImages(imgLines.join("\n")).map(
    (info, i): AppImage => ({
      id: info.id,
      ref: info.ref,
      tag: info.tag,
      size: info.size,
      created: info.created,
      deploymentTag: /^dep-[0-9a-f]{12}$/.test(info.tag) ? info.tag : null,
      running: running.has(fullIds[i]!),
    }),
  );
}

export interface DeploymentLike {
  id: string;
  status: string;
  commitSha: string | null;
  createdAt: string;
}

export interface RollbackImageEntry extends AppImage {
  deploymentId: string | null;
  commitSha: string | null;
  deploymentCreatedAt: string | null;
}

/**
 * Pairs each deployment-tagged image with the deployment that built it. Images whose deployment is no
 * longer in the list stay (deploymentId null) so they remain visible; the plain run name is dropped
 * when a deployment tag already points at the same image. Newest deployment first.
 */
export function matchImagesToDeployments(images: AppImage[], deployments: DeploymentLike[]): RollbackImageEntry[] {
  const byTag = new Map<string, DeploymentLike>();
  for (const d of deployments) byTag.set(deploymentImageTag(d.id), d);
  const taggedIds = new Set(images.filter((i) => i.deploymentTag).map((i) => i.id));
  const entries: RollbackImageEntry[] = [];
  for (const image of images) {
    if (!image.deploymentTag) {
      if (taggedIds.has(image.id)) continue;
      entries.push({ ...image, deploymentId: null, commitSha: null, deploymentCreatedAt: null });
      continue;
    }
    const d = byTag.get(image.deploymentTag);
    entries.push({ ...image, deploymentId: d?.id ?? null, commitSha: d?.commitSha ?? null, deploymentCreatedAt: d?.createdAt ?? null });
  }
  return entries.sort((a, b) => (b.deploymentCreatedAt ?? "").localeCompare(a.deploymentCreatedAt ?? ""));
}

/** The deployments whose images must be kept: the newest `keep` successful ones. */
export function deploymentsToRetain(deployments: DeploymentLike[], keep: number): DeploymentLike[] {
  if (keep <= 0) return [];
  return deployments
    .filter((d) => d.status === "success")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, keep);
}

/** Deployment tags present on the server that are no longer among the retained ones. */
export function staleDeploymentRefs(images: AppImage[], retained: DeploymentLike[]): string[] {
  const keepTags = new Set(retained.map((d) => deploymentImageTag(d.id)));
  return images.filter((i) => i.deploymentTag && !keepTags.has(i.deploymentTag)).map((i) => i.ref);
}

/** `docker image rm` of several tags; keeps going past failures. Null when there is nothing to remove. */
export function removeRefsCommand(refs: string[]): string | null {
  if (refs.length === 0) return null;
  return `docker image rm ${refs.map(shellQuote).join(" ")} >/dev/null 2>&1 || true`;
}

/**
 * What a cleanup with image pruning may delete while some images are protected: unused images none of
 * whose tags is protected. Returns short image ids. Replaces the image step of `docker system prune -a`.
 */
export function selectImagesToRemove(images: DockerImageInfo[], protectedRefs: Set<string>): string[] {
  const protectedIds = new Set(images.filter((i) => protectedRefs.has(i.ref)).map((i) => i.id));
  const inUseIds = new Set(images.filter((i) => i.inUse).map((i) => i.id));
  const ids = new Set<string>();
  for (const image of images) {
    if (inUseIds.has(image.id) || protectedIds.has(image.id)) continue;
    ids.add(image.id);
  }
  return [...ids];
}
