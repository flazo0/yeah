import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { applications, servers, type Server } from "@yeah/db";
import { connectSsh, type Client, type ClientChannel } from "@yeah/ssh";
import { containerTerminalCommand, parseTerminalMessage } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

// Interactive terminals: browser <-> this WebSocket <-> SSH PTY. This is a deliberate exception to
// "only the worker speaks SSH" (like the backup download and container logs reads): an interactive
// session is a live pipe the browser is waiting on, which a queue cannot carry. The gate is the same
// session cookie as every other route, plus team membership, plus an Origin check (a WebSocket is not
// protected by CORS, so a page on another origin could otherwise ride the cookie).

const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://localhost:5174").split(",").map((o) => o.trim());
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 5;

interface Session {
  userId: string;
  conn: Client | null;
  stream: ClientChannel | null;
  cols: number;
  rows: number;
  idle: ReturnType<typeof setTimeout>;
  closed: boolean;
}

const sessions = new Map<string, Session>();

interface Ws {
  id: string;
  data: { cookie: Record<string, { value?: unknown } | undefined>; headers: Record<string, string | undefined> };
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}

interface Target {
  server: Server;
  /** null = a login shell on the server itself. */
  command: string | null;
}

function endSession(id: string) {
  const s = sessions.get(id);
  if (!s || s.closed) return;
  s.closed = true;
  clearTimeout(s.idle);
  try {
    s.stream?.end();
  } catch {
    // already gone
  }
  s.conn?.end();
  sessions.delete(id);
}

function armIdle(ws: Ws, s: Session) {
  clearTimeout(s.idle);
  s.idle = setTimeout(() => {
    ws.send("\r\n\x1b[33m[sessão encerrada por inatividade]\x1b[0m\r\n");
    ws.close(1000, "idle");
  }, IDLE_TIMEOUT_MS);
}

async function openSession(ws: Ws, resolve: (userId: string) => Promise<Target | null>) {
  const fail = (code: number, reason: string, message: string) => {
    ws.send(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
    ws.close(code, reason);
  };

  const origin = ws.data.headers.origin;
  if (!origin || !webOrigins.includes(origin)) return fail(4403, "origin", "origem não permitida");

  const user = await getUserFromSessionId(ws.data.cookie[SESSION_COOKIE]?.value);
  if (!user) return fail(4401, "unauthorized", "sessão inválida — entre de novo");

  if ([...sessions.values()].filter((s) => s.userId === user.id).length >= MAX_SESSIONS_PER_USER) {
    return fail(4429, "limit", `limite de ${MAX_SESSIONS_PER_USER} terminais abertos ao mesmo tempo`);
  }

  const target = await resolve(user.id);
  if (!target) return fail(4404, "not-found", "recurso não encontrado");

  const session: Session = { userId: user.id, conn: null, stream: null, cols: 80, rows: 24, idle: setTimeout(() => {}, 0), closed: false };
  sessions.set(ws.id, session);
  armIdle(ws, session);

  try {
    const conn = await connectSsh({
      host: target.server.host,
      port: target.server.port,
      username: target.server.sshUser,
      privateKey: target.server.privateKey,
      timeoutMs: target.server.sshTimeoutSeconds * 1000,
    });
    if (session.closed) {
      conn.end();
      return;
    }
    session.conn = conn;
    conn.on("error", () => ws.close(1011, "ssh"));
    conn.on("close", () => ws.close(1000, "ssh closed"));

    const pty = { term: "xterm-256color", cols: session.cols, rows: session.rows };
    const stream = await new Promise<ClientChannel>((resolveStream, reject) => {
      const cb = (err: Error | undefined, s: ClientChannel) => (err ? reject(err) : resolveStream(s));
      if (target.command === null) conn.shell(pty, cb);
      else conn.exec(target.command, { pty }, cb);
    });
    if (session.closed) {
      stream.end();
      return;
    }
    session.stream = stream;

    const decoder = new TextDecoder();
    stream.on("data", (chunk: Buffer) => ws.send(decoder.decode(chunk, { stream: true })));
    stream.stderr.on("data", (chunk: Buffer) => ws.send(decoder.decode(chunk, { stream: true })));
    stream.on("close", () => ws.close(1000, "closed"));
    // A resize that arrived while connecting.
    stream.setWindow(session.rows, session.cols, 0, 0);
  } catch (err) {
    fail(1011, "ssh", `falha ao abrir o terminal: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function handleMessage(ws: Ws, raw: unknown) {
  const s = sessions.get(ws.id);
  if (!s) return;
  const msg = parseTerminalMessage(raw);
  if (!msg) return;
  armIdle(ws, s);
  if (msg.type === "resize") {
    s.cols = msg.cols;
    s.rows = msg.rows;
    s.stream?.setWindow(msg.rows, msg.cols, 0, 0);
  } else {
    s.stream?.write(msg.data);
  }
}

export const terminalRoutes = new Elysia()
  .ws("/teams/:teamId/servers/:serverId/terminal", {
    open(ws) {
      const params = ws.data.params as { teamId: string; serverId: string };
      void openSession(ws as unknown as Ws, async (userId) => {
        if (!(await assertMember(params.teamId, userId))) return null;
        const [server] = await db.select().from(servers).where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId))).limit(1);
        return server ? { server, command: null } : null;
      });
    },
    message(ws, message) {
      handleMessage(ws as unknown as Ws, message);
    },
    close(ws) {
      endSession((ws as unknown as Ws).id);
    },
  })
  .ws("/teams/:teamId/projects/:projectId/environments/:environmentId/applications/:applicationId/terminal", {
    open(ws) {
      const params = ws.data.params as { teamId: string; environmentId: string; applicationId: string };
      void openSession(ws as unknown as Ws, async (userId) => {
        if (!(await assertMember(params.teamId, userId))) return null;
        const [application] = await db
          .select()
          .from(applications)
          .where(and(eq(applications.id, params.applicationId), eq(applications.environmentId, params.environmentId), eq(applications.teamId, params.teamId)))
          .limit(1);
        if (!application) return null;
        const [server] = await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1);
        return server ? { server, command: containerTerminalCommand(application) } : null;
      });
    },
    message(ws, message) {
      handleMessage(ws as unknown as Ws, message);
    },
    close(ws) {
      endSession((ws as unknown as Ws).id);
    },
  });
