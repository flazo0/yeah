import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { Elysia } from "elysia";

// Elysia only validates the route tree when the app compiles (at `.listen`). Two route files that put different
// parameter names on the same path (`/:applicationId/files` vs `/:resourceId/files`) throw there, and nothing else
// notices: unit tests import each route file alone. This compiles every route module together, the way index.ts does.
describe("API route tree", () => {
  test("all route modules compile together without conflicting parameters", async () => {
    const dir = new URL(".", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const app = new Elysia();
    let mounted = 0;
    for (const file of files) {
      const mod = (await import(new URL(file, dir).href)) as Record<string, unknown>;
      for (const value of Object.values(mod)) {
        if (value instanceof Elysia) {
          app.use(value);
          mounted++;
        }
      }
    }
    expect(mounted).toBeGreaterThan(20);
    expect(() => app.compile()).not.toThrow();
  });
});
