<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ContainerStats } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import MetricsHistoryChart from "../../components/MetricsHistoryChart.vue";
import { i18n } from "../../lib/i18n";
import { dateLocale } from "../../lib/i18n";

const { basePath, error } = useApplicationContext();

function fetchHistory(hours: number) {
  return api.get<{ history: { at: string; cpu: number; mem: number }[]; multiContainer?: boolean }>(`${basePath}/metrics-history?hours=${hours}`);
}

interface Sample {
  at: number;
  stats: ContainerStats[];
}
const HISTORY = 60;
const samples = ref<Sample[]>([]);
const message = ref("");
const loading = ref(true);
let timer: ReturnType<typeof setInterval> | undefined;

async function poll() {
  try {
    const res = await api.get<{ containers: ContainerStats[]; running: boolean; message?: string }>(`${basePath}/metrics`);
    message.value = res.running ? "" : (res.message ?? i18n.global.t("applicationMetrics.containerNaoEstaRodando"));
    if (res.running) samples.value = [...samples.value.slice(-(HISTORY - 1)), { at: Date.now(), stats: res.containers }];
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationMetrics.falhaAoLerAsMetricas");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void poll();
  timer = setInterval(() => void poll(), 5000);
});
onBeforeUnmount(() => clearInterval(timer));

const latest = computed(() => samples.value.at(-1)?.stats ?? []);

function series(name: string, pick: (s: ContainerStats) => number): number[] {
  return samples.value.map((s) => pick(s.stats.find((c) => c.name === name) ?? ({} as ContainerStats)) || 0);
}

/** Points for an SVG polyline in a 100x30 box, scaled to the series' own maximum (>= floor). */
function points(values: number[], floor: number): string {
  if (values.length < 2) return "";
  const max = Math.max(floor, ...values);
  return values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(30 - (v / max) * 28 - 1).toFixed(1)}`).join(" ");
}

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

const TRAFFIC_PERIODS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
] as const;
const trafficPeriod = ref<(typeof TRAFFIC_PERIODS)[number]>(TRAFFIC_PERIODS[0]);
const trafficPoints = ref<{ at: string; requests: number }[]>([]);
const trafficLoading = ref(true);
const trafficError = ref("");

async function loadTraffic() {
  trafficLoading.value = true;
  trafficError.value = "";
  try {
    const res = await api.get<{ history: { at: string; requests: number }[] }>(`${basePath}/traffic-history?hours=${trafficPeriod.value.hours}`);
    trafficPoints.value = res.history;
  } catch (err) {
    trafficError.value = err instanceof ApiError ? err.message : i18n.global.t("applicationMetrics.falhaAoCarregarOTrafego");
  } finally {
    trafficLoading.value = false;
  }
}
onMounted(loadTraffic);

const trafficTotal = computed(() => trafficPoints.value.reduce((sum, p) => sum + p.requests, 0));
</script>

<template>
  <div>
    <p class="hint mb-16">{{ $t("applicationMetrics.usoDoContainerLidoDo") }} <span class="mono">{{ $t("applicationMetrics.dockerStats") }}</span> {{ $t("applicationMetrics.aCada5SEnquanto") }}</p>
    <div v-if="loading" class="empty-state"><span class="spinner"></span> {{ $t("applicationMetrics.lendo") }}</div>
    <div v-else-if="message" class="empty-state">{{ message }}</div>
    <div v-for="c in latest" v-else :key="c.name" class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">monitoring</span> <span class="mono">{{ c.name }}</span></div>
      <div class="card-body metrics-grid">
        <div class="metric">
          <div class="stat-label">{{ $t("applicationMetrics.cpu") }}</div>
          <div class="metric-value">{{ c.cpuPercent.toFixed(1) }}%</div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="points(series(c.name, (s) => s.cpuPercent), 10)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
        </div>
        <div class="metric">
          <div class="stat-label">{{ $t("applicationMetrics.memoria") }}</div>
          <div class="metric-value">{{ bytes(c.memUsedBytes) }}<small> / {{ bytes(c.memLimitBytes) }} ({{ c.memPercent.toFixed(1) }}%)</small></div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="points(series(c.name, (s) => s.memUsedBytes), c.memUsedBytes)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
        </div>
        <div class="metric">
          <div class="stat-label">{{ $t("applicationMetrics.redeRecebidoEnviado") }}</div>
          <div class="metric-value">{{ bytes(c.netRxBytes) }} <small>/ {{ bytes(c.netTxBytes) }}</small></div>
        </div>
        <div class="metric">
          <div class="stat-label">{{ $t("applicationMetrics.discoLeituraEscrita") }}</div>
          <div class="metric-value">{{ bytes(c.blockReadBytes) }} <small>/ {{ bytes(c.blockWriteBytes) }}</small></div>
        </div>
        <div class="metric">
          <div class="stat-label">{{ $t("applicationMetrics.processos") }}</div>
          <div class="metric-value">{{ c.pids }}</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">history</span> {{ $t("applicationMetrics.historico") }}</div>
      <div class="card-body"><MetricsHistoryChart :fetch-history="fetchHistory" /></div>
    </div>
    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">insights</span>
        {{ $t("applicationMetrics.trafego") }}
        <div class="segmented" style="margin-left: auto" role="group" :aria-label="$t('applicationMetrics.periodo')">
          <button v-for="p in TRAFFIC_PERIODS" :key="p.label" type="button" :class="{ active: trafficPeriod.label === p.label }" @click="trafficPeriod = p; loadTraffic()">{{ p.label }}</button>
        </div>
      </div>
      <div class="card-body">
        <p class="hint mb-16">{{ $t("applicationMetrics.requisicoesPorJanelaLidasDas") }}</p>
        <div v-if="trafficLoading" class="empty-state"><span class="spinner"></span> {{ $t("applicationMetrics.carregando") }}</div>
        <div v-else-if="trafficError" class="empty-state">{{ trafficError }}</div>
        <div v-else-if="trafficPoints.length < 2" class="empty-state">{{ $t("applicationMetrics.semDadosAindaAtiveA") }}</div>
        <div v-else class="metric">
          <div class="stat-label">{{ $t("applicationMetrics.requisicoesNoPeriodo") }}</div>
          <div class="metric-value">{{ trafficTotal.toLocaleString(dateLocale()) }}</div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="points(trafficPoints.map((p) => p.requests), 1)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
        </div>
      </div>
    </div>
  </div>
</template>
