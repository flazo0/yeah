import { describe, expect, test } from "bun:test";
import { buildDockerPruneCommand, buildHostCleanupCommand, parseReclaimedBytes } from "./dockerCleanup.commands";

describe("buildDockerPruneCommand", () => {
  test("base command with both flags off", () => {
    expect(buildDockerPruneCommand({ pruneImages: false, pruneVolumes: false })).toBe("docker system prune -f");
  });
  test("adds -a and --volumes independently, in a stable order", () => {
    expect(buildDockerPruneCommand({ pruneImages: true, pruneVolumes: false })).toBe("docker system prune -f -a");
    expect(buildDockerPruneCommand({ pruneImages: false, pruneVolumes: true })).toBe("docker system prune -f --volumes");
    expect(buildDockerPruneCommand({ pruneImages: true, pruneVolumes: true })).toBe("docker system prune -f -a --volumes");
  });
});

describe("parseReclaimedBytes", () => {
  test("parses each unit docker reports", () => {
    expect(parseReclaimedBytes("Total reclaimed space: 0B\n")).toBe(0);
    expect(parseReclaimedBytes("Total reclaimed space: 512B\n")).toBe(512);
    expect(parseReclaimedBytes("Total reclaimed space: 1.5MB\n")).toBe(Math.round(1.5 * 1024 ** 2));
    expect(parseReclaimedBytes("Deleted Images:\nimage1\n\nTotal reclaimed space: 2.34GB\n")).toBe(Math.round(2.34 * 1024 ** 3));
  });
  test("null when the line isn't there", () => {
    expect(parseReclaimedBytes("")).toBeNull();
    expect(parseReclaimedBytes("nothing to prune\n")).toBeNull();
  });
});

describe("daily host cleanup", () => {
  test("prune, old build cache, journal and apt cache — the extras are best-effort", () => {
    const cmd = buildHostCleanupCommand({ pruneImages: false, pruneVolumes: false });
    expect(cmd.startsWith("docker system prune -f ; docker builder prune -f --filter until=72h ;")).toBe(true);
    expect(cmd).toContain("journalctl --vacuum-time=14d");
    expect(cmd).toContain("|| true");
    expect(cmd).not.toContain("--volumes");
  });
  test("reclaimed space adds up across the prune outputs", () => {
    const out = ["Total reclaimed space: 1.5GB", "Total reclaimed space: 512MB", ""].join(String.fromCharCode(10));
    expect(parseReclaimedBytes(out)).toBe(Math.round(1.5 * 1024 ** 3 + 512 * 1024 ** 2));
  });
});
