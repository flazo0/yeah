import { describe, expect, test } from "bun:test";
import { utils } from "ssh2";
import { generateSshKeyPair } from "./keygen";

describe("generateSshKeyPair", () => {
  test("ssh2 parses the private key and derives the same public key we hand out", () => {
    const { privateKey, publicKey } = generateSshKeyPair("yeah-test");
    const parsed = utils.parseKey(privateKey);
    expect(parsed instanceof Error).toBe(false);
    if (parsed instanceof Error) return;
    expect(parsed.type).toBe("ssh-ed25519");
    const [type, blob, comment] = publicKey.split(" ");
    expect(type).toBe("ssh-ed25519");
    expect(comment).toBe("yeah-test");
    expect(parsed.getPublicSSH().toString("base64")).toBe(blob!);
  });

  test("every call yields a different key", () => {
    expect(generateSshKeyPair().publicKey).not.toBe(generateSshKeyPair().publicKey);
  });

  test("private key is PEM-armored with lines of at most 70 characters", () => {
    const { privateKey } = generateSshKeyPair();
    const lines = privateKey.trim().split("\n");
    expect(lines[0]).toBe("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(lines.at(-1)).toBe("-----END OPENSSH PRIVATE KEY-----");
    expect(lines.slice(1, -1).every((l) => l.length <= 70)).toBe(true);
  });
});
