import { describe, expect, test } from "bun:test";
import { errorPageConfigJson, errorPageDynamicConfig, errorPageEntryPointYaml, normalizeErrorPageText } from "./errorPage";
import { traefikStaticConfig } from "./traefikStatic";

describe("error page config", () => {
  test("text is trimmed, stripped of control characters and capped; empty becomes null", () => {
    expect(normalizeErrorPageText("  Back soon \n", 50)).toBe("Back soon");
    expect(normalizeErrorPageText("a\u0000b\u001fc", 50)).toBe("a b c");
    expect(normalizeErrorPageText("x".repeat(200), 120)?.length).toBe(120);
    expect(normalizeErrorPageText("   ", 50)).toBeNull();
    expect(normalizeErrorPageText(undefined, 50)).toBeNull();
    expect(normalizeErrorPageText(null, 50)).toBeNull();
  });

  test("text is stored raw (escaping happens when the page is rendered)", () => {
    expect(normalizeErrorPageText("<b>hi</b>", 50)).toBe("<b>hi</b>");
    expect(JSON.parse(errorPageConfigJson({ title: "<b>t</b>", message: null }))).toEqual({ title: "<b>t</b>", message: "" });
  });

  test("the dynamic config routes unknown hosts and 502-504 to the waker", () => {
    const yaml = errorPageDynamicConfig();
    expect(yaml).toContain("priority: 1\n");
    expect(yaml).toContain("HostRegexp(`{host:.+}`)");
    expect(yaml).toContain('- "502-504"');
    expect(yaml).toContain('query: "/__error/{status}"');
    expect(yaml).toContain('- url: "http://yeah-waker:8080"');
    expect(yaml).toContain("yeah-errors:");
  });

  test("static config is unchanged when the error page is off and gains the entry-point middleware when on", () => {
    expect(errorPageEntryPointYaml(false)).toBe("");
    const off = traefikStaticConfig("a@b.co", false);
    expect(off).not.toContain("middlewares");
    expect(off).toContain('  websecure:\n    address: ":443"\n\nproviders:');
    const on = traefikStaticConfig("a@b.co", false, true);
    expect(on).toContain('  websecure:\n    address: ":443"\n    http:\n      middlewares:\n        - yeah-errors@file\n');
    const both = traefikStaticConfig("a@b.co", true, true);
    expect(both).toContain('        - yeah-errors@file\n  metrics:\n    address: ":8082"');
  });
});
