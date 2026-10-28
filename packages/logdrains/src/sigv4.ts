import { createHash, createHmac } from "node:crypto";

// AWS Signature Version 4 for a single JSON POST (enough for CloudWatch Logs) — no SDK dependency.

const sha256Hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

export interface SigV4Input {
  method: string;
  host: string;
  /** Absolute path, already URI-encoded ("/" for CloudWatch). */
  path: string;
  /** Canonical (sorted, encoded) query string; empty for none. */
  query?: string;
  /** Extra headers to sign (lowercase names), e.g. content-type and x-amz-target. */
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "YYYYMMDDTHHMMSSZ" */
  amzDate: string;
}

/** Returns the headers to send (the input headers + host, x-amz-date and Authorization). */
export function signRequest(input: SigV4Input): Record<string, string> {
  const date = input.amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: input.host, "x-amz-date": input.amzDate };
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method, input.path, input.query ?? "", canonicalHeaders, signedHeaders, sha256Hex(input.body)].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export function amzDateNow(now: Date = new Date()): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
