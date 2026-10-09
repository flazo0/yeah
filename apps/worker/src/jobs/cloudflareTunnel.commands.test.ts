import { describe, expect, test } from "bun:test";
import { buildInstallCloudflareTunnelCommand, buildRemoveCloudflareTunnelCommand, CLOUDFLARE_TUNNEL_CONTAINER_NAME } from "./cloudflareTunnel.commands";

describe("buildInstallCloudflareTunnelCommand", () => {
  test("creates the proxy network, replaces any existing container, and runs cloudflared with the token", () => {
    const command = buildInstallCloudflareTunnelCommand("my-token");
    expect(command).toContain("docker network create 'yeah-proxy-net'");
    expect(command).toContain(`docker rm -f '${CLOUDFLARE_TUNNEL_CONTAINER_NAME}'`);
    expect(command).toContain("--network 'yeah-proxy-net'");
    expect(command).toContain("cloudflare/cloudflared:latest");
    expect(command).toContain("tunnel --no-autoupdate run --token 'my-token'");
  });

  test("quotes a token containing shell metacharacters", () => {
    const command = buildInstallCloudflareTunnelCommand("abc'; rm -rf /;'");
    expect(command).toContain("'abc'\\''; rm -rf /;'\\'''");
  });
});

describe("buildRemoveCloudflareTunnelCommand", () => {
  test("force-removes the tunnel container without failing if it's already gone", () => {
    const command = buildRemoveCloudflareTunnelCommand();
    expect(command).toBe(`docker rm -f '${CLOUDFLARE_TUNNEL_CONTAINER_NAME}' >/dev/null 2>&1 || true`);
  });
});
