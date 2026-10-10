<script setup lang="ts">
import { useServerContext } from "../../composables/useServerContext";
import ServerMetricBars from "../../components/ServerMetricBars.vue";
import MetricsHistoryChart from "../../components/MetricsHistoryChart.vue";
import { api } from "../../lib/api";

const { server, teamId } = useServerContext();

interface ServerHistoryPoint {
  at: string;
  cpu: number;
  mem: number;
  disk: number;
}

async function fetchHistory(hours: number) {
  const res = await api.get<{ history: Record<string, ServerHistoryPoint[]> }>(`/teams/${teamId}/servers/metrics-history?hours=${hours}`);
  return { history: res.history[server.value?.id ?? ""] ?? [] };
}
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">monitor_heart</span>
      {{ $t("serverMetrics.recursos") }}
    </div>
    <div class="card-body">
      <div v-if="server.metricsCheckedAt === null" class="empty-state">
        {{ $t("serverMetrics.semDadosAindaAPrimeira") }}
      </div>
      <template v-else>
        <ServerMetricBars :server="server" />
        <div style="margin-top: 16px">
          <MetricsHistoryChart :fetch-history="fetchHistory" />
        </div>
      </template>
    </div>
  </div>
</template>
