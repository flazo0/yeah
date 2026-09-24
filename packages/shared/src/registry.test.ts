import { describe, expect, test } from "bun:test";
import {
  isValidRegistryHost,
  isValidRegistryRepository,
  isValidRegistryUsername,
  registryExistsCommand,
  registryLoginCommand,
  registryTagLocalCommand,
  registryPushCommand,
  registryRef,
  registryTag,
} from "./registry";

describe("validation", () => {
  test("hosts", () => {
    for (const ok of ["ghcr.io", "docker.io", "registry.example.com:5000", "localhost:5000", "10.0.0.5:5000"]) expect(isValidRegistryHost(ok)).toBe(true);
    for (const bad of ["", "https://ghcr.io", "ghcr.io/org", "a b", "-x.io", "x.io:", "x.io;rm", "x.io:99999999"]) expect(isValidRegistryHost(bad)).toBe(false);
  });
  test("repositories are lowercase path components", () => {
    for (const ok of ["app", "org/app", "org/team/app-1", "a.b_c/d"]) expect(isValidRegistryRepository(ok)).toBe(true);
    for (const bad of ["", "Org/App", "/app", "app/", "a//b", "a b", "app:latest", "a;b"]) expect(isValidRegistryRepository(bad)).toBe(false);
  });
  test("usernames", () => {
    expect(isValidRegistryUsername("ci-bot")).toBe(true);
    expect(isValidRegistryUsername("user@example.com")).toBe(true);
    for (const bad of ["", "a b", "a\nb"]) expect(isValidRegistryUsername(bad)).toBe(false);
  });
});

describe("tags and refs", () => {
  test("a commit gives a 12-char tag, no commit falls back to the deployment", () => {
    expect(registryTag("ABCDEF0123456789abcdef", "d-1")).toBe("abcdef012345");
    expect(registryTag(null, "1234-5678-9abc-def0")).toBe("d-123456789abc");
    expect(registryTag("not-a-sha", "aaaa-bbbb")).toBe("d-aaaabbbb");
    expect(registryTag("abcdef0123456789", "d", "a1b2c3")).toBe("abcdef012345-a1b2c3");
  });
  test("ref", () => {
    expect(registryRef("ghcr.io", "org/app", "abc")).toBe("ghcr.io/org/app:abc");
  });
});

describe("commands", () => {
  test("login reads the password from a file and always removes it", () => {
    const cmd = registryLoginCommand("ghcr.io", "me", "/opt/x/.pw");
    expect(cmd).toBe("docker login 'ghcr.io' -u 'me' --password-stdin < '/opt/x/.pw'; rc=$?; rm -f '/opt/x/.pw'; exit $rc");
    expect(cmd).not.toContain("-p ");
  });
  test("quotes everything", () => {
    expect(registryLoginCommand("h", "u'; rm -rf /", "/f")).toContain("-u 'u'\\''; rm -rf /'");
    expect(registryExistsCommand("h/r:t")).toBe("docker pull -q 'h/r:t' >/dev/null 2>&1");
    expect(registryTagLocalCommand("h/r:t", "local")).toBe("docker tag 'h/r:t' 'local'");
    expect(registryPushCommand("local", "h/r:t")).toBe("docker tag 'local' 'h/r:t' && docker push 'h/r:t'");
  });
});
