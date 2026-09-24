import { describe, expect, test } from "bun:test";
import { computeRouting, isValidHostname, normalizeHost, traefikLabels } from "./traefik";
import { configSnapshot, pendingChanges } from "./pending";
import { parseEnvContent, serializeEnvEntries } from "./env";

describe("normalizeHost / isValidHostname", () => {
  test("strips scheme, path, case and trailing dot", () => {
    expect(normalizeHost("  HTTPS://App.Example.com/path?x=1 ")).toBe("app.example.com");
    expect(normalizeHost("example.com.")).toBe("example.com");
  });
  test("validates hostnames", () => {
    for (const ok of ["a.io", "app.example.com", "x-y.z.example.co.uk"]) expect(isValidHostname(ok)).toBe(true);
    for (const bad of ["", "localhost", "a b.com", "-a.com", "a..com", "a.com/x", "a_b.com", "*.example.com", "a.c"]) expect(isValidHostname(bad)).toBe(false);
  });
});

describe("computeRouting", () => {
  test("no redirect: primary first, extras after, deduplicated", () => {
    expect(computeRouting("a.com", ["b.com", "a.com"], "none")).toEqual({ hosts: ["a.com", "b.com"], canonical: "a.com", redirectFrom: null });
  });
  test("www_to_root serves the root and redirects www", () => {
    expect(computeRouting("www.a.com", [], "www_to_root")).toEqual({ hosts: ["a.com"], canonical: "a.com", redirectFrom: "www.a.com" });
    expect(computeRouting("a.com", [], "www_to_root").redirectFrom).toBe("www.a.com");
  });
  test("root_to_www serves www and redirects the root", () => {
    expect(computeRouting("a.com", [], "root_to_www")).toEqual({ hosts: ["www.a.com"], canonical: "www.a.com", redirectFrom: "a.com" });
  });
  test("an extra domain equal to the redirected host is not served twice", () => {
    expect(computeRouting("a.com", ["www.a.com", "b.com"], "www_to_root").hosts).toEqual(["a.com", "b.com"]);
  });
});

describe("traefikLabels", () => {
  test("single host", () => {
    const labels = traefikLabels("app1", computeRouting("a.com", [], "none"), 3000);
    expect(labels).toContain("traefik.enable=true");
    expect(labels).toContain("traefik.http.routers.app1.rule=Host(`a.com`)");
    expect(labels).toContain("traefik.http.services.app1.loadbalancer.server.port=3000");
    expect(labels.some((l) => l.includes("-redir"))).toBe(false);
  });
  test("several hosts join with ||", () => {
    const labels = traefikLabels("app1", computeRouting("a.com", ["b.com"], "none"), 80);
    expect(labels).toContain("traefik.http.routers.app1.rule=Host(`a.com`) || Host(`b.com`)");
  });
  test("redirect adds a second router, a redirectregex middleware and TLS for the redirected host", () => {
    const labels = traefikLabels("app1", computeRouting("a.com", [], "root_to_www"), 80);
    expect(labels).toContain("traefik.http.routers.app1.rule=Host(`www.a.com`)");
    expect(labels).toContain("traefik.http.routers.app1-redir.rule=Host(`a.com`)");
    expect(labels).toContain("traefik.http.routers.app1-redir.tls.certresolver=letsencrypt");
    expect(labels).toContain("traefik.http.routers.app1-redir.middlewares=app1-redir");
    expect(labels).toContain(String.raw`traefik.http.middlewares.app1-redir.redirectregex.regex=^https?://a\.com/(.*)`);
    expect(labels).toContain("traefik.http.middlewares.app1-redir.redirectregex.replacement=https://www.a.com/${1}");
    expect(labels).toContain("traefik.http.middlewares.app1-redir.redirectregex.permanent=true");
  });
});

describe("pending changes", () => {
  const digest = (t: string) => `d(${t.length})`;
  const app = { repoUrl: "r", branch: "main", port: 3000, domain: "a.com", extraDomains: ["z.com", "b.com"], envContent: "A=1", memoryLimitMb: null };
  const base = configSnapshot(app, [{ name: "data", mountPath: "/data" }], digest);

  test("never deployed -> null", () => {
    expect(pendingChanges(null, base)).toBeNull();
  });
  test("identical -> empty", () => {
    expect(pendingChanges(base, configSnapshot({ ...app }, [{ name: "data", mountPath: "/data" }], digest))).toEqual([]);
  });
  test("reports each changed field once, by label", () => {
    const now = configSnapshot({ ...app, domain: "b.com", envContent: "A=12", port: 8080 }, [], digest);
    expect(pendingChanges(base, now)).toEqual(["Porta", "Domínio", "Variáveis de ambiente", "Armazenamento persistente"]);
  });
  test("order of extra domains does not matter; env is stored as a digest, not plain", () => {
    expect(pendingChanges(base, configSnapshot({ ...app, extraDomains: ["b.com", "z.com"] }, [{ name: "data", mountPath: "/data" }], digest))).toEqual([]);
    expect(base.envContent).toBe("d(3)");
    expect(base.volumes).toBe("volume:data:/data::");
    const withFile = configSnapshot(app, [{ name: "cfg", mountPath: "/c", kind: "file", fileContent: "abcd" }], digest);
    expect(withFile.volumes).toBe("file:cfg:/c::d(4)");
  });
  test("a field missing from an old snapshot is not reported", () => {
    const old = { ...base };
    delete old.wwwRedirect;
    expect(pendingChanges(old, { ...base, wwwRedirect: "root_to_www" })).toEqual([]);
  });
});

describe("serializeEnvEntries", () => {
  test("round-trips through parseEnvContent, including build/both prefixes", () => {
    const text = "A=1\nbuild:B=two words\nboth:C=x=y\n";
    expect(serializeEnvEntries(parseEnvContent(text))).toBe(text);
  });
  test("empty list -> empty string", () => {
    expect(serializeEnvEntries([])).toBe("");
  });
});
