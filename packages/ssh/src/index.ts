import { Client } from "ssh2";
import type { TestConnectionResult } from "@yeah/shared";

export type { Client } from "ssh2";

export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  privateKey: string;
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

    const timeout = setTimeout(() => finish({ ok: false, error: "connection timed out" }), 10_000);

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
        readyTimeout: 10_000,
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
    }, 15_000);

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
        readyTimeout: 15_000,
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
export function writeRemoteFile(conn: Client, remotePath: string, content: string): Promise<void> {
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
