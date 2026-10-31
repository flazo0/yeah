export interface S3Credentials {
  /** null means real AWS S3 (region-based endpoint); set it for MinIO/R2/Spaces/etc. */
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Thin wrapper so callers never construct `Bun.S3Client` by hand — endpoint stays optional in one place. */
export function s3ClientFor(creds: S3Credentials): Bun.S3Client {
  return new Bun.S3Client({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    bucket: creds.bucket,
    region: creds.region,
    ...(creds.endpoint ? { endpoint: creds.endpoint } : {}),
  });
}
