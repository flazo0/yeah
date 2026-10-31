import { describe, expect, test } from "bun:test";
import { generateRecoveryPassword, parseResetArgs } from "./passwordReset";

describe("generateRecoveryPassword", () => {
  test("is long, readable and different every time", () => {
    const a = generateRecoveryPassword();
    const b = generateRecoveryPassword();
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-zA-Z2-9]+$/);
    expect(a).not.toMatch(/[0O1lI]/);
  });
});

describe("parseResetArgs", () => {
  test("no arguments: the only account, a generated password", () => {
    expect(parseResetArgs([], {})).toEqual({ email: null, disable2fa: false, password: null });
  });
  test("an e-mail is lower-cased; --disable-2fa is a flag", () => {
    expect(parseResetArgs([" Me@Example.com ", "--disable-2fa"], {})).toEqual({ email: "me@example.com", disable2fa: true, password: null });
  });
  test("the password only comes from the environment", () => {
    expect(parseResetArgs([], { YEAH_NEW_PASSWORD: "s3cret-pass" }).password).toBe("s3cret-pass");
    expect(parseResetArgs([], { YEAH_NEW_PASSWORD: "" }).password).toBeNull();
  });
  test("unknown options and extra arguments are refused", () => {
    expect(parseResetArgs(["--password=x"], {}).error).toContain("unknown option");
    expect(parseResetArgs(["a@b.c", "d@e.f"], {}).error).toContain("at most one");
  });
});
