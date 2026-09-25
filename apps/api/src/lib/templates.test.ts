import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { generateSecret, loadTemplates, parseTemplate, renderTemplateEnv, TEMPLATES_DIR } from "./templates";

describe("the shipped templates", () => {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".yml"));
  test("there are many, and every single file is valid (compose parses, main exists, env keys are sane)", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(loadTemplates().length).toBe(files.length);
  });
  test("keys are unique and names are filled in", () => {
    const templates = loadTemplates();
    expect(new Set(templates.map((t) => t.key)).size).toBe(templates.length);
    for (const t of templates) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.icon).toMatch(/^[a-z0-9_]+$/);
    }
  });
  test("every ${VAR} used by a compose has a value in the template's env (or a default)", () => {
    for (const t of loadTemplates()) {
      const used = [...t.compose.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g)].filter((m) => !m[2]).map((m) => m[1]!);
      for (const v of used) expect(Object.keys(t.env)).toContain(v);
    }
  });
  test("the multi-container ones really have several services", () => {
    const wp = loadTemplates().find((t) => t.key === "wordpress")!;
    expect(wp.services).toEqual(["wordpress", "db"]);
    expect(wp.mainService).toBe("wordpress");
  });
});

describe("parseTemplate", () => {
  const good = `name: X\ndescription: A test service\nmain: web\nport: 80\nenv:\n  A: "1"\ncompose: |\n  services:\n    web:\n      image: nginx\n`;
  test("accepts a minimal template", () => {
    const r = parseTemplate("x", good);
    expect("template" in r && r.template.services).toEqual(["web"]);
  });
  test("reports what is wrong", () => {
    expect(parseTemplate("x", "name: X")).toHaveProperty("error");
    expect(parseTemplate("x", good.replace("main: web", "main: nope"))).toHaveProperty("error");
    expect(parseTemplate("x", good.replace("port: 80", "port: 0"))).toHaveProperty("error");
    expect(parseTemplate("x", good.replace("A:", "bad-name:"))).toHaveProperty("error");
    expect(parseTemplate("x", "a: [")).toHaveProperty("error");
    expect(parseTemplate("x", good.replace("image: nginx", "build: ."))).toHaveProperty("error");
  });
});

describe("secrets", () => {
  test("kinds and shapes", () => {
    expect(generateSecret("password")).toMatch(/^[0-9a-f]{24}$/);
    expect(generateSecret("hex")).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSecret("base64")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSecret("nope")).toBeNull();
  });
  test("renderTemplateEnv fills markers with fresh values and keeps plain defaults", () => {
    const t = loadTemplates().find((x) => x.key === "wordpress")!;
    const a = renderTemplateEnv(t);
    const b = renderTemplateEnv(t);
    expect(a).toMatch(/^DB_PASSWORD=[0-9a-f]{24}$/m);
    expect(a).not.toBe(b);
    const n8n = renderTemplateEnv(loadTemplates().find((x) => x.key === "n8n")!);
    expect(n8n).toContain("N8N_PROTOCOL=http\n");
  });
});
