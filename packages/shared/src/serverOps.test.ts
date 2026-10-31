import { describe, expect, test } from "bun:test";
import { applyPatchesCommand, autoSecurityUpdatesCommand, dockerImageRemoveCommand, isSafeImageRef, parseDockerImages, parsePatchCheck } from "./serverOps";

describe("docker images", () => {
  const out = [
    "IMG|sha256:aaaaaaaaaaaa1111111111|nginx|alpine|52MB|2 weeks ago",
    "IMG|sha256:bbbbbbbbbbbb2222222222|<none>|<none>|1.2GB|3 months ago",
    "IMG|sha256:cccccccccccc3333333333|ghcr.io/org/app|v1|300MB|1 day ago",
    "USED|sha256:aaaaaaaaaaaa1111111111",
    "",
  ].join("\n");

  test("parses refs, short ids and which images are in use", () => {
    const images = parseDockerImages(out);
    expect(images).toHaveLength(3);
    expect(images[0]).toMatchObject({ id: "aaaaaaaaaaaa", ref: "nginx:alpine", inUse: true, size: "52MB" });
    expect(images[1]).toMatchObject({ ref: "bbbbbbbbbbbb", inUse: false });
    expect(images[2]).toMatchObject({ ref: "ghcr.io/org/app:v1", inUse: false });
  });

  test("only plain references are accepted", () => {
    expect(isSafeImageRef("nginx:alpine")).toBe(true);
    expect(isSafeImageRef("ghcr.io/org/app@sha256:abc123")).toBe(true);
    expect(isSafeImageRef("abc123def456")).toBe(true);
    expect(isSafeImageRef("x; rm -rf /")).toBe(false);
    expect(isSafeImageRef("-f")).toBe(false);
    expect(isSafeImageRef("")).toBe(false);
  });

  test("remove command quotes the reference", () => {
    expect(dockerImageRemoveCommand("nginx:alpine")).toBe("docker image rm 'nginx:alpine' 2>&1");
  });
});

describe("patch check", () => {
  const out = [
    "Listing...",
    "openssl/noble-updates,noble-security 3.0.13-0ubuntu3.5 amd64 [upgradable from: 3.0.13-0ubuntu3.4]",
    "curl/noble-updates 8.5.0-2ubuntu10.6 amd64 [upgradable from: 8.5.0-2ubuntu10.5]",
    "linux-image-generic/noble-updates,noble-security 6.8.0.50.52 amd64 [upgradable from: 6.8.0.49.51]",
    "docker-ce/noble 5:27.4.0 amd64 [upgradable from: 5:27.3.1]",
    "__REBOOT_REQUIRED__",
  ].join("\n");

  test("counts updates, security updates, risky packages and the reboot flag", () => {
    const status = parsePatchCheck(out);
    expect(status.updates).toBe(4);
    expect(status.security).toBe(2);
    expect(status.rebootRequired).toBe(true);
    expect(status.packages.find((p) => p.name === "curl")).toMatchObject({ security: false, risky: false });
    expect(status.packages.find((p) => p.name === "linux-image-generic")).toMatchObject({ security: true, risky: true });
    expect(status.packages.find((p) => p.name === "docker-ce")?.risky).toBe(true);
  });

  test("a clean server has nothing pending", () => {
    expect(parsePatchCheck("Listing...\n")).toEqual({ updates: 0, security: 0, rebootRequired: false, packages: [] });
  });

  test("apply runs detached and logs to a file", () => {
    expect(applyPatchesCommand(false)).toContain("nohup sh -c");
    expect(applyPatchesCommand(false)).toContain("/var/log/yeah-patch.log");
    expect(applyPatchesCommand(true)).toContain("--only-upgrade");
  });

  test("automatic security updates toggle writes the apt periodic file", () => {
    expect(autoSecurityUpdatesCommand(true)).toContain("unattended-upgrades");
    expect(autoSecurityUpdatesCommand(true)).toContain("Unattended-Upgrade \"1\"");
    expect(autoSecurityUpdatesCommand(false)).toContain("Unattended-Upgrade \"0\"");
    expect(autoSecurityUpdatesCommand(false)).not.toContain("apt-get install");
  });
});
