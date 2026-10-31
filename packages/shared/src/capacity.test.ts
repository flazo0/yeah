import { describe, expect, test } from "bun:test";
import { summarizeCapacity, SYSTEM_RESERVE_MB } from "./capacity";

const limited = (mb: number, n: number) => Array.from({ length: n }, () => ({ memoryLimitMb: mb }));

describe("summarizeCapacity", () => {
  test("a 4 GB server keeps a reserve for the system", () => {
    const s = summarizeCapacity(4096, []);
    expect(s.availableMb).toBe(4096 - SYSTEM_RESERVE_MB);
    expect(s.status).toBe("ok");
    expect(s.commitRatio).toBe(0);
  });

  test("50 projects of 64 MB fit with room to spare", () => {
    const s = summarizeCapacity(4096, limited(64, 50));
    expect(s.committedMb).toBe(3200);
    expect(s.commitRatio).toBeCloseTo(3200 / 3328, 5);
    expect(s.status).toBe("ok");
    expect(s.evenShareMb).toBe(Math.floor(3328 / 50));
  });

  test("limits adding up to more than the available memory are flagged, not refused", () => {
    expect(summarizeCapacity(4096, limited(128, 30)).status).toBe("tight");
    expect(summarizeCapacity(4096, limited(256, 50)).status).toBe("over");
  });

  test("resources without a limit are counted and make a nearly full server tight", () => {
    const resources = [...limited(256, 10), { memoryLimitMb: null }, { memoryLimitMb: 0 }];
    const s = summarizeCapacity(4096, resources);
    expect(s.unlimitedCount).toBe(2);
    expect(s.committedMb).toBe(2560);
    expect(s.status).toBe("tight");
  });

  test("unlimited resources alone are fine on a mostly empty server", () => {
    const s = summarizeCapacity(4096, [{ memoryLimitMb: null }, { memoryLimitMb: null }]);
    expect(s.unlimitedCount).toBe(2);
    expect(s.status).toBe("ok");
  });

  test("a server smaller than the reserve has nothing available", () => {
    const s = summarizeCapacity(512, limited(64, 2));
    expect(s.availableMb).toBe(0);
    expect(s.commitRatio).toBe(Infinity);
    expect(s.status).toBe("over");
  });
});
