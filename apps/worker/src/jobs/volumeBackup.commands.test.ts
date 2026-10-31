import { describe, expect, test } from "bun:test";
import { buildVolumeBackupCommand, buildVolumeRestoreCommands, volumeArchiveName, VOLUME_HELPER_IMAGE } from "./volumeBackup.commands";

const named = { kind: "volume" as const, id: "11111111-2222-3333-4444-555555555555", hostPath: null, applicationId: "app-1" };

describe("volume backup commands", () => {
  test("a named volume is mounted read-only into a helper container that streams a tar to the archive", () => {
    const cmd = buildVolumeBackupCommand(named, "/opt/yeah-backups/volumes/app-1/x.tar.gz");
    expect(cmd).toContain(`-v 'yeah-vol-${named.id}':/data:ro ${VOLUME_HELPER_IMAGE} tar -czf - -C /data .`);
    expect(cmd).toEndWith("> '/opt/yeah-backups/volumes/app-1/x.tar.gz'");
  });
  test("a bind directory is archived from the host path directly", () => {
    expect(buildVolumeBackupCommand({ ...named, kind: "bind", hostPath: "/srv/data" }, "/b/x.tar.gz")).toBe("tar -czf '/b/x.tar.gz' -C '/srv/data' .");
  });
  test("a file volume archives the single file", () => {
    const cmd = buildVolumeBackupCommand({ ...named, kind: "file" }, "/b/x.tar.gz");
    expect(cmd).toContain("-C '/opt/yeah-apps/app-1/files' '11111111-2222-3333-4444-555555555555'");
  });
  test("a bind volume without a path is refused", () => {
    expect(() => buildVolumeBackupCommand({ ...named, kind: "bind" }, "/b/x")).toThrow();
  });
  test("restore of a named volume empties it and unpacks, with the container stopped around it", () => {
    const r = buildVolumeRestoreCommands(named, "/b/x.tar.gz", "yeah-app-1");
    expect(r.stop).toContain("docker stop 'yeah-app-1'");
    expect(r.replace).toContain("find /data -mindepth 1 -delete && tar -xzf /backup.tar.gz -C /data");
    expect(r.replace).toContain("-v '/b/x.tar.gz':/backup.tar.gz:ro");
    expect(r.start).toContain("docker start 'yeah-app-1'");
  });
  test("restore of a bind directory clears then unpacks into the host path", () => {
    const r = buildVolumeRestoreCommands({ ...named, kind: "bind", hostPath: "/srv/data" }, "/b/x.tar.gz", "c");
    expect(r.replace).toBe("mkdir -p '/srv/data' && find '/srv/data' -mindepth 1 -delete && tar -xzf '/b/x.tar.gz' -C '/srv/data'");
  });
  test("archive names carry the volume id prefix and a timestamp", () => {
    expect(volumeArchiveName(named.id, 5)).toBe("vol-11111111-5.tar.gz");
  });
});
