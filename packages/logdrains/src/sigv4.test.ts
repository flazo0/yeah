import { describe, expect, test } from "bun:test";
import { amzDateNow, signRequest } from "./sigv4";

describe("signRequest", () => {
  // AWS's published "get-vanilla" test vector (Signature Version 4 test suite).
  test("matches the AWS get-vanilla test vector", () => {
    const signed = signRequest({
      method: "GET",
      host: "example.amazonaws.com",
      path: "/",
      headers: {},
      body: "",
      region: "us-east-1",
      service: "service",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      amzDate: "20150830T123600Z",
    });
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  test("extra headers are signed too", () => {
    const signed = signRequest({ method: "POST", host: "logs.eu-west-1.amazonaws.com", path: "/", headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "Logs_20140328.PutLogEvents" }, body: "{}", region: "eu-west-1", service: "logs", accessKeyId: "AK", secretAccessKey: "SK", amzDate: "20260101T000000Z" });
    expect(signed.authorization).toContain("SignedHeaders=content-type;host;x-amz-date;x-amz-target");
  });

  test("amz date format", () => {
    expect(amzDateNow(new Date("2026-10-28T14:05:09.123Z"))).toBe("20261028T140509Z");
  });
});
