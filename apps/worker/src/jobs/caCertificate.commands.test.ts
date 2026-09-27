import { describe, expect, test } from "bun:test";
import { buildInstallCaCertCommand, buildRemoveCaCertCommand, caCertDir } from "./caCertificate.commands";

describe("caCertDir", () => {
  test("matches Docker's per-registry certs.d layout", () => {
    expect(caCertDir("registry.example.com:5000")).toBe("/etc/docker/certs.d/registry.example.com:5000");
  });
});

describe("buildInstallCaCertCommand", () => {
  test("just makes the directory — the cert itself is written separately", () => {
    expect(buildInstallCaCertCommand("registry.example.com:5000")).toBe("mkdir -p '/etc/docker/certs.d/registry.example.com:5000'");
  });
});

describe("buildRemoveCaCertCommand", () => {
  test("removes the whole per-registry directory", () => {
    expect(buildRemoveCaCertCommand("registry.example.com:5000")).toBe("rm -rf '/etc/docker/certs.d/registry.example.com:5000'");
  });
});
