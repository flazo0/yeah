import { describe, expect, test } from "bun:test";
import { findServiceCatalogEntry, SERVICE_CATALOG } from "./serviceCatalog";

describe("SERVICE_CATALOG", () => {
  test("every entry has a unique key", () => {
    const keys = SERVICE_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every entry has a non-empty image and a valid port", () => {
    for (const entry of SERVICE_CATALOG) {
      expect(entry.image.length).toBeGreaterThan(0);
      expect(entry.port).toBeGreaterThan(0);
    }
  });
});

describe("findServiceCatalogEntry", () => {
  test("finds an existing entry by key", () => {
    const entry = findServiceCatalogEntry(SERVICE_CATALOG[0]!.key);
    expect(entry).toBe(SERVICE_CATALOG[0]);
  });

  test("returns undefined for an unknown key", () => {
    expect(findServiceCatalogEntry("not-a-real-service")).toBeUndefined();
  });
});
