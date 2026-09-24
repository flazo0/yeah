import { describe, expect, test } from "bun:test";
import { containerStatsCommand, parseDockerStats, parseSize } from "./metrics";

describe("parseSize", () => {
  test("decimal and binary units", () => {
    expect(parseSize("0B")).toBe(0);
    expect(parseSize("1.5kB")).toBe(1500);
    expect(parseSize("3.5MiB")).toBe(3670016);
    expect(parseSize("1GiB")).toBe(1073741824);
    expect(parseSize("12 MB")).toBe(12_000_000);
  });
  test("garbage is 0", () => {
    expect(parseSize("")).toBe(0);
    expect(parseSize("--")).toBe(0);
    expect(parseSize("5 parsecs")).toBe(0);
  });
});

describe("parseDockerStats", () => {
  const line = JSON.stringify({ Name: "yeah-app-1", CPUPerc: "12.50%", MemUsage: "10MiB / 1GiB", MemPerc: "0.98%", NetIO: "1.2kB / 3.4kB", BlockIO: "0B / 4.1kB", PIDs: "7" });
  test("parses one container per line and skips noise", () => {
    const stats = parseDockerStats(`warning: something\n${line}\n\nnot json {\n`);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toEqual({
      name: "yeah-app-1",
      cpuPercent: 12.5,
      memUsedBytes: 10485760,
      memLimitBytes: 1073741824,
      memPercent: 0.98,
      netRxBytes: 1200,
      netTxBytes: 3400,
      blockReadBytes: 0,
      blockWriteBytes: 4100,
      pids: 7,
    });
  });
  test("missing fields degrade to zero instead of throwing", () => {
    expect(parseDockerStats('{"Name":"x"}')[0]).toMatchObject({ name: "x", cpuPercent: 0, memUsedBytes: 0, pids: 0 });
  });
  test("multiple containers", () => {
    expect(parseDockerStats(`${line}\n${line.replace("yeah-app-1", "yeah-app-1-db-1")}`).map((s) => s.name)).toEqual(["yeah-app-1", "yeah-app-1-db-1"]);
  });
});

describe("containerStatsCommand", () => {
  test("plain app targets its container by name", () => {
    expect(containerStatsCommand({ id: "abc", buildPack: "dockerfile" })).toBe("docker stats --no-stream --format '{{json .}}' 'yeah-app-abc'");
  });
  test("compose app targets every container of the project", () => {
    const cmd = containerStatsCommand({ id: "abc", buildPack: "docker_compose" });
    expect(cmd).toContain("label=com.docker.compose.project=yeah-app-abc");
    expect(cmd).toContain("docker stats");
  });
});
