<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

/** Point shape shared by every `.../metrics-history` endpoint (server, application, database, service). */
interface HistoryPoint {
  at: string;
  cpu: number;
  mem: number;
  disk?: number;
}

const props = defineProps<{
  /** Loads one period's worth of samples — each page adapts its own endpoint's response shape to this. */
  fetchHistory: (hours: number) => Promise<{ history: HistoryPoint[]; multiContainer?: boolean }>;
}>();

const PERIODS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
] as const;

const period = ref<(typeof PERIODS)[number]>(PERIODS[0]);
const points = ref<HistoryPoint[]>([]);
const multiContainer = ref(false);
const loading = ref(true);
const errorMessage = ref("");

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const res = await props.fetchHistory(period.value.hours);
    points.value = res.history;
    multiContainer.value = res.multiContainer ?? false;
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : i18n.global.t("metricsHistoryChart.falhaAoCarregarOHistorico");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** Points for an SVG polyline in a 100x30 box, scaled 0–100 (percentages). */
function linePoints(pick: (p: HistoryPoint) => number): string {
  if (points.value.length < 2) return "";
  return points.value.map((p, i) => `${((i / (points.value.length - 1)) * 100).toFixed(1)},${(30 - (pick(p) / 100) * 28 - 1).toFixed(1)}`).join(" ");
}

function latestLabel(pick: (p: HistoryPoint) => number): string {
  const last = points.value.at(-1);
  return last ? `${pick(last).toFixed(1)}%` : "—";
}
</script>

<template>
  <div>
    <div class="metrics-history-head">
      <span class="stat-label">{{ $t("metricsHistoryChart.historico") }}</span>
      <div class="segmented" role="group" :aria-label="$t('metricsHistoryChart.periodo')">
        <button v-for="p in PERIODS" :key="p.label" type="button" :class="{ active: period.label === p.label }" @click="period = p; load()">{{ p.label }}</button>
      </div>
    </div>
    <div v-if="loading" class="empty-state"><span class="spinner"></span> {{ $t("metricsHistoryChart.carregando") }}</div>
    <div v-else-if="errorMessage" class="empty-state">{{ errorMessage }}</div>
    <div v-else-if="multiContainer" class="empty-state">{{ $t("metricsHistoryChart.historicoNaoDisponivelParaRecursos") }}</div>
    <div v-else-if="points.length < 2" class="empty-state">{{ $t("metricsHistoryChart.semDadosSuficientesAindaA") }}</div>
    <div v-else class="metrics-grid">
      <div class="metric">
        <div class="stat-label">{{ $t("metricsHistoryChart.cpu") }}</div>
        <div class="metric-value">{{ latestLabel((p) => p.cpu) }}</div>
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="linePoints((p) => p.cpu)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
      </div>
      <div class="metric">
        <div class="stat-label">{{ $t("metricsHistoryChart.memoria") }}</div>
        <div class="metric-value">{{ latestLabel((p) => p.mem) }}</div>
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="linePoints((p) => p.mem)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
      </div>
      <div v-if="points[0]?.disk !== undefined" class="metric">
        <div class="stat-label">{{ $t("metricsHistoryChart.disco") }}</div>
        <div class="metric-value">{{ latestLabel((p) => p.disk ?? 0) }}</div>
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="linePoints((p) => p.disk ?? 0)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metrics-history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
</style>
