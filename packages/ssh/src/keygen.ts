import { generateKeyPairSync, randomBytes } from "node:crypto";

export interface SshKeyPair {
  /** OpenSSH-format private key ("-----BEGIN OPENSSH PRIVATE KEY-----"), what the servers form expects. */
  privateKey: string;
  /** One-line public key ("ssh-ed25519 AAAA... comment"), ready to append to ~/.ssh/authorized_keys. */
  publicKey: string;
}

function sshString(data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, data]);
}

function uint32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0);
  return buf;
}

/**
 * Generates an ed25519 keypair in the OpenSSH formats. Node only exports PKCS#8 for private keys and
 * ssh2 (what the worker connects with) can't parse that for ed25519, so the "openssh-key-v1" container
 * is assembled by hand — unencrypted, single key.
 */
export function generateSshKeyPair(comment = "yeah"): SshKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from((privateKey.export({ format: "jwk" }) as { d: string }).d, "base64url");
  const pub = Buffer.from((publicKey.export({ format: "jwk" }) as { x: string }).x, "base64url");

  const keyType = Buffer.from("ssh-ed25519");
  const publicBlob = Buffer.concat([sshString(keyType), sshString(pub)]);

  const check = randomBytes(4);
  let privateSection = Buffer.concat([
    check,
    check,
    sshString(keyType),
    sshString(pub),
    sshString(Buffer.concat([seed, pub])),
    sshString(Buffer.from(comment)),
  ]);
  const padding = (8 - (privateSection.length % 8)) % 8;
  privateSection = Buffer.concat([privateSection, Buffer.from(Array.from({ length: padding }, (_, i) => i + 1))]);

  const body = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    sshString(Buffer.from("none")),
    sshString(Buffer.from("none")),
    sshString(Buffer.alloc(0)),
    uint32(1),
    sshString(publicBlob),
    sshString(privateSection),
  ]);

  const wrapped = body.toString("base64").match(/.{1,70}/g)!.join("\n");
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapped}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${publicBlob.toString("base64")} ${comment}`,
  };
}
