import { describe, expect, test } from "bun:test";
import { addressesOf } from "./instance";

describe("addressesOf", () => {
  test("a literal address resolves to itself, without a lookup", async () => {
    expect(await addressesOf("203.0.113.7")).toEqual(["203.0.113.7"]);
    expect(await addressesOf("2001:db8::1")).toEqual(["2001:db8::1"]);
  });
  test("localhost resolves through the system resolver", async () => {
    const found = await addressesOf("localhost");
    expect(found.some((a) => a === "127.0.0.1" || a === "::1")).toBe(true);
  });
  test("a name that does not exist gives an empty list instead of throwing", async () => {
    expect(await addressesOf("this-name-does-not-exist-9f3a.invalid")).toEqual([]);
  });
});
