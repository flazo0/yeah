import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

// Self-signed TLS certificates for databases. Node can generate keys but not X.509 certificates, and
// the servers have no guaranteed openssl — so the (small, fixed-shape) certificate is assembled in
// DER by hand and signed with ECDSA P-256, the same approach as the OpenSSH key in keygen.ts.

export interface SelfSignedCert {
  /** PEM certificate ("-----BEGIN CERTIFICATE-----"). */
  certPem: string;
  /** PEM private key, PKCS#8 ("-----BEGIN PRIVATE KEY-----"). */
  keyPem: string;
}

const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  let len: Buffer;
  if (body.length < 0x80) len = Buffer.from([body.length]);
  else if (body.length < 0x100) len = Buffer.from([0x81, body.length]);
  else len = Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};

const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);
const oid = (dotted: string) => {
  const nums = dotted.split(".").map(Number);
  const out: number[] = [nums[0]! * 40 + nums[1]!];
  for (const n of nums.slice(2)) {
    const bytes = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80);
    out.push(...bytes);
  }
  return der(0x06, Buffer.from(out));
};
const utf8 = (s: string) => der(0x0c, Buffer.from(s, "utf8"));
const utcTime = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return der(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`));
};

const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";

const pem = (label: string, buf: Buffer) => `-----BEGIN ${label}-----\n${buf.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

/**
 * A certificate for `commonName` (also its DNS subject alternative name), valid from now for `days`.
 * Meant for encrypting the connection to a database, not for proving its identity.
 */
export function generateSelfSignedCert(commonName: string, days = 3650): SelfSignedCert {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;

  // Back-dated a day so a server whose clock runs a little slow does not see a certificate "from the future".
  const notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  const notAfter = new Date(notBefore.getTime() + days * 24 * 3600 * 1000);

  const name = seq(set(seq(oid("2.5.4.3"), utf8(commonName))));
  const serial = randomBytes(16);
  serial[0]! &= 0x7f; // positive INTEGER
  if (serial[0] === 0) serial[0] = 1;

  const san = seq(oid("2.5.29.17"), der(0x04, seq(der(0x82, Buffer.from(commonName, "utf8")))));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), // version v3
    der(0x02, serial),
    seq(oid(OID_ECDSA_SHA256)),
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    spki,
    der(0xa3, seq(san)),
  );
  const signature = sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  const cert = seq(tbs, seq(oid(OID_ECDSA_SHA256)), der(0x03, Buffer.concat([Buffer.from([0]), signature])));

  return { certPem: pem("CERTIFICATE", cert), keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

void createPrivateKey;
