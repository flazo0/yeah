import { describe, expect, test } from "bun:test";
import { ipAllowed, isValidIpList } from "./ipAllowlist";

describe("ipAllowlist", () => {
  test("empty list allows anything", () => {
    expect(ipAllowed("1.2.3.4", null)).toBe(true);
  });
  test("exact and CIDR matching", () => {
    expect(ipAllowed("203.0.113.5", "203.0.113.5, 10.0.0.0/8")).toBe(true);
    expect(ipAllowed("10.200.1.1", "203.0.113.5, 10.0.0.0/8")).toBe(true);
    expect(ipAllowed("11.0.0.1", "203.0.113.5, 10.0.0.0/8")).toBe(false);
    expect(ipAllowed("192.168.1.130", "192.168.1.128/25")).toBe(true);
    expect(ipAllowed("192.168.1.5", "192.168.1.128/25")).toBe(false);
    expect(ipAllowed("unknown", "10.0.0.0/8")).toBe(false);
    expect(ipAllowed("::1", "::1")).toBe(true);
  });
  test("validation", () => {
    expect(isValidIpList("1.2.3.4, 10.0.0.0/8")).toBe(true);
    expect(isValidIpList("1.2.3.4/33")).toBe(false);
    expect(isValidIpList("banana")).toBe(false);
    expect(isValidIpList(" , ")).toBe(false);
  });
});
