import { describe, expect, test } from "bun:test";
import { DATABASE_ENGINES, resourceLimitFlags } from "./types";

describe("resourceLimitFlags", () => {
  test("returns an empty string when both limits are null", () => {
    expect(resourceLimitFlags({ memoryLimitMb: null, cpuLimit: null })).toBe("");
  });

  test("includes only --memory when only memory is set", () => {
    expect(resourceLimitFlags({ memoryLimitMb: 512, cpuLimit: null })).toBe("--memory=512m ");
  });

  test("includes only --cpus when only cpu is set", () => {
    expect(resourceLimitFlags({ memoryLimitMb: null, cpuLimit: 1.5 })).toBe("--cpus=1.5 ");
  });

  test("includes both flags space-separated, with a trailing space", () => {
    expect(resourceLimitFlags({ memoryLimitMb: 256, cpuLimit: 0.5 })).toBe("--memory=256m --cpus=0.5 ");
  });

  test("treats memoryLimitMb: 0 as unset (falsy), same as null", () => {
    // Matches the implementation's `if (limits.memoryLimitMb)` truthiness check — 0 MB isn't a
    // meaningful limit anyway, so this documents the actual (intentional) behavior.
    expect(resourceLimitFlags({ memoryLimitMb: 0, cpuLimit: null })).toBe("");
  });
});

describe("DATABASE_ENGINES", () => {
  test("redis has no username or database name fields", () => {
    expect(DATABASE_ENGINES.redis.hasUsername).toBe(false);
    expect(DATABASE_ENGINES.redis.hasDatabaseName).toBe(false);
  });

  test("postgresql, mysql, mariadb and mongodb all have username and database name fields", () => {
    for (const engine of ["postgresql", "mysql", "mariadb", "mongodb"] as const) {
      expect(DATABASE_ENGINES[engine].hasUsername).toBe(true);
      expect(DATABASE_ENGINES[engine].hasDatabaseName).toBe(true);
    }
  });

  test("every engine has a non-empty default image and a valid port", () => {
    for (const info of Object.values(DATABASE_ENGINES)) {
      expect(info.defaultImage.length).toBeGreaterThan(0);
      expect(info.defaultPort).toBeGreaterThan(0);
    }
  });
});
