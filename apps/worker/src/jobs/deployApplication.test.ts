import { describe, expect, test } from "bun:test";
import type { Application, Server } from "@yeah/db";
import {
  buildCloneOrPullCommand,
  buildComposeUpCommand,
  composeEnvFile,
  buildHealthWaitCommand,
  buildRunCommand,
  buildImageSteps,
  buildStopOldCommand,
  healthWaitSeconds,
  isSafePublishDirectory,
  staticDockerfile,
  resolveDomain,
} from "./deployApplication.commands";

function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    teamId: "team-1",
    environmentId: "env-1",
    serverId: "server-1",
    name: "my-api",
    repoUrl: "https://github.com/example/repo",
    branch: "main",
    buildPack: "dockerfile",
    dockerImage: null,
    dockerfileContent: null,
    publishDirectory: ".",
    composeFile: "docker-compose.yml",
    composeService: null,
    extraDomains: [],
    wwwRedirect: "none",
    deployedConfig: null,
    previewEnabled: false,
    previewOfId: null,
    prNumber: null,
    deployKey: null,
    deployKeyPublic: null,
    port: 3000,
    envContent: "",
    domain: null,
    githubInstallationId: null,
    githubRepo: null,
    healthPath: null,
    healthIntervalSeconds: 30,
    healthTimeoutSeconds: 5,
    healthRetries: 3,
    healthStartPeriodSeconds: 30,
    dockerOptions: "",
    stopGraceSeconds: 10,
    deployTokenHash: null,
    memoryLimitMb: null,
    cpuLimit: null,
    status: "idle",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "server-1",
    teamId: "team-1",
    name: "prod",
    host: "1.2.3.4",
    port: 22,
    sshUser: "root",
    privateKey: "fake-key",
    status: "connected",
    dockerVersion: null,
    lastCheckedAt: null,
    wildcardDomain: null,
    acmeEmail: null,
    proxyStatus: "inactive",
    cpuPercent: null,
    memPercent: null,
    diskPercent: null,
    metricsCheckedAt: null,
    isPlatformHost: false,
    sshTimeoutSeconds: 15,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("resolveDomain", () => {
  test("uses the explicit domain when set, regardless of proxy status", () => {
    const app = makeApplication({ domain: "custom.example.com" });
    const server = makeServer({ proxyStatus: "inactive" });
    expect(resolveDomain(app, server)).toBe("custom.example.com");
  });

  test("returns null when there's no domain and no active proxy (publish port directly)", () => {
    const app = makeApplication();
    const server = makeServer({ proxyStatus: "inactive", wildcardDomain: "apps.example.com" });
    expect(resolveDomain(app, server)).toBeNull();
  });

  test("returns null when the proxy is active but has no wildcard domain configured", () => {
    const app = makeApplication();
    const server = makeServer({ proxyStatus: "active", wildcardDomain: null });
    expect(resolveDomain(app, server)).toBeNull();
  });

  test("derives a slug from the app name under the server's wildcard domain", () => {
    const app = makeApplication({ name: "My Cool API!" });
    const server = makeServer({ proxyStatus: "active", wildcardDomain: "apps.example.com" });
    expect(resolveDomain(app, server)).toBe("my-cool-api.apps.example.com");
  });

  test("strips leading/trailing dashes produced by punctuation at the edges of the name", () => {
    const app = makeApplication({ name: "--weird-name--" });
    const server = makeServer({ proxyStatus: "active", wildcardDomain: "apps.example.com" });
    expect(resolveDomain(app, server)).toBe("weird-name.apps.example.com");
  });
});

describe("buildRunCommand", () => {
  test("publishes the port directly when there's no domain", () => {
    const app = makeApplication({ port: 4000 });
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).toContain("-p 4000:4000 ");
    expect(cmd).not.toContain("traefik");
  });

  test("uses Traefik labels and the proxy network when a domain is set", () => {
    const app = makeApplication({ port: 4000 });
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", "my-app.example.com");
    expect(cmd).not.toContain("-p 4000:4000");
    expect(cmd).toContain("--network");
    expect(cmd).toContain("traefik.enable=true");
    expect(cmd).toContain("Host(`my-app.example.com`)");
    expect(cmd).toContain("loadbalancer.server.port=4000");
  });

  test("includes resource limit flags when set", () => {
    const app = makeApplication({ memoryLimitMb: 512, cpuLimit: 1.5 });
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).toContain("--memory=512m");
    expect(cmd).toContain("--cpus=1.5");
  });

  test("omits resource limit flags entirely when unset", () => {
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).not.toContain("--memory");
    expect(cmd).not.toContain("--cpus");
  });

  test("quotes the container name and env-file path safely", () => {
    // Container names are derived from a UUID (safe already), but this locks in that the
    // quoting call sites are actually there — a regression here would be a real injection risk.
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).toContain("--name 'yeah-app-1'");
    expect(cmd).toContain("--env-file '/opt/yeah-apps/app-1/.env'");
  });

  test("mounts a -v flag per configured persistent volume, named after the row id", () => {
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null, [
      { id: "vol-1", mountPath: "/app/uploads" },
      { id: "vol-2", mountPath: "/app/cache" },
    ]);
    expect(cmd).toContain("-v 'yeah-vol-vol-1':'/app/uploads'");
    expect(cmd).toContain("-v 'yeah-vol-vol-2':'/app/cache'");
  });

  test("omits -v flags entirely when there are no volumes", () => {
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null, []);
    expect(cmd).not.toContain("-v ");
  });
});

describe("buildCloneOrPullCommand", () => {
  test("resets to the branch's origin HEAD for a normal deploy (no target commit)", () => {
    const cmd = buildCloneOrPullCommand("/opt/yeah-apps/app-1", "https://github.com/example/repo", "main", null);
    expect(cmd).toContain("git fetch origin 'main'");
    expect(cmd).toContain("git reset --hard 'origin/main'");
    expect(cmd).toContain("git clone --branch 'main' --single-branch");
  });

  test("resets to the exact commit for a rollback, both on the fetch path and the fresh-clone path", () => {
    const sha = "abc123def456";
    const cmd = buildCloneOrPullCommand("/opt/yeah-apps/app-1", "https://github.com/example/repo", "main", sha);
    expect(cmd).not.toContain("origin/main");
    const resetCount = cmd.split(`git reset --hard '${sha}'`).length - 1;
    expect(resetCount).toBe(2);
  });

  test("quotes the clone URL and branch safely", () => {
    const cmd = buildCloneOrPullCommand("/opt/yeah-apps/app-1", "https://x:token@github.com/example/repo", "main", null);
    expect(cmd).toContain("git remote set-url origin 'https://x:token@github.com/example/repo'");
  });
});

describe("healthcheck and docker options in buildRunCommand", () => {
  test("no healthcheck flags without a path", () => {
    const cmd = buildRunCommand(makeApplication(), "/a", "c", null);
    expect(cmd).not.toContain("--health");
  });

  test("healthcheck flags carry path, port and timings", () => {
    const app = makeApplication({ port: 8080, healthPath: "/up", healthIntervalSeconds: 10, healthTimeoutSeconds: 2, healthRetries: 5, healthStartPeriodSeconds: 45 });
    const cmd = buildRunCommand(app, "/a", "c", null);
    expect(cmd).toContain("http://127.0.0.1:8080/up");
    expect(cmd).toContain("http://localhost:8080/up");
    expect(cmd).toContain("--health-interval 10s");
    expect(cmd).toContain("--health-timeout 2s");
    expect(cmd).toContain("--health-retries 5");
    expect(cmd).toContain("--health-start-period 45s");
    expect(cmd).toContain("curl -fsS");
    expect(cmd).toContain("wget -q -O /dev/null");
  });

  test("extra docker options are added as quoted words, never interpreted", () => {
    const app = makeApplication({ dockerOptions: "--cap-add NET_ADMIN --label 'x=$(id)'" });
    const cmd = buildRunCommand(app, "/a", "c", null);
    expect(cmd).toContain("'--cap-add' 'NET_ADMIN' '--label' 'x=$(id)'");
  });

  test("options come before the trailing restart/name so they can't swallow them", () => {
    const app = makeApplication({ dockerOptions: "--shm-size=1g" });
    const cmd = buildRunCommand(app, "/a", "c", null);
    expect(cmd.indexOf("'--shm-size=1g'")).toBeLessThan(cmd.indexOf("--restart unless-stopped"));
  });
});

describe("deploy helpers", () => {
  test("graceful stop uses the configured seconds and then removes", () => {
    const cmd = buildStopOldCommand("yeah-app-1", 25);
    expect(cmd).toContain("docker stop -t 25 'yeah-app-1'");
    expect(cmd).toContain("docker rm -f 'yeah-app-1'");
  });

  test("health wait covers the start period plus every retry plus slack", () => {
    const app = makeApplication({ healthStartPeriodSeconds: 20, healthIntervalSeconds: 10, healthRetries: 3 });
    expect(healthWaitSeconds(app)).toBe(80);
    expect(buildHealthWaitCommand("c", 80)).toContain("seq 1 40");
  });

  test("health wait prints container logs when it fails", () => {
    expect(buildHealthWaitCommand("c", 10)).toContain("docker logs --tail 40 'c'");
  });
});

describe("build packs", () => {
  test("dockerfile builds inside the repo with the container name as the image tag", () => {
    const [step] = buildImageSteps(makeApplication(), "/opt/r", "/opt/i", "yeah-app-1");
    expect(step!.command).toBe("cd '/opt/r' && docker build -t 'yeah-app-1' .");
  });

  test("image only pulls, and the run command starts that image instead of a built one", () => {
    const app = makeApplication({ buildPack: "image", dockerImage: "nginx:1.27-alpine" });
    const steps = buildImageSteps(app, "/opt/r", "/opt/i", "yeah-app-1");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.command).toBe("docker pull 'nginx:1.27-alpine'");
    const run = buildRunCommand(app, "/a", "yeah-app-1", null, [], "nginx:1.27-alpine");
    expect(run.trim().endsWith("--restart unless-stopped 'nginx:1.27-alpine'")).toBe(true);
    expect(run).toContain("--name 'yeah-app-1'");
  });

  test("inline builds from the dedicated directory, not the repo", () => {
    const [step] = buildImageSteps(makeApplication({ buildPack: "dockerfile_inline" }), "/opt/r", "/opt/i", "yeah-app-1");
    expect(step!.command).toBe("docker build -t 'yeah-app-1' '/opt/i'");
  });

  test("static wraps the publish directory in an nginx Dockerfile fed through stdin", () => {
    const [step] = buildImageSteps(makeApplication({ buildPack: "static", publishDirectory: "dist" }), "/opt/r", "/opt/i", "yeah-app-1");
    expect(step!.command).toContain("printf %s");
    expect(step!.command).toContain("docker build -t 'yeah-app-1' -f - .");
    expect(step!.command).toContain("COPY [\"dist\", \"/usr/share/nginx/html\"]");
    expect(staticDockerfile(".")).toContain("COPY [\".\"");
  });

  test("nixpacks installs itself when missing, then builds the repo", () => {
    const steps = buildImageSteps(makeApplication({ buildPack: "nixpacks" }), "/opt/r", "/opt/i", "yeah-app-1");
    expect(steps[0]!.command).toContain("command -v nixpacks");
    expect(steps[1]!.command).toBe("nixpacks build '/opt/r' --name 'yeah-app-1'");
  });

  test("publish directory must be a plain relative path", () => {
    for (const ok of [".", "dist", "build/public", "a-b_c/d.e"]) expect(isSafePublishDirectory(ok)).toBe(true);
    for (const bad of ["/etc", "../x", "a/../b", "a b", "a;b", "a\"b", "a$(x)", String.raw`a\b`]) expect(isSafePublishDirectory(bad)).toBe(false);
  });
});

describe("deploy key clone", () => {
  test("git uses exactly the deploy key when one is given", () => {
    const cmd = buildCloneOrPullCommand("/opt/a", "git@github.com:o/r.git", "main", null, "/opt/a/.deploy_key");
    expect(cmd.startsWith("export GIT_SSH_COMMAND=")).toBe(true);
    expect(cmd).toContain("-i /opt/a/.deploy_key");
    expect(cmd).toContain("IdentitiesOnly=yes");
    expect(cmd).toContain("StrictHostKeyChecking=accept-new");
  });
  test("no GIT_SSH_COMMAND without a key", () => {
    expect(buildCloneOrPullCommand("/opt/a", "https://x/y.git", "main", null)).not.toContain("GIT_SSH_COMMAND");
  });
});

describe("build-time env", () => {
  const env = [
    { key: "NPM_TOKEN", value: "s3cr'et", availability: "build" as const },
    { key: "MODE", value: "prod", availability: "both" as const },
  ];
  test("dockerfile builds get one quoted --build-arg per build-time entry", () => {
    const [step] = buildImageSteps(makeApplication(), "/r", "/i", "img", env);
    expect(step!.command).toContain(String.raw`--build-arg 'NPM_TOKEN=s3cr'\''et'`);
    expect(step!.command).toContain("--build-arg 'MODE=prod'");
    expect(step!.command.indexOf("--build-arg")).toBeLessThan(step!.command.indexOf("-t 'img'"));
  });
  test("no build-time env, no --build-arg", () => {
    expect(buildImageSteps(makeApplication(), "/r", "/i", "img")[0]!.command).not.toContain("--build-arg");
  });
  test("nixpacks gets --env instead", () => {
    const steps = buildImageSteps(makeApplication({ buildPack: "nixpacks" }), "/r", "/i", "img", env);
    expect(steps[1]!.command).toContain("--env 'MODE=prod'");
    expect(steps[1]!.command).not.toContain("--build-arg");
  });
  test("inline builds also pass build args", () => {
    const [step] = buildImageSteps(makeApplication({ buildPack: "dockerfile_inline" }), "/r", "/i", "img", env);
    expect(step!.command).toContain("--build-arg 'MODE=prod'");
  });
});

describe("docker compose", () => {
  test("up command uses the project name, env file, compose file and waits for health", () => {
    const app = makeApplication({ buildPack: "docker_compose", composeFile: "deploy/compose.yml" });
    const cmd = buildComposeUpCommand(app, "/opt/yeah-apps/app-1", "/opt/yeah-apps/app-1/repo", false, 120);
    expect(cmd).toContain("cd '/opt/yeah-apps/app-1/repo' && docker compose -p 'yeah-app-app-1'");
    expect(cmd).toContain("--env-file '/opt/yeah-apps/app-1/.env' -f 'deploy/compose.yml' up -d --build --remove-orphans --wait --wait-timeout 120");
    expect(cmd).not.toContain("compose.yeah.override.yml");
  });
  test("with a proxy route the override file is added as a second -f", () => {
    const app = makeApplication({ buildPack: "docker_compose" });
    const cmd = buildComposeUpCommand(app, "/opt/yeah-apps/app-1", "/opt/yeah-apps/app-1/repo", true, 5);
    expect(cmd).toContain("-f 'docker-compose.yml' -f '/opt/yeah-apps/app-1/compose.yeah.override.yml'");
    expect(cmd).toContain("--wait-timeout 10"); // never below 10s
  });
  test("env file carries build-only variables too, since compose interpolates them at build", () => {
    expect(composeEnvFile([{ key: "A", value: "1", availability: "runtime" }, { key: "B", value: "2", availability: "build" }])).toBe("A=1\nB=2\n");
    expect(composeEnvFile([])).toBe("");
  });
});

describe("buildRunCommand routing", () => {
  test("extra domains join the router rule and a www redirect adds the redirect router", () => {
    const app = makeApplication({ port: 4000, extraDomains: ["other.example.com"], wwwRedirect: "root_to_www" });
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", "example.com");
    expect(cmd).toContain("Host(`www.example.com`) || Host(`other.example.com`)");
    expect(cmd).toContain("routers.yeah-app-1-redir.rule=Host(`example.com`)");
    expect(cmd).toContain("redirectregex.permanent=true");
  });
  test("a domain typed with a scheme is normalized", () => {
    const app = makeApplication({ domain: "HTTPS://Shop.Example.com/" });
    expect(resolveDomain(app, makeServer())).toBe("shop.example.com");
  });
});
