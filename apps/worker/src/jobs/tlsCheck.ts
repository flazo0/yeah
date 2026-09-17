import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { isNotNull } from "drizzle-orm";
import { applications, services } from "@yeah/db";
import type { TlsCheckJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";

const EXPIRY_THRESHOLD_DAYS = 14;
const CHECK_TIMEOUT_MS = 8_000;

interface DomainTarget {
  teamId: string;
  domain: string;
}

/** Resolves the current TLS cert's `validTo` by connecting on 443 — no SSH involved, this is a plain outbound check like any external uptime monitor would do. */
function checkExpiry(domain: string): Promise<Date> {
  return new Promise((resolve, reject) => {
    const socket: TLSSocket = tlsConnect(
      { host: domain, port: 443, servername: domain, timeout: CHECK_TIMEOUT_MS, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error("nenhum certificado retornado"));
          return;
        }
        resolve(new Date(cert.valid_to));
      },
    );
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timeout na conexão TLS"));
    });
  });
}

export function makeTlsCheckProcessor() {
  return async function tlsCheck(_job: Job<TlsCheckJobData>) {
    const [appRows, serviceRows] = await Promise.all([
      db.select({ teamId: applications.teamId, domain: applications.domain }).from(applications).where(isNotNull(applications.domain)),
      db.select({ teamId: services.teamId, domain: services.domain }).from(services).where(isNotNull(services.domain)),
    ]);

    const targets = [...appRows, ...serviceRows].filter((row): row is DomainTarget => row.domain !== null);

    await Promise.all(targets.map((target) => checkOne(target)));
  };
}

async function checkOne(target: DomainTarget) {
  try {
    const validTo = await checkExpiry(target.domain);
    const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= EXPIRY_THRESHOLD_DAYS) {
      await notifyTeam(
        target.teamId,
        "tls.expiring",
        `Certificado de ${target.domain} expira em ${daysRemaining} dia(s)`,
        daysRemaining <= 0
          ? `O certificado de ${target.domain} já expirou ou expira hoje — a renovação automática do Traefik pode ter falhado.`
          : `O certificado de ${target.domain} expira em ${daysRemaining} dia(s) (${validTo.toISOString().slice(0, 10)}). Se o Traefik não renovar sozinho via Let's Encrypt, confira se a porta 80 está alcançável e o DNS aponta certo.`,
        daysRemaining <= 0 ? "error" : "warning",
      );
    }
  } catch (err) {
    // Unreachable/misconfigured domains are common (DNS not propagated yet, firewall, etc.) —
    // this is a best-effort check, so log and move on instead of failing the whole tick.
    console.warn(`[worker] tls-check: couldn't check ${target.domain}:`, err instanceof Error ? err.message : err);
  }
}
