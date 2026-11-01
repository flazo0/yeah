import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { servers } from "@yeah/db";
import { connectSsh, writeRemoteFile, type Client } from "@yeah/ssh";
import {
  confirmsDelete,
  decodeEditableText,
  deleteCommand,
  fileWritesEnabled,
  isSafeBrowserPath,
  isValidComposeService,
  isValidEntryName,
  joinBrowserPath,
  listDirCommand,
  MAX_BROWSER_FILE_BYTES,
  MAX_EDIT_FILE_BYTES,
  mkdirCommand,
  normalizeBrowserPath,
  parseComposeStack,
  parseListing,
  prepareStagingCommand,
  readFileCommand,
  uploadLimitBytes,
  writeFileCommand,
  writeRefusal,
  type BrowserTarget,
  type FileWriteOp,
} from "@yeah/shared";
import { requireEnvironmentScope } from "../lib/scope";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { loadApplication } from "./applications";
import { loadService } from "./services";
import { loadDatabase } from "./databases";

// Container file browser for applications, services (one container of the stack) and databases:
// list and read always; save, upload, create folder and delete only when the operator opted in
// (FILE_BROWSER_WRITES). Everything is `docker exec` over SSH with quoted arguments (see
// packages/shared/src/fileBrowser.ts and fileWrite.ts). Request bodies are never logged.

type Kind = "applications" | "services" | "databases";
type Resolved = { ok: true; serverId: string; target: BrowserTarget } | { ok: false; status: number; error: string };

const writesEnabled = () => fileWritesEnabled(process.env.FILE_BROWSER_WRITES);

async function authorize(kind: Kind, cookie: Record<string, { value?: unknown } | undefined>, params: Record<string, string | undefined>, container: string | undefined): Promise<Resolved> {
  const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value as string | undefined);
  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  if (!(await assertMember(params.teamId!, user.id))) return { ok: false, status: 403, error: "forbidden" };
  const id = params.resourceId!;
  if (kind === "applications") {
    const row = await loadApplication(params.environmentId!, id);
    if (!row) return { ok: false, status: 404, error: "application not found" };
    return { ok: true, serverId: row.application.serverId, target: row.application };
  }
  if (kind === "services") {
    const row = await loadService(params.environmentId!, id);
    if (!row) return { ok: false, status: 404, error: "service not found" };
    if (!row.service.composeContent) return { ok: false, status: 400, error: "only stacks have containers to browse" };
    if (!container || !isValidComposeService(container)) return { ok: false, status: 400, error: "choose a container" };
    return { ok: true, serverId: row.service.serverId, target: { kind: "service", id, container } };
  }
  const row = await loadDatabase(params.environmentId!, id);
  if (!row) return { ok: false, status: 404, error: "database not found" };
  return { ok: true, serverId: row.database.serverId, target: { kind: "database", id } };
}

interface Buffered {
  stdout: Buffer;
  exitCode: number;
}

/** Runs one command collecting raw stdout bytes (a text file must not be corrupted at chunk boundaries). */
function execBuffered(conn: Client, command: string): Promise<Buffered> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      const chunks: Buffer[] = [];
      stream
        .on("close", (code: number | null) => resolve({ stdout: Buffer.concat(chunks), exitCode: code ?? 0 }))
        .on("data", (chunk: Buffer) => chunks.push(chunk))
        .stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    });
  });
}

async function withConnection<T>(serverId: string, fn: (conn: Client) => Promise<T>): Promise<T | null> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return null;
  const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
  try {
    return await fn(conn);
  } finally {
    conn.end();
  }
}

const errorText = (b: Buffered) => b.stdout.toString("utf8").trim().slice(-300);
const statusFor = (exitCode: number) => (exitCode === 3 || exitCode === 5 ? 409 : 400);
const sshError = (err: unknown) => `failed to talk to the server: ${err instanceof Error ? err.message : String(err)}`;

/** Stages `content` on the host (private file), streams it into the container path, removes the staging file. */
async function stageAndWrite(serverId: string, target: BrowserTarget, path: string, content: Buffer, onlyNew: boolean): Promise<Buffered | null> {
  const staging = `/tmp/yeah-fb-${crypto.randomUUID()}`;
  return withConnection(serverId, async (conn) => {
    try {
      await execBuffered(conn, prepareStagingCommand(staging));
      await writeRemoteFile(conn, staging, content);
    } catch (err) {
      await execBuffered(conn, `rm -f '${staging}'`).catch(() => undefined);
      throw err;
    }
    return execBuffered(conn, writeFileCommand(target, path, staging, { onlyNew }));
  });
}

const containerQuery = t.Optional(t.String({ maxLength: 64 }));

function containerFileRoutes(kind: Kind) {
  const writeGate = (op: FileWriteOp, rawPath: string): { status: number; error: string } | { path: string } => {
    if (!writesEnabled()) return { status: 403, error: "file writes are disabled on this instance (set FILE_BROWSER_WRITES=true to allow them)" };
    const path = normalizeBrowserPath(rawPath);
    if (!path) return { status: 400, error: "invalid path" };
    const refusal = writeRefusal(path, op);
    if (refusal) return { status: 400, error: refusal };
    return { path };
  };

  return new Elysia({ prefix: `/teams/:teamId/projects/:projectId/environments/:environmentId/${kind}` })
    .onBeforeHandle(requireEnvironmentScope)
    .get(
      "/:resourceId/files",
      async ({ cookie, params, query, set }) => {
        const ctx = await authorize(kind, cookie, params, query.container);
        if (!ctx.ok) {
          set.status = ctx.status;
          return { error: ctx.error };
        }
        const path = query.path || "/";
        if (!isSafeBrowserPath(path)) {
          set.status = 400;
          return { error: "invalid path" };
        }
        try {
          const result = await withConnection(ctx.serverId, (conn) => execBuffered(conn, listDirCommand(ctx.target, path)));
          if (!result) {
            set.status = 404;
            return { error: "server not found" };
          }
          if (result.exitCode !== 0) {
            set.status = statusFor(result.exitCode);
            return { error: errorText(result) || "could not list" };
          }
          return { path, entries: parseListing(result.stdout.toString("utf8")), writable: writesEnabled(), maxEditBytes: MAX_EDIT_FILE_BYTES, maxUploadBytes: uploadLimitBytes(process.env.FILE_BROWSER_UPLOAD_MAX_MB) };
        } catch (err) {
          set.status = 502;
          return { error: sshError(err) };
        }
      },
      { query: t.Object({ path: t.Optional(t.String({ maxLength: 1100 })), container: containerQuery }) },
    )
    .get(
      "/:resourceId/files/content",
      async ({ cookie, params, query, set }) => {
        const ctx = await authorize(kind, cookie, params, query.container);
        if (!ctx.ok) {
          set.status = ctx.status;
          return { error: ctx.error };
        }
        if (!isSafeBrowserPath(query.path)) {
          set.status = 400;
          return { error: "invalid path" };
        }
        const forEdit = query.edit === "1";
        const limit = forEdit ? MAX_EDIT_FILE_BYTES : MAX_BROWSER_FILE_BYTES;
        try {
          const result = await withConnection(ctx.serverId, (conn) => execBuffered(conn, readFileCommand(ctx.target, query.path, limit)));
          if (!result) {
            set.status = 404;
            return { error: "server not found" };
          }
          if (result.exitCode !== 0) {
            set.status = statusFor(result.exitCode);
            return { error: errorText(result) || "could not read the file" };
          }
          const truncated = result.stdout.length > limit;
          const bytes = truncated ? result.stdout.subarray(0, limit) : result.stdout;
          if (bytes.includes(0)) return { path: query.path, binary: true, content: "", truncated: false, editable: false };
          if (truncated) return { path: query.path, binary: false, content: bytes.toString("utf8"), truncated: true, editable: false };
          const text = decodeEditableText(bytes);
          if (text === null) return { path: query.path, binary: true, content: "", truncated: false, editable: false };
          return { path: query.path, binary: false, content: text, truncated: false, editable: forEdit || bytes.length <= MAX_BROWSER_FILE_BYTES };
        } catch (err) {
          set.status = 502;
          return { error: sshError(err) };
        }
      },
      { query: t.Object({ path: t.String({ maxLength: 1100 }), container: containerQuery, edit: t.Optional(t.String({ maxLength: 1 })) }) },
    )
    .put(
      "/:resourceId/file-save",
      async ({ cookie, params, query, body, set }) => {
        const ctx = await authorize(kind, cookie, params, query.container);
        if (!ctx.ok) {
          set.status = ctx.status;
          return { error: ctx.error };
        }
        const gate = writeGate("save", body.path);
        if ("error" in gate) {
          set.status = gate.status;
          return { error: gate.error };
        }
        const bytes = Buffer.from(body.content, "utf8");
        if (bytes.length > MAX_EDIT_FILE_BYTES) {
          set.status = 413;
          return { error: "the file is too large to edit here (maximum 2 MB)" };
        }
        if (bytes.includes(0)) {
          set.status = 400;
          return { error: "binary content cannot be saved from the editor" };
        }
        try {
          const result = await stageAndWrite(ctx.serverId, ctx.target, gate.path, bytes, body.create === true);
          if (!result) {
            set.status = 404;
            return { error: "server not found" };
          }
          if (result.exitCode !== 0) {
            set.status = statusFor(result.exitCode);
            return { error: errorText(result) || "could not save the file" };
          }
          return { ok: true, path: gate.path, size: bytes.length };
        } catch (err) {
          set.status = 502;
          return { error: sshError(err) };
        }
      },
      { query: t.Object({ container: containerQuery }), body: t.Object({ path: t.String({ maxLength: 1100 }), content: t.String({ maxLength: MAX_EDIT_FILE_BYTES * 2 }), create: t.Optional(t.Boolean()) }) },
    )
    .post(
      "/:resourceId/file-upload",
      async ({ cookie, params, query, body, set }) => {
        const ctx = await authorize(kind, cookie, params, query.container);
        if (!ctx.ok) {
          set.status = ctx.status;
          return { error: ctx.error };
        }
        if (!isValidEntryName(body.name)) {
          set.status = 400;
          return { error: "invalid file name" };
        }
        const dir = normalizeBrowserPath(body.dir);
        if (!dir) {
          set.status = 400;
          return { error: "invalid path" };
        }
        const gate = writeGate("upload", joinBrowserPath(dir, body.name));
        if ("error" in gate) {
          set.status = gate.status;
          return { error: gate.error };
        }
        const cap = uploadLimitBytes(process.env.FILE_BROWSER_UPLOAD_MAX_MB);
        if (body.contentBase64.length > Math.ceil((cap * 4) / 3) + 8) {
          set.status = 413;
          return { error: `the file is larger than the upload limit (${Math.floor(cap / 1048576)} MB)` };
        }
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.contentBase64)) {
          set.status = 400;
          return { error: "invalid file content" };
        }
        const bytes = Buffer.from(body.contentBase64, "base64");
        if (bytes.length > cap) {
          set.status = 413;
          return { error: `the file is larger than the upload limit (${Math.floor(cap / 1048576)} MB)` };
        }
        try {
          const result = await stageAndWrite(ctx.serverId, ctx.target, gate.path, bytes, body.overwrite !== true);
          if (!result) {
            set.status = 404;
            return { error: "server not found" };
          }
          if (result.exitCode !== 0) {
            set.status = statusFor(result.exitCode);
            return { error: errorText(result) || "could not upload the file" };
          }
          return { ok: true, path: gate.path, size: bytes.length };
        } catch (err) {
          set.status = 502;
          return { error: sshError(err) };
        }
      },
      { query: t.Object({ container: containerQuery }), body: t.Object({ dir: t.String({ maxLength: 1100 }), name: t.String({ maxLength: 255 }), contentBase64: t.String({ maxLength: 140 * 1024 * 1024 }), overwrite: t.Optional(t.Boolean()) }) },
    )
    .post(
      "/:resourceId/file-mkdir",
      async ({ cookie, params, query, body, set }) => {
        const ctx = await authorize(kind, cookie, params, query.container);
        if (!ctx.ok) {
          set.status = ctx.status;
          return { error: ctx.error };
        }
        const gate = writeGate("mkdir", body.path);
        if ("error" in gate) {
          set.status = gate.status;
          return { error: gate.error };
        }
        try {
          const result = await withConnection(ctx.serverId, (conn) => execBuffered(conn, mkdirCommand(ctx.target, gate.path)));
          if (!result) {
            set.status = 404;
            return { error: "server not found" };
          }
          if (result.exitCode !== 0) {
            set.status = statusFor(result.exitCode);
            return { error: errorText(result) || "could not create the folder" };
          }
          return { ok: true, path: gate.path };
        } catch (err) {
          set.status = 502;
          return { error: sshError(err) };
        }
      },
      { query: t.Object({ container: containerQuery }), body: t.Object({ path: t.String({ maxLength: 1100 }) }) },
    )
    .post(
      "/:resourceId/file-delete",
      async ({ cookie, params, query, body, set }) => {
        const ctx = await authorize(kind, cookie, params, query.container);
        if (!ctx.ok) {
          set.status = ctx.status;
          return { error: ctx.error };
        }
        const gate = writeGate("delete", body.path);
        if ("error" in gate) {
          set.status = gate.status;
          return { error: gate.error };
        }
        if (!confirmsDelete(gate.path, body.confirm)) {
          set.status = 400;
          return { error: "confirm the deletion by repeating the exact path" };
        }
        try {
          const result = await withConnection(ctx.serverId, (conn) => execBuffered(conn, deleteCommand(ctx.target, gate.path)));
          if (!result) {
            set.status = 404;
            return { error: "server not found" };
          }
          if (result.exitCode !== 0) {
            set.status = statusFor(result.exitCode);
            return { error: errorText(result) || "could not delete" };
          }
          return { ok: true };
        } catch (err) {
          set.status = 502;
          return { error: sshError(err) };
        }
      },
      { query: t.Object({ container: containerQuery }), body: t.Object({ path: t.String({ maxLength: 1100 }), confirm: t.String({ maxLength: 1100 }) }) },
    );
}

const applicationFiles = containerFileRoutes("applications") as unknown as Elysia;
const databaseFiles = containerFileRoutes("databases") as unknown as Elysia;
const servicesFiles = containerFileRoutes("services") as unknown as Elysia;
const serviceContainers = new Elysia({ prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/services" }).onBeforeHandle(requireEnvironmentScope).get("/:resourceId/files/containers", async ({ cookie, params, set }) => {
  const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
  if (!user) {
    set.status = 401;
    return { error: "unauthorized" };
  }
  if (!(await assertMember(params.teamId, user.id))) {
    set.status = 403;
    return { error: "forbidden" };
  }
  const row = await loadService(params.environmentId, params.resourceId);
  if (!row) {
    set.status = 404;
    return { error: "service not found" };
  }
  const parsed = row.service.composeContent ? parseComposeStack(row.service.composeContent) : null;
  return { containers: parsed && parsed.ok ? Object.keys(parsed.services) : [] };
});

// Erased to a plain Elysia type: chaining three fully typed route sets into the app's `.use` chain
// makes TypeScript give up ("union type too complex"), and nothing consumes these routes' types.
export const containerFilesRoutes = new Elysia().use(applicationFiles).use(servicesFiles).use(serviceContainers as unknown as Elysia).use(databaseFiles) as unknown as Elysia;
