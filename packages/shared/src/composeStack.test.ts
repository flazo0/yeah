import { describe, expect, test } from "bun:test";
import { composeStackOverride, parseComposeStack, stackNetworkJoinCommand, validateStackDomains } from "./composeStack";

const ok = `
services:
  web:
    image: nginx:alpine
    ports: ["80:80"]
  db:
    image: postgres:16-alpine
volumes:
  data: {}
`;

describe("parseComposeStack", () => {
  test("accepts a compose file and lists its services", () => {
    const r = parseComposeStack(ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.services)).toEqual(["web", "db"]);
  });
  test("rejects empty, non-yaml, missing services and non-object documents", () => {
    for (const bad of ["", "a: [", "- x\n- y", "version: '3'", "services: {}", "services:\n  web: nginx"]) {
      expect(parseComposeStack(bad).ok).toBe(false);
    }
  });
  test("build is refused and image is required", () => {
    const build = parseComposeStack("services:\n  a:\n    build: .\n");
    expect(build.ok).toBe(false);
    if (!build.ok) expect(build.error).toContain("build");
    expect(parseComposeStack("services:\n  a:\n    command: x\n").ok).toBe(false);
  });
  test("service names are checked", () => {
    expect(parseComposeStack("services:\n  'bad name':\n    image: x\n").ok).toBe(false);
  });
  test("size limit", () => {
    expect(parseComposeStack("services:\n  a:\n    image: x\n#" + "x".repeat(200_001)).ok).toBe(false);
  });
});

describe("validateStackDomains", () => {
  test("valid", () => {
    expect(validateStackDomains([{ service: "web", domain: "HTTPS://App.Example.com/", port: 80 }], ["web", "db"])).toBeNull();
  });
  test("rejects unknown services, bad hosts, bad ports and duplicates", () => {
    expect(validateStackDomains([{ service: "x", domain: "a.example.com", port: 80 }], ["web"])).toContain("não existe");
    expect(validateStackDomains([{ service: "web", domain: "bad_host", port: 80 }], ["web"])).toContain("inválido");
    expect(validateStackDomains([{ service: "web", domain: "a.example.com", port: 0 }], ["web"])).toContain("porta");
    expect(
      validateStackDomains([{ service: "web", domain: "a.example.com", port: 80 }, { service: "web", domain: "A.example.com", port: 81 }], ["web"]),
    ).toContain("mais de uma vez");
  });
});

describe("composeStackOverride", () => {
  const parsed = parseComposeStack(ok);
  const services = parsed.ok ? parsed.services : {};
  const opts = { project: "yeah-svc-1", domains: [] };

  test("without domains there is nothing to override (the environment network is joined after the deploy)", () => {
    expect(composeStackOverride(services, opts)).toBe("services: {}\n");
  });
  test("a service with a domain joins the proxy network and carries traefik labels", () => {
    const yaml = composeStackOverride(services, { ...opts, domains: [{ service: "web", domain: "app.example.com", port: 8080 }] });
    expect(yaml).toContain('"yeah-proxy-net": {}');
    expect(yaml).toContain("app.example.com");
    expect(yaml).toContain("loadbalancer.server.port=8080");
    expect(yaml).toContain("external: true");
    expect(yaml.match(/traefik\.enable=true/g)?.length).toBe(1);
  });
  test("two domains on one service become two routers", () => {
    const yaml = composeStackOverride(services, {
      ...opts,
      domains: [
        { service: "web", domain: "a.example.com", port: 80 },
        { service: "web", domain: "b.example.com", port: 9000 },
      ],
    });
    expect(yaml).toContain("yeah-svc-1-web-0");
    expect(yaml).toContain("yeah-svc-1-web-1");
  });
  test("network_mode services are left alone", () => {
    const yaml = composeStackOverride({ host: { image: "x", network_mode: "host" } }, { ...opts, domains: [{ service: "host", domain: "a.example.com", port: 80 }] });
    expect(yaml).toBe("services: {}\n");
  });
  test("the override itself is valid YAML", () => {
    const yaml = composeStackOverride(services, { ...opts, domains: [{ service: "web", domain: "a.example.com", port: 80 }] });
    expect(() => (Bun as unknown as { YAML: { parse(t: string): unknown } }).YAML.parse(yaml)).not.toThrow();
  });
});

describe("stackNetworkJoinCommand", () => {
  const cmd = stackNetworkJoinCommand("yeah-svc-1", "yeah-env-e1", "my-stack", "web");
  test("filters the project's containers and connects each with a slug-prefixed alias (plain slug for the main one)", () => {
    expect(cmd).toContain("--filter 'label=com.docker.compose.project=yeah-svc-1'");
    expect(cmd).toContain('--alias "my-stack-$s"');
    expect(cmd).toContain("[ \"$s\" = 'web' ] && extra=\"--alias my-stack\"");
    expect(cmd).toContain("'yeah-env-e1'");
  });
  test("is idempotent and a container that cannot join does not fail the deploy", () => {
    expect(cmd).toContain("docker network disconnect -f 'yeah-env-e1'");
    expect(cmd).toContain("|| true");
  });
});
