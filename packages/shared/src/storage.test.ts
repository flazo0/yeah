import { describe, expect, test } from "bun:test";
import { isSafeHostPath, isSafeMountPath } from "./shell";
import { volumeFilePath, volumeFlags } from "./types";

describe("volumeFlags by kind", () => {
  test("named volume (default) uses the id-derived docker volume", () => {
    expect(volumeFlags([{ id: "v1", mountPath: "/data" }])).toBe("-v 'yeah-vol-v1':'/data' ");
  });
  test("bind mounts the host directory", () => {
    expect(volumeFlags([{ id: "v2", mountPath: "/srv", kind: "bind", hostPath: "/opt/shared/uploads" }])).toBe("-v '/opt/shared/uploads':'/srv' ");
  });
  test("file mounts the file written under the app directory", () => {
    expect(volumeFlags([{ id: "v3", mountPath: "/etc/app.conf", kind: "file" }], "app-1")).toBe("-v '/opt/yeah-apps/app-1/files/v3':'/etc/app.conf' ");
    expect(volumeFilePath("app-1", "v3")).toBe("/opt/yeah-apps/app-1/files/v3");
  });
  test("mixed list keeps every mount", () => {
    const flags = volumeFlags(
      [
        { id: "a", mountPath: "/a" },
        { id: "b", mountPath: "/b", kind: "bind", hostPath: "/h" },
      ],
      "app",
    );
    expect(flags.match(/-v /g)?.length).toBe(2);
  });
});

describe("path validation", () => {
  test("host paths: absolute, no traversal, no shell characters, not the root", () => {
    for (const ok of ["/opt/data", "/var/lib/app-1/uploads"]) expect(isSafeHostPath(ok)).toBe(true);
    for (const bad of ["relative/path", "/", "/opt/../etc", "/opt/a b", "/opt/$(id)", "/opt/a;b", "/opt/a'b", "/a`b`", "/a\nb"]) expect(isSafeHostPath(bad)).toBe(false);
  });
  test("container paths: absolute, no quoting characters", () => {
    expect(isSafeMountPath("/app/uploads")).toBe(true);
    expect(isSafeMountPath("/app/with space")).toBe(true);
    for (const bad of ["app", "/a'b", "/a$b", "/a;b", "/a\nb"]) expect(isSafeMountPath(bad)).toBe(false);
  });
});
