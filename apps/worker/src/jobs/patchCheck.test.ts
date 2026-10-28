import { describe, expect, test } from "bun:test";
import { shouldNotifySecurity } from "./patchCheck";

const status = (security: number) => ({ updates: security + 2, security, rebootRequired: false, packages: [] });

describe("patch notifications", () => {
  test("nothing pending, nothing to say", () => {
    expect(shouldNotifySecurity(status(0), 0)).toBe(false);
  });
  test("announces the first batch, then stays quiet while it is unchanged", () => {
    expect(shouldNotifySecurity(status(3), 0)).toBe(true);
    expect(shouldNotifySecurity(status(3), 3)).toBe(false);
    expect(shouldNotifySecurity(status(2), 3)).toBe(false);
  });
  test("announces again when more security updates pile up", () => {
    expect(shouldNotifySecurity(status(5), 3)).toBe(true);
  });
});
