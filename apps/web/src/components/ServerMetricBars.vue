<script setup lang="ts">
import type { ServerDto } from "@yeah/shared";

defineProps<{ server: Pick<ServerDto, "cpuPercent" | "memPercent" | "diskPercent" | "metricsCheckedAt">; compact?: boolean }>();

function barClass(value: number | null, threshold: number): string {
  if (value === null) return "metric-bar-fill-neutral";
  if (value >= threshold) return "metric-bar-fill-bad";
  if (value >= threshold - 20) return "metric-bar-fill-warn";
  return "metric-bar-fill-good";
}
const rows = [
  { key: "cpuPercent", label: "CPU", threshold: 90 },
  { key: "memPercent", label: "RAM", threshold: 90 },
  { key: "diskPercent", label: "Disco", threshold: 85 },
] as const;
</script>

<template>
  <div v-if="server.metricsCheckedAt === null" class="muted metric-empty">sem métricas ainda</div>
  <div v-else class="metric-bars" :class="{ compact }">
    <div v-for="row in rows" :key="row.key" class="metric-row">
      <div class="stat-label">{{ row.label }} · {{ server[row.key] ?? "-" }}%</div>
      <div class="metric-bar">
        <div class="metric-bar-fill" :class="barClass(server[row.key], row.threshold)" :style="{ width: `${server[row.key] ?? 0}%` }"></div>
      </div>
    </div>
  </div>
</template>
