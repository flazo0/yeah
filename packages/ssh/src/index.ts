import { Client } from "ssh2";
import { Readable } from "node:stream";
import { once } from "node:events";
import { shellQuote } from "@yeah/shared";
import type { TestConnectionResult } from "@yeah/shared";

export type { Client, ClientChannel } from "ssh2";

export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  /** Handshake timeout in ms; defaults to 15s for connectSsh and 10s for testSshConnection. */
  timeoutMs?: number;
}

export type TestConnectionOptions = SshConnectOptions;

/**
 * Connects over SSH and runs a read-only `docker --version` check.
 * Deliberately does not install anything — provisioning is a separate,
 * explicit job so an operator always sees what ran on their server.
 */
export function testSshConnection(opts: TestConnectionOptions): Promise<TestConnectionResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    const finish = (result: TestConnectionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        conn.end();
      } catch {
        // connection may never have been established (e.g. malformed key) — nothing to close
      }
      resolve(result);
    };

    const timeout = setTimeout(() => finish({ ok: false, error: "connection timed out" }), opts.timeoutMs ?? 10_000);

    conn
      .on("ready", () => {
        conn.exec("docker --version", (err, stream) => {
          if (err) {
            finish({ ok: false, error: err.message });
            return;
          }
          let stdout = "";
          stream
            .on("close", () => {
              finish({ ok: true, dockerVersion: stdout.trim() || undefined });
            })
            .on("data", (chunk: Buffer) => {
              stdout += chunk.toString();
            })
            .stderr.on("data", () => {
              // ignored: absence of docker surfaces as empty stdout, not a hard failure
            });
        });
      })
      .on("error", (err) => {
        finish({ ok: false, error: err.message });
      });

    // ssh2 can throw synchronously here (e.g. a malformed private key) instead
    // of emitting "error" — without this, that throw would crash the caller
    // (the worker's job) rather than surfacing as a normal failed result.
    try {
      conn.connect({
        host: opts.host,
        port: opts.port,
        username: opts.username,
        privateKey: opts.privateKey,
        readyTimeout: opts.timeoutMs ?? 10_000,
      });
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

// shellQuote itself has zero SSH dependency — it lives in @yeah/shared so pure command-building
// logic (docker run string construction, tested in apps/worker/src/jobs/*.test.ts) can use it
// without pulling in this whole module's ssh2 dependency. Re-exported here for existing callers.
export { shellQuote } from "@yeah/shared";

/**
 * Opens a long-lived SSH connection for a caller that needs to run several
 * commands / write files against the same server (a deploy, for instance) —
 * cheaper and simpler to reason about than reconnecting per step.
 */
export function connectSsh(opts: SshConnectOptions): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      conn.end();
      reject(new Error("connection timed out"));
    }, opts.timeoutMs ?? 15_000);

    conn
      .on("ready", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(conn);
      })
      .on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      });

    try {
      conn.connect({
        host: opts.host,
        port: opts.port,
        username: opts.username,
        privateKey: opts.privateKey,
        readyTimeout: opts.timeoutMs ?? 15_000,
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}

export interface ExecStreamResult {
  exitCode: number;
}

/** Runs one command over an already-connected client, streaming stdout/stderr as it arrives. */
export function execStream(
  conn: Client,
  command: string,
  onData: (chunk: string, stream: "stdout" | "stderr") => void,
): Promise<ExecStreamResult> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      stream
        .on("close", (code: number | null) => resolve({ exitCode: code ?? 0 }))
        .on("data", (chunk: Buffer) => onData(chunk.toString(), "stdout"))
        .stderr.on("data", (chunk: Buffer) => onData(chunk.toString(), "stderr"));
    });
  });
}

/** Writes `content` to `remotePath` over SFTP, creating/overwriting the file. */
export function writeRemoteFile(conn: Client, remotePath: string, content: string | Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      const stream = sftp.createWriteStream(remotePath);
      stream.on("error", reject);
      stream.on("close", resolve);
      stream.end(content);
    });
  });
}

/** Reads `remotePath` fully into memory over SFTP — fine for backup-sized files, not for huge ones. */
export function readRemoteFile(conn: Client, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(remotePath);
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

/**
 * Opens `remotePath` as a stream over SFTP, with its size, without reading it into memory. The SFTP session
 * ends with the stream; closing the SSH connection afterwards is up to the caller.
 */
export function openRemoteReadStream(conn: Client, remotePath: string): Promise<{ stream: Readable; size: number }> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) {
          sftp.end();
          reject(statErr);
          return;
        }
        const stream = sftp.createReadStream(remotePath);
        stream.on("close", () => sftp.end());
        resolve({ stream, size: stats.size });
      });
    });
  });
}

/**
 * Writes a stream to `remotePath` (creating/overwriting it) with real back-pressure, so nothing is buffered beyond
 * the SSH channel window (a few MB). The bytes go through the stdin of a `cat` on the server rather than through
 * SFTP: ssh2's SFTP write queue does not push back when the server is slower than the source (measured: about
 * half of a 120 MB file stayed in memory), and a plain channel does. Rejects when `cat` fails or the stream errors.
 */
export function writeRemoteFileStream(conn: Client, remotePath: string, source: Readable | AsyncIterable<Uint8Array>): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.exec(`cat > ${shellQuote(remotePath)}`, (err, channel) => {
      if (err) {
        reject(err);
        return;
      }
      let stderr = "";
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        channel.destroy();
        reject(e);
      };
      channel.on("error", fail);
      channel.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      channel.resume(); // cat prints nothing on stdout; an unread channel would stall
      channel.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        if ((code ?? 0) === 0) resolve();
        else reject(new Error(`writing ${remotePath} failed (exit ${code}): ${stderr.trim()}`));
      });
      (async () => {
        for await (const chunk of source) {
          if (!channel.write(chunk)) await once(channel, "drain");
        }
        channel.end();
      })().catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
    });
  });
}

/** Deletes `remotePath` over SFTP; resolves even if the file is already gone. */
export function removeRemoteFile(conn: Client, remotePath: string): Promise<void> {
  return new Promise((resolve) => {
    conn.sftp((err, sftp) => {
      if (err) {
        resolve();
        return;
      }
      sftp.unlink(remotePath, () => resolve());
    });
  });
}
export { generateSshKeyPair, type SshKeyPair } from "./keygen";
export { generateSelfSignedCert, type SelfSignedCert } from "./selfSignedCert";
