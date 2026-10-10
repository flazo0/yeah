import { describe, expect, test } from "bun:test";
import pt from "../locales/pt.json";
import en from "../locales/en.json";
import { pickLocale } from "./i18n";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "object" && v ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe("i18n", () => {
  test("pt and en define the same keys", () => {
    expect(keys(en).sort()).toEqual(keys(pt).sort());
  });
  test("pickLocale prefers a stored valid choice, then the browser language", () => {
    expect(pickLocale("en", "pt-BR")).toBe("en");
    expect(pickLocale("xx", "en-US")).toBe("en");
    expect(pickLocale(null, "pt-BR")).toBe("pt");
    expect(pickLocale(null, undefined)).toBe("pt");
  });
});
