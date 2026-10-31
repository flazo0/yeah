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

/** Part size of a streamed upload. S3 needs at least 5 MiB per part (except the last) and allows 10,000 parts, so 8 MiB reaches 80 GB. */
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;

/**
 * Uploads a stream to `key` as a multipart upload without holding the file in memory: at most a few parts
 * (about 3 x UPLOAD_PART_BYTES) are in flight, and the source is only read as fast as S3 accepts it.
 * On failure the partial object is deleted (best effort) and the error is rethrown. Returns the bytes sent.
 */
export async function uploadStream(client: Bun.S3Client, key: string, source: AsyncIterable<Uint8Array>): Promise<number> {
  const writer = client.file(key).writer({ partSize: UPLOAD_PART_BYTES, queueSize: 2, retry: 3 });
  let sent = 0;
  try {
    for await (const chunk of source) {
      const pending = writer.write(chunk);
      sent += chunk.byteLength;
      // A promise means the part queue is full: waiting here is the back-pressure that keeps memory flat.
      if (pending instanceof Promise) await pending;
    }
    await writer.end();
    return sent;
  } catch (err) {
    try {
      await writer.end();
    } catch {
      // the upload is being abandoned anyway
    }
    await client.delete(key).catch(() => undefined);
    throw err;
  }
}

/**
 * Reads an object as a sequence of ranged requests of `chunkBytes` each, one at a time and only when the consumer
 * asks for the next one. `file.stream()` would download as fast as the network allows and pile the data up in
 * memory whenever the destination (an SFTP write, say) is slower, which is exactly the case this exists for.
 */
/** Size of one ranged read in downloadStream. Small on purpose: an SFTP writer queues several chunks when it is slower than S3, so memory grows with the count of queued chunks. */
export const DOWNLOAD_CHUNK_BYTES = 1024 * 1024;
const GC_EVERY_BYTES = 16 * 1024 * 1024;

export async function* downloadStream(client: Bun.S3Client, key: string, chunkBytes = DOWNLOAD_CHUNK_BYTES): AsyncGenerator<Uint8Array> {
  const file = client.file(key);
  const { size } = await file.stat();
  let sinceGc = 0;
  for (let offset = 0; offset < size; offset += chunkBytes) {
    const chunk = new Uint8Array(await file.slice(offset, Math.min(offset + chunkBytes, size)).arrayBuffer());
    yield chunk;
    // Bun frees the ArrayBuffers of discarded chunks lazily: measured, reading 120 MB in 1 MB chunks left about 56 MB
    // of dead buffers around (177 MB of RSS with 8 MB chunks). A collection every few chunks keeps a large restore
    // inside the worker's memory limit.
    sinceGc += chunk.byteLength;
    if (sinceGc >= GC_EVERY_BYTES) {
      Bun.gc(true);
      sinceGc = 0;
    }
  }
}
