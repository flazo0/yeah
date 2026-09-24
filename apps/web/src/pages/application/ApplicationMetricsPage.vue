<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ContainerStats } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { basePath, error } = useApplicationContext();

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
    message.value = res.running ? "" : (res.message ?? "container não está rodando");
    if (res.running) samples.value = [...samples.value.slice(-(HISTORY - 1)), { at: Date.now(), stats: res.containers }];
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao ler as métricas";
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
</script>

<template>
  <div>
    <p class="hint mb-16">Uso do container lido do <span class="mono">docker stats</span> a cada 5 s enquanto esta aba está aberta — nada é instalado no servidor. O histórico abaixo é só desta sessão.</p>
    <div v-if="loading" class="empty-state"><span class="spinner"></span> lendo...</div>
    <div v-else-if="message" class="empty-state">{{ message }}</div>
    <div v-for="c in latest" v-else :key="c.name" class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">monitoring</span> <span class="mono">{{ c.name }}</span></div>
      <div class="card-body metrics-grid">
        <div class="metric">
          <div class="stat-label">CPU</div>
          <div class="metric-value">{{ c.cpuPercent.toFixed(1) }}%</div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="points(series(c.name, (s) => s.cpuPercent), 10)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
        </div>
        <div class="metric">
          <div class="stat-label">Memória</div>
          <div class="metric-value">{{ bytes(c.memUsedBytes) }}<small> / {{ bytes(c.memLimitBytes) }} ({{ c.memPercent.toFixed(1) }}%)</small></div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark" aria-hidden="true"><polyline :points="points(series(c.name, (s) => s.memUsedBytes), c.memUsedBytes)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
        </div>
        <div class="metric">
          <div class="stat-label">Rede (recebido / enviado)</div>
          <div class="metric-value">{{ bytes(c.netRxBytes) }} <small>/ {{ bytes(c.netTxBytes) }}</small></div>
        </div>
        <div class="metric">
          <div class="stat-label">Disco (leitura / escrita)</div>
          <div class="metric-value">{{ bytes(c.blockReadBytes) }} <small>/ {{ bytes(c.blockWriteBytes) }}</small></div>
        </div>
        <div class="metric">
          <div class="stat-label">Processos</div>
          <div class="metric-value">{{ c.pids }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
