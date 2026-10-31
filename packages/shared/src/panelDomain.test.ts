import { describe, expect, test } from "bun:test";
import { normalizePanelDomain, PANEL_BACKEND_URL, panelRouteConfig, withPanelOrigin } from "./panelDomain";

describe("normalizePanelDomain", () => {
  test("cleans what people paste", () => {
    expect(normalizePanelDomain(" https://Panel.Example.com/login ")).toEqual({ ok: true, domain: "panel.example.com" });
    expect(normalizePanelDomain("panel.example.com.")).toEqual({ ok: true, domain: "panel.example.com" });
  });
  test("refuses names that cannot get a certificate", () => {
    for (const bad of ["", "   ", "localhost", "panel.local", "10.0.0.5", "203.0.113.9", "*.example.com", "panel", "panel.example.com:8443", "bad_host.example.com", "-x.example.com"]) {
      expect(normalizePanelDomain(bad).ok, bad).toBe(false);
    }
  });
  test("the messages are actionable", () => {
    const r = normalizePanelDomain("203.0.113.9");
    expect(r.ok ? "" : r.error).toContain("domain name");
  });
});

describe("panelRouteConfig", () => {
  const yaml = panelRouteConfig("panel.example.com");
  test("routes the host to the web container over HTTPS with Let's Encrypt", () => {
    expect(yaml).toContain("Host(`panel.example.com`)");
    expect(yaml).toContain("certResolver: letsencrypt");
    expect(yaml).toContain("- websecure");
    expect(yaml).toContain(`url: "${PANEL_BACKEND_URL}"`);
  });
  test("is valid YAML", () => {
    const doc = (Bun as unknown as { YAML: { parse(t: string): any } }).YAML.parse(yaml);
    expect(doc.http.routers["yeah-panel"].service).toBe("yeah-panel");
    expect(doc.http.services["yeah-panel"].loadBalancer.servers[0].url).toBe(PANEL_BACKEND_URL);
  });
  test("outranks the catch-all error-page router", () => {
    expect(yaml).toContain("priority: 10000");
  });
});

describe("withPanelOrigin", () => {
  test("adds the panel's HTTPS origin to the configured ones", () => {
    expect(withPanelOrigin("http://1.2.3.4:8080", "panel.example.com")).toBe("http://1.2.3.4:8080,https://panel.example.com");
  });
  test("does not add it twice, whatever the case or trailing slash", () => {
    expect(withPanelOrigin("https://Panel.Example.com/", "panel.example.com")).toBe("https://Panel.Example.com/");
  });
  test("no domain: unchanged", () => {
    expect(withPanelOrigin("http://a, http://b", null)).toBe("http://a,http://b");
  });
  test("an empty WEB_ORIGIN means accept any, and stays that way", () => {
    expect(withPanelOrigin(undefined, "panel.example.com")).toBe("");
    expect(withPanelOrigin("", "panel.example.com")).toBe("");
  });
});

import { panelAttachCommand, panelDetachCommand, PANEL_BACKEND_HOST, PANEL_INSTALL_DIR } from "./panelDomain";

describe("panel network commands", () => {
  const attach = panelAttachCommand("yeah-proxy-net", "/opt/yeah-proxy");
  test("find the web container of the panel's own compose project, not any container named web", () => {
    expect(attach).toContain("label=com.docker.compose.service=web");
    expect(attach).toContain(`com.docker.compose.project.working_dir=${PANEL_INSTALL_DIR}`);
  });
  test("attach under the fixed alias, replacing an older attachment", () => {
    expect(attach).toContain(`docker network connect --alias ${PANEL_BACKEND_HOST} 'yeah-proxy-net'`);
    expect(attach.indexOf("disconnect")).toBeLessThan(attach.indexOf("connect --alias"));
  });
  test("do nothing when the proxy network does not exist", () => {
    expect(attach).toContain("docker network inspect 'yeah-proxy-net'");
  });
  test("after an update, only reattach when the route file exists", () => {
    expect(panelAttachCommand("n", "/p", true)).toContain("[ -f '/p/dynamic/yeah-panel.yml' ]");
    expect(attach).not.toContain("[ -f ");
  });
  test("detach always succeeds", () => {
    expect(panelDetachCommand("n").endsWith("; true")).toBe(true);
  });
});
