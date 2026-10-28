import { describe, expect, test } from "bun:test";
import { redactSecrets, secretValues } from "./redact";

describe("redaction", () => {
  test("masks every occurrence of a secret, and only secrets long enough to matter", () => {
    const secrets = secretValues(["s3cr3t-token", "true", "3000", "  s3cr3t-token  "]);
    expect(secrets).toEqual(["s3cr3t-token"]);
    expect(redactSecrets("connecting with s3cr3t-token ... retry s3cr3t-token port 3000 true", secrets)).toBe("connecting with *** ... retry *** port 3000 true");
  });

  test("a longer secret that contains a shorter one is masked whole", () => {
    const secrets = secretValues(["abcdef", "abcdef-extra-long"]);
    expect(redactSecrets("key=abcdef-extra-long", secrets)).toBe("key=***");
  });

  test("no secrets, nothing changes", () => {
    expect(redactSecrets("hello", [])).toBe("hello");
  });
});
