import { shellQuote, volumeName, volumeFilePath } from "@yeah/shared";

// Archiving and restoring a persistent volume of an application — pure command strings.

/** The helper image used to read/write a docker volume (any image with tar and sh will do). */
export const VOLUME_HELPER_IMAGE = "alpine:latest";
export const KEEP_VOLUME_BACKUPS = 5;

export const volumeBackupsDir = (ownerId: string) => `/opt/yeah-backups/volumes/${ownerId}`;

export interface VolumeSource {
  kind: "volume" | "bind" | "file";
  id: string;
  hostPath: string | null;
  applicationId: string;
}

export function volumeArchiveName(volumeId: string, timestamp = Date.now()): string {
  return `vol-${volumeId.slice(0, 8)}-${timestamp}.tar.gz`;
}

/** Writes a tar.gz of the volume's contents to `archivePath` (a path on the server). */
export function buildVolumeBackupCommand(source: VolumeSource, archivePath: string): string {
  const out = shellQuote(archivePath);
  if (source.kind === "bind") {
    if (!source.hostPath) throw new Error("volume sem diretório do servidor");
    return `tar -czf ${out} -C ${shellQuote(source.hostPath)} .`;
  }
  if (source.kind === "file") {
    const file = volumeFilePath(source.applicationId, source.id);
    return `tar -czf ${out} -C ${shellQuote(file.slice(0, file.lastIndexOf("/")))} ${shellQuote(file.slice(file.lastIndexOf("/") + 1))}`;
  }
  // A named volume: mounted read-only into a throw-away container that streams a tar to the archive file.
  return (
    `docker run --rm -v ${shellQuote(volumeName(source.id))}:/data:ro ${VOLUME_HELPER_IMAGE} tar -czf - -C /data . > ${out}`
  );
}

export interface RestoreCommands {
  /** Stops whatever uses the volume so nothing writes while it is replaced. */
  stop: string;
  replace: string;
  start: string;
}

/** Replaces the volume's contents with the archive; the application container is stopped around it. */
export function buildVolumeRestoreCommands(source: VolumeSource, archivePath: string, containerName: string): RestoreCommands {
  const stop = `docker stop ${shellQuote(containerName)} >/dev/null 2>&1 || true`;
  const start = `docker start ${shellQuote(containerName)} >/dev/null 2>&1 || true`;
  const archive = shellQuote(archivePath);
  if (source.kind === "bind") {
    if (!source.hostPath) throw new Error("volume sem diretório do servidor");
    const dir = shellQuote(source.hostPath);
    return { stop, replace: `mkdir -p ${dir} && find ${dir} -mindepth 1 -delete && tar -xzf ${archive} -C ${dir}`, start };
  }
  if (source.kind === "file") {
    const file = volumeFilePath(source.applicationId, source.id);
    return { stop, replace: `tar -xzf ${archive} -C ${shellQuote(file.slice(0, file.lastIndexOf("/")))}`, start };
  }
  return {
    stop,
    replace:
      `docker run --rm -v ${shellQuote(volumeName(source.id))}:/data -v ${archive}:/backup.tar.gz:ro ${VOLUME_HELPER_IMAGE} ` +
      `sh -c 'find /data -mindepth 1 -delete && tar -xzf /backup.tar.gz -C /data'`,
    start,
  };
}

// ---- named volumes of a service stack (compose project) ----

/** Archive name for a stack volume: the key is sanitised since it comes from the compose file. */
export function stackVolumeArchiveName(key: string, timestamp = Date.now()): string {
  return `vol-${key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}-${timestamp}.tar.gz`;
}

/** tar.gz of a docker volume by its real name (read-only mount into a throw-away container). */
export function buildNamedVolumeBackupCommand(dockerName: string, archivePath: string): string {
  return `docker run --rm -v ${shellQuote(dockerName)}:/data:ro ${VOLUME_HELPER_IMAGE} tar -czf - -C /data . > ${shellQuote(archivePath)}`;
}

/** Replaces a docker volume's contents with the archive. */
export function buildNamedVolumeRestoreCommand(dockerName: string, archivePath: string): string {
  return (
    `docker run --rm -v ${shellQuote(dockerName)}:/data -v ${shellQuote(archivePath)}:/backup.tar.gz:ro ${VOLUME_HELPER_IMAGE} ` +
    `sh -c 'find /data -mindepth 1 -delete && tar -xzf /backup.tar.gz -C /data'`
  );
}
