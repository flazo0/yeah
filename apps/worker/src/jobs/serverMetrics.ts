import { eq } from "drizzle-orm";
import { servers, type Server } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import { publishServerEvent, type ServerMetricsJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";

const CPU_THRESHOLD = 90;
const MEM_THRESHOLD = 90;
const DISK_THRESHOLD = 85;

// Reads straight from /proc — identical format whether the box runs busybox or full coreutils,
// unlike parsing `top`'s human-formatted output (which differs between the two).
const METRICS_COMMAND = `
read -r _ u1 n1 s1 i1 w1 irq1 sirq1 _ < /proc/stat
sleep 1
read -r _ u2 n2 s2 i2 w2 irq2 sirq2 _ < /proc/stat
idle1=$((i1+w1)); idle2=$((i2+w2))
total1=$((u1+n1+s1+i1+w1+irq1+sirq1)); total2=$((u2+n2+s2+i2+w2+irq2+sirq2))
totald=$((total2-total1)); idled=$((idle2-idle1))
if [ "$totald" -gt 0 ]; then cpu=$(( (1000*(totald-idled)/totald + 5) / 10 )); else cpu=0; fi
memtotal=$(grep MemTotal /proc/meminfo | awk '{print $2}')
memavail=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
mem=$(( (memtotal-memavail)*100/memtotal ))
disk=$(df -P / | tail -1 | awk '{print $5}' | tr -d '%')
echo "CPU:$cpu"
echo "MEM:$mem"
echo "DISK:$disk"
`.trim();

function parseMetrics(output: string): { cpu: number; mem: number; disk: number } | null {
  const cpu = /CPU:(\d+)/.exec(output)?.[1];
  const mem = /MEM:(\d+)/.exec(output)?.[1];
  const disk = /DISK:(\d+)/.exec(output)?.[1];
  if (!cpu || !mem || !disk) return null;
  return { cpu: Number(cpu), mem: Number(mem), disk: Number(disk) };
}

/** Only alert on the transition into trouble, not on every tick while it stays there. */
function crossedThreshold(previous: number | null, current: number, threshold: number): boolean {
  return current >= threshold && (previous === null || previous < threshold);
}

export function makeServerMetricsProcessor(publishConnection: Redis) {
  return async function serverMetrics(_job: Job<ServerMetricsJobData>) {
    const allServers = await db.select().from(servers).where(eq(servers.status, "connected"));

    await Promise.all(allServers.map((server) => checkOne(server, publishConnection)));
  };
}

async function checkOne(server: Server, publishConnection: Redis) {
  try {
    const conn = await connectSsh({
      host: server.host,
      port: server.port,
      username: server.sshUser,
      privateKey: server.privateKey,
    });

    let output = "";
    try {
      await execStream(conn, METRICS_COMMAND, (chunk) => {
        output += chunk;
      });
    } finally {
      conn.end();
    }

    const metrics = parseMetrics(output);
    if (!metrics) {
      console.warn(`[worker] server-metrics: couldn't parse output for ${server.id}: ${output.slice(0, 200)}`);
      return;
    }

    await db
      .update(servers)
      .set({
        cpuPercent: metrics.cpu,
        memPercent: metrics.mem,
        diskPercent: metrics.disk,
        metricsCheckedAt: new Date(),
      })
      .where(eq(servers.id, server.id));

    await publishServerEvent(publishConnection, {
      type: "server.metrics",
      serverId: server.id,
      cpuPercent: metrics.cpu,
      memPercent: metrics.mem,
      diskPercent: metrics.disk,
    });

    if (crossedThreshold(server.cpuPercent, metrics.cpu, CPU_THRESHOLD)) {
      await notifyTeam(server.teamId, `CPU alta em ${server.name}`, `CPU em ${metrics.cpu}% (limiar: ${CPU_THRESHOLD}%).`, "warning");
    }
    if (crossedThreshold(server.memPercent, metrics.mem, MEM_THRESHOLD)) {
      await notifyTeam(server.teamId, `Memória alta em ${server.name}`, `RAM em ${metrics.mem}% (limiar: ${MEM_THRESHOLD}%) — novos deploys/provisionamentos podem falhar por falta de memória.`, "warning");
    }
    if (crossedThreshold(server.diskPercent, metrics.disk, DISK_THRESHOLD)) {
      await notifyTeam(server.teamId, `Disco cheio em ${server.name}`, `Disco em ${metrics.disk}% (limiar: ${DISK_THRESHOLD}%) — considere limpar imagens/volumes não usados.`, "error");
    }
  } catch (err) {
    // A single unreachable server shouldn't break the metrics tick for every other server —
    // log and move on. This deliberately doesn't touch `servers.status`, which only reflects
    // the result of an explicit "test connection" — see docs/ARCHITECTURE.md.
    console.error(`[worker] server-metrics: failed to reach ${server.id}:`, err instanceof Error ? err.message : err);
  }
}
