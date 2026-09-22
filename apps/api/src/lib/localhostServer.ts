import { servers } from "@yeah/db";
import { db } from "./db";
import { serverCheckQueue } from "./queue";

/**
 * install.sh generates an SSH keypair, adds the public half to the host's own authorized_keys,
 * and passes the private half through these env vars — so the machine yeah is running on is
 * already a usable deploy target the moment the admin account exists, same as Coolify's
 * "localhost" default server. Nothing happens if they're unset (e.g. an install predating this,
 * or someone stripped them from .env on purpose).
 */
export async function createLocalhostServerIfConfigured(teamId: string): Promise<void> {
  const privateKeyBase64 = process.env.LOCALHOST_SSH_PRIVATE_KEY_BASE64;
  if (!privateKeyBase64) return;

  const host = process.env.LOCALHOST_SSH_HOST ?? "host.docker.internal";
  const port = process.env.LOCALHOST_SSH_PORT ? Number(process.env.LOCALHOST_SSH_PORT) : 22;
  const sshUser = process.env.LOCALHOST_SSH_USER ?? "root";
  const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf8");

  const [server] = await db
    .insert(servers)
    .values({ teamId, name: "Servidor local", host, port, sshUser, privateKey, isPlatformHost: true })
    .returning();
  if (!server) return;

  await serverCheckQueue.add("check", { serverId: server.id });
}
