import { describe, expect, test } from "bun:test";
import {
  composeContainerIds,
  composeExecCommand,
  composeLifecycleCommand,
  composeLogsCommand,
  composeProxyOverride,
  composeTeardownCommand,
  isSafeComposeFile,
  isValidComposeService,
} from "./compose";

describe("isSafeComposeFile", () => {
  test("accepts plain relative paths", () => {
    expect(isSafeComposeFile("docker-compose.yml")).toBe(true);
    expect(isSafeComposeFile("deploy/compose.prod.yaml")).toBe(true);
  });
  test("rejects empty, dot, absolute, traversal and shell characters", () => {
    for (const bad of ["", ".", "/etc/passwd", "../x.yml", "a/../../x.yml", "a b.yml", "a;rm.yml", "a$(x).yml", String.raw`a\b.yml`]) {
      expect(isSafeComposeFile(bad)).toBe(false);
    }
  });
});

describe("isValidComposeService", () => {
  test("accepts compose service names", () => {
    expect(isValidComposeService("web")).toBe(true);
    expect(isValidComposeService("api_v2.main-1")).toBe(true);
  });
  test("rejects spaces, quotes and leading punctuation", () => {
    for (const bad of ["", "-web", "a b", "a'b", "a;b", "a/b"]) expect(isValidComposeService(bad)).toBe(false);
  });
});

describe("project commands", () => {
  test("container ids filter by compose project (and service) labels", () => {
    expect(composeContainerIds("yeah-app-1")).toBe("$(docker ps -aq --filter 'label=com.docker.compose.project=yeah-app-1')");
    expect(composeContainerIds("p", "web")).toContain("--filter 'label=com.docker.compose.service=web'");
  });
  test("lifecycle covers every container and honors the grace period", () => {
    expect(composeLifecycleCommand("stop", "p", 7)).toContain("docker stop -t 7 $ids");
    expect(composeLifecycleCommand("restart", "p", 3)).toContain("docker restart -t 3 $ids");
    expect(composeLifecycleCommand("start", "p", 3)).toContain("docker start $ids");
  });
  test("logs prefix each line with the container name", () => {
    const cmd = composeLogsCommand("p", 100);
    expect(cmd).toContain("docker logs --tail 100 --timestamps $c");
    expect(cmd).toContain('sed "s#^#[$n] #"');
  });
  test("teardown removes containers, network and volumes of the project only", () => {
    const cmd = composeTeardownCommand("yeah-app-1");
    expect(cmd).toContain("docker rm -f");
    expect(cmd).toContain("docker network rm");
    expect(cmd).toContain("docker volume rm");
    expect(cmd.match(/label=com\.docker\.compose\.project=yeah-app-1/g)?.length).toBe(3);
  });
  test("exec targets the exposed service and quotes the command", () => {
    const cmd = composeExecCommand("p", "web", "echo 'hi'");
    expect(cmd).toContain("label=com.docker.compose.service=web");
    expect(cmd).toContain(String.raw`docker exec "$c" sh -c 'echo '\''hi'\'''`);
  });
});

describe("composeProxyOverride", () => {
  const yaml = composeProxyOverride("web", "yeah-app-1", "app.example.com", 8080);
  test("attaches the service to the proxy network and sets the traefik labels", () => {
    expect(yaml).toContain("  web:");
    expect(yaml).toContain('"traefik.http.routers.yeah-app-1.rule=Host(`app.example.com`)"');
    expect(yaml).toContain('"traefik.http.services.yeah-app-1.loadbalancer.server.port=8080"');
    expect(yaml).toContain('"traefik.docker.network=yeah-proxy-net"');
    expect(yaml).toContain("external: true");
  });
});
