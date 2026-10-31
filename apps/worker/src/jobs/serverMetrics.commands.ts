// Pure parsing/decision logic, kept separate from serverMetrics.ts's SSH execution for the same
// reason as deployApplication.commands.ts — see that file's comment.

// Reads straight from /proc — identical format whether the box runs busybox or full coreutils,
// unlike parsing `top`'s human-formatted output (which differs between the two).
export const METRICS_COMMAND = `
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

export function parseMetrics(output: string): { cpu: number; mem: number; disk: number } | null {
  const cpu = /CPU:(\d+)/.exec(output)?.[1];
  const mem = /MEM:(\d+)/.exec(output)?.[1];
  const disk = /DISK:(\d+)/.exec(output)?.[1];
  if (!cpu || !mem || !disk) return null;
  return { cpu: Number(cpu), mem: Number(mem), disk: Number(disk) };
}

/** Only alert on the transition into trouble, not on every tick while it stays there. */
export function crossedThreshold(previous: number | null, current: number, threshold: number): boolean {
  return current >= threshold && (previous === null || previous < threshold);
}
