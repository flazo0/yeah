import { describe, expect, test } from "bun:test";
import { buildOpenApiSpec } from "./openapi";

describe("buildOpenApiSpec", () => {
  test("documents every v1 route with bearer auth", () => {
    const spec = buildOpenApiSpec();
    expect(Object.keys(spec.paths)).toHaveLength(12);
    for (const item of Object.values(spec.paths)) {
      for (const op of Object.values(item)) expect(op.security).toEqual([{ bearerAuth: [] }]);
    }
  });
});
