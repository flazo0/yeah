import { Readable } from "node:stream";
import { openRemoteReadStream, type Client } from "@yeah/ssh";

/**
 * A download response that streams a file from a server over SFTP: the API never holds the file in memory (a
 * database backup can be larger than the API container's limit). The SSH connection is closed when the
 * stream ends, fails, or the browser cancels the download; it is closed right away if the file cannot be opened.
 */
export async function remoteFileResponse(conn: Client, remotePath: string, headers: Record<string, string>): Promise<Response> {
  let opened: Awaited<ReturnType<typeof openRemoteReadStream>>;
  try {
    opened = await openRemoteReadStream(conn, remotePath);
  } catch (err) {
    conn.end();
    throw err;
  }
  opened.stream.once("close", () => conn.end());
  return new Response(Readable.toWeb(opened.stream) as unknown as ReadableStream<Uint8Array>, { headers: { ...headers, "Content-Length": String(opened.size) } });
}
