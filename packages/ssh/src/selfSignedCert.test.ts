import { describe, expect, test } from "bun:test";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { generateSelfSignedCert } from "./selfSignedCert";

describe("generateSelfSignedCert", () => {
  const { certPem, keyPem } = generateSelfSignedCert("yeah-db-1", 30);
  const cert = new X509Certificate(certPem);

  test("parses as an X.509 certificate with the requested name", () => {
    expect(cert.subject).toBe("CN=yeah-db-1");
    expect(cert.issuer).toBe("CN=yeah-db-1");
    expect(cert.subjectAltName).toBe("DNS:yeah-db-1");
    expect(cert.checkHost("yeah-db-1")).toBe("yeah-db-1");
  });
  test("is self-signed with a valid signature", () => {
    expect(cert.verify(cert.publicKey)).toBe(true);
  });
  test("the private key belongs to the certificate", () => {
    expect(cert.checkPrivateKey(createPrivateKey(keyPem))).toBe(true);
    expect(keyPem.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true);
  });
  test("validity starts a day ago and lasts the requested days", () => {
    const from = new Date(cert.validFrom).getTime();
    const to = new Date(cert.validTo).getTime();
    expect(from).toBeLessThan(Date.now());
    expect(Math.round((to - from) / 86_400_000)).toBe(30);
  });
  test("every call makes a new key and serial", () => {
    const other = new X509Certificate(generateSelfSignedCert("yeah-db-1").certPem);
    expect(other.serialNumber).not.toBe(cert.serialNumber);
  });
});
